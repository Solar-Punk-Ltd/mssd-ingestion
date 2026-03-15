import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';

vi.mock('fs');

vi.mock('./Logger', () => ({
  Logger: { getInstance: () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('../utils/common', async () => {
  const actual = await vi.importActual<any>('../utils/common');
  return {
    ...actual,
    retryAwaitableAsync: vi.fn(fn => fn()),
  };
});

import fs from 'fs';
import path from 'path';

import { ManifestManager } from './ManifestManager.js';

describe('ManifestManager', () => {
  const streamPath = '/mock/stream';
  const manifestBeeUrl = 'http://bee';
  let manager: ManifestManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new ManifestManager(streamPath, manifestBeeUrl);
  });

  it('buildVODManifest should create new manifest file if not exists and append entry', () => {
    manager['hlsOriginalHeaders'] = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:6'];
    const vodPath = path.join(streamPath, 'playlist-vod.m3u8');
    (fs.existsSync as Mock).mockReturnValue(false);

    const segmentEntry = '#EXTINF:3.3,\nseg.ts';

    manager['buildVODManifest'](segmentEntry);

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      vodPath,
      '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-MEDIA-SEQUENCE:0\n',
    );
    expect(fs.appendFileSync).toHaveBeenCalledWith(vodPath, segmentEntry + '\n');
  });

  it('buildLiveManifest should write live manifest from VOD entries', () => {
    manager['hlsOriginalHeaders'] = ['#EXTM3U', '#EXT-X-VERSION:3'];

    const vodContent = '#EXTM3U\n#EXTINF:4.0,\nhttp://bee/seg1\n#EXTINF:4.0,\nhttp://bee/seg2\n';
    const vodPath = path.join(streamPath, 'playlist-vod.m3u8');
    (fs.existsSync as Mock).mockImplementation((p: string) => p === vodPath);
    (fs.readFileSync as Mock).mockReturnValue(vodContent);

    const livePath = path.join(streamPath, 'playlist-live.m3u8');

    manager['buildLiveManifest']();

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      livePath,
      '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:4.0,\nhttp://bee/seg1\n#EXTINF:4.0,\nhttp://bee/seg2\n',
    );
  });

  it('buildManifests should call VOD and Live manifest builders if segmentEntry exists', async () => {
    const segmentEntry = '#EXTINF:2.0,\nseg.ts';

    vi.spyOn(manager as any, 'getSegmentEntry').mockResolvedValue(segmentEntry);
    const buildVODSpy = vi.spyOn(manager as any, 'buildVODManifest').mockImplementation(() => {});
    const buildLiveSpy = vi.spyOn(manager as any, 'buildLiveManifest').mockImplementation(() => {});

    await manager.buildManifests();

    expect(manager['getSegmentEntry']).toHaveBeenCalled();
    expect(buildVODSpy).toHaveBeenCalledWith(segmentEntry);
    expect(buildLiveSpy).toHaveBeenCalled();
  });

  it('closeVODManifest appends endlist tag when file exists', () => {
    const vodPath = path.join(streamPath, 'playlist-vod.m3u8');
    (fs.existsSync as Mock).mockReturnValue(true);

    manager.closeVODManifest();

    expect(fs.appendFileSync).toHaveBeenCalledWith(vodPath, '#EXT-X-ENDLIST\n');
    expect(manager['logger'].log).toHaveBeenCalledWith(`Manifest closed: ${vodPath}`);
  });

  it('closeVODManifest does nothing when file does not exist', () => {
    (fs.existsSync as Mock).mockReturnValue(false);

    manager.closeVODManifest();

    expect(fs.appendFileSync).not.toHaveBeenCalled();
    expect(manager['logger'].error).toHaveBeenCalled();
  });

  it('getTotalDurationFromFile sums all EXTINF durations', () => {
    const content = '#EXTINF:1.2,\n#EXTINF:2.8,\n';
    (fs.readFileSync as Mock).mockReturnValue(content);
    const total = manager.getTotalDurationFromVodManifest();
    expect(total).toBeCloseTo(4.0);
  });

  it('getSegmentEntry returns correct entry from ordered Map buffer', async () => {
    (manager as any).originalManifest = '#EXTINF:3.3,\nindex0.ts';
    (manager as any).segmentBuffer = new Map([[0, { origiName: 'index0.ts', ref: 'REFX', index: 0 }]]);

    vi.spyOn(manager as any, 'getExtInfFromManifest').mockReturnValue('3.3');
    vi.spyOn(manager as any, 'buildSegmentEntry').mockImplementation((...args: any[]) => {
      return `#EXTINF:${args[0]},\nhttp://bee/${args[1]}`;
    });

    const entry = await (manager as any).getSegmentEntry();

    expect(entry).toBe('#EXTINF:3.3,\nhttp://bee/REFX');
    expect((manager as any).lastProcessedIndex).toBe(0);
  });

  it('getSegmentEntry defers when EXTINF not found and skips after MAX_DEFERRALS', async () => {
    (manager as any).originalManifest = '';
    (manager as any).segmentBuffer = new Map([[0, { origiName: 'index0.ts', ref: 'REFX', index: 0 }]]);

    // First call: defers (returns null)
    const result = await (manager as any).getSegmentEntry(0, 0);
    expect(result).toBeNull();
    expect((manager as any).deferralCounts.get('index0.ts')).toBe(1);

    // Set deferrals to MAX-1 so next call hits the skip
    (manager as any).deferralCounts.set('index0.ts', 10);
    const result2 = await (manager as any).getSegmentEntry(0, 0);
    // Skipped the segment, buffer should be empty now
    expect((manager as any).segmentBuffer.size).toBe(0);
    expect(result2).toBeNull();
  });

  it('addToSegmentBuffer extracts index from filename and stores in Map', () => {
    manager.addToSegmentBuffer('/mock/stream/index5.ts', 'REF5');

    expect((manager as any).segmentBuffer.size).toBe(1);
    const entry = (manager as any).segmentBuffer.get(5);
    expect(entry).toEqual({ origiName: 'index5.ts', ref: 'REF5', index: 5 });
  });

  it('addToSegmentBuffer handles non-standard filenames with -1 index', () => {
    manager.addToSegmentBuffer('/mock/stream/weird.ts', 'REFW');

    expect((manager as any).segmentBuffer.size).toBe(1);
    const entry = (manager as any).segmentBuffer.get(-1);
    expect(entry).toEqual({ origiName: 'weird.ts', ref: 'REFW', index: -1 });
  });

  it('checkFinalVODManifest returns false if file missing or invalid', () => {
    (fs.existsSync as Mock).mockReturnValue(false);
    expect(manager.isFinalVODManifestValid()).toBe(false);

    (fs.existsSync as Mock).mockReturnValue(true);
    (fs.readFileSync as Mock).mockReturnValue('#EXTINF:1.0,' + '\n#COMMENT');
    expect(manager.isFinalVODManifestValid()).toBe(false);
  });

  it('checkFinalVODManifest returns true for valid manifest', () => {
    (fs.existsSync as Mock).mockReturnValue(true);
    const lines = '#EXTINF:1.0,\nuri.ts';
    (fs.readFileSync as Mock).mockReturnValue(lines);
    expect(manager.isFinalVODManifestValid()).toBe(true);
  });

  it('cleanup resets all state', () => {
    (manager as any).segmentBuffer.set(0, { origiName: 'index0.ts', ref: 'REF', index: 0 });
    (manager as any).deferralCounts.set('index0.ts', 3);
    (manager as any).lastProcessedIndex = 5;
    (manager as any).originalManifest = 'something';
    (manager as any).hlsOriginalHeaders = ['#EXTM3U'];

    manager.cleanup();

    expect((manager as any).segmentBuffer.size).toBe(0);
    expect((manager as any).deferralCounts.size).toBe(0);
    expect((manager as any).lastProcessedIndex).toBe(-1);
    expect((manager as any).originalManifest).toBe('');
    expect((manager as any).hlsOriginalHeaders.length).toBe(0);
  });
});
