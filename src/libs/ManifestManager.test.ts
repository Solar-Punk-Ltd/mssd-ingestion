import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';

vi.mock('fs');

vi.mock('./Logger', () => ({
  Logger: { getInstance: () => ({ log: vi.fn() }) },
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
    manager['getSegmentEntry'] = vi.fn().mockReturnValue(segmentEntry);

    manager['buildVODManifest'](segmentEntry);

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      vodPath,
      '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-MEDIA-SEQUENCE:0\n',
    );
    expect(fs.appendFileSync).toHaveBeenCalledWith(vodPath, segmentEntry + '\n');
  });

  it('buildLiveManifest should write live manifest from VOD and media sequence', () => {
    manager['hlsOriginalHeaders'] = ['#EXTM3U', '#EXT-X-VERSION:3'];
    manager['originalManifest'] = '#EXT-X-MEDIA-SEQUENCE:5';

    const mediaSeq = 5;
    manager['extractMediaSequenceFromManifest'] = vi.fn().mockReturnValue(mediaSeq);
    manager['extractSegmentEntriesFromVODManifest'] = vi.fn().mockReturnValue(['#EXTINF:4.0,', 'seg.ts']);

    const livePath = path.join(streamPath, 'playlist-live.m3u8');

    manager['buildLiveManifest']();

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      livePath,
      '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-MEDIA-SEQUENCE:5\n#EXTINF:4.0,\nseg.ts\n',
    );
  });

  it('buildManifests should call VOD and Live manifest builders', () => {
    const segmentEntry = '#EXTINF:2.0,\nseg.ts';
    manager['getSegmentEntry'] = vi.fn().mockReturnValue(segmentEntry);
    manager['buildVODManifest'] = vi.fn();
    manager['buildLiveManifest'] = vi.fn();

    manager.buildManifests();

    expect(manager['getSegmentEntry']).toHaveBeenCalled();
    expect(manager['buildVODManifest']).toHaveBeenCalledWith(segmentEntry);
    expect(manager['buildLiveManifest']).toHaveBeenCalled();
  });

  it('closeManifests appends endlist tag to both VOD and live manifests and logs', () => {
    const vodPath = path.join(streamPath, 'playlist-vod.m3u8');

    manager.closeVODManifest();

    expect(fs.appendFileSync).toHaveBeenCalledWith(vodPath, '#EXT-X-ENDLIST\n');
    expect(manager['logger'].log).toHaveBeenCalledWith(`Manifest closed: ${vodPath}`);
  });

  it('getTotalDurationFromFile sums all EXTINF durations', () => {
    const content = '#EXTINF:1.2,\n#EXTINF:2.8,\n';
    (fs.readFileSync as Mock).mockReturnValue(content);
    const total = manager.getTotalDurationFromVodManifest();
    expect(total).toBeCloseTo(4.0);
  });

  it('getSegmentEntry returns correct entry from buffer', () => {
    (manager as any).originalManifest = '#EXTINF:3.3,\nseg.ts';
    (manager as any).segmentBuffer.push({ origiName: 'seg.ts', ref: 'REFX' });

    const entry = (manager as any).getSegmentEntry();
    expect(entry).toBe('#EXTINF:3.3,\nhttp://bee/REFX');
  });

  it('getSegmentEntry throws when no EXTINF present', () => {
    (manager as any).originalManifest = '';
    (manager as any).segmentBuffer.push({ origiName: 'seg.ts', ref: 'REFX' });

    expect(() => (manager as any).getSegmentEntry()).toThrow('Failed to get EXTINF for seg.ts');
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
});
