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
    manager = new ManifestManager(streamPath, manifestBeeUrl, 2);
  });

  it('buildVODManifest writes headers and entry when file does not exist', () => {
    (fs.existsSync as Mock).mockReturnValue(false);
    (fs.readFileSync as Mock).mockReturnValue('#EXTM3U\n#EXTINF:3.0,\nsegment.ts');

    manager.buildVODManifest('ENTRY');

    const vodPath = path.join(streamPath, 'playlist-vod.m3u8');
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      vodPath,
      '#EXTM3U\n#EXT-X-PLAYLIST-TYPE: VOD\n#EXT-X-MEDIA-SEQUENCE: 0\n',
    );
    expect(fs.appendFileSync).toHaveBeenCalledWith(vodPath, 'ENTRY\n');
  });

  it('buildVODManifest appends entry when file exists', () => {
    (fs.existsSync as Mock).mockReturnValue(true);
    manager.buildVODManifest('E2');

    const vodPath = path.join(streamPath, 'playlist-vod.m3u8');
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(fs.appendFileSync).toHaveBeenCalledWith(vodPath, 'E2\n');
  });

  it('buildLiveManifest writes live manifest content', () => {
    // simulate headers and buffer
    (fs.readFileSync as Mock).mockReturnValue('#EXTINF:1.0,\nseg.ts');
    manager.buildLiveManifest();

    const livePath = path.join(streamPath, 'playlist-live.m3u8');
    expect(fs.writeFileSync).toHaveBeenCalledWith(livePath, expect.stringContaining('#EXT-X-MEDIA-SEQUENCE:0'));
  });

  it('closeVODManifest appends endlist tag', () => {
    const vodPath = path.join(streamPath, 'playlist-vod.m3u8');
    manager.closeVODManifest();
    expect(fs.appendFileSync).toHaveBeenCalledWith(vodPath, '#EXT-X-ENDLIST\n');
  });

  it('getTotalDurationFromFile sums all EXTINF durations', () => {
    const content = '#EXTINF:1.2,\n#EXTINF:2.8,\n';
    (fs.readFileSync as Mock).mockReturnValue(content);
    const total = manager.getTotalDurationFromVodManifest();
    expect(total).toBeCloseTo(4.0);
  });

  it('getSegmentEntrySafe returns correct entry after retries', async () => {
    const origPath = path.join(streamPath, 'index.m3u8');
    (fs.readFileSync as Mock).mockImplementation((p: string) => {
      if (p === origPath) {
        return '#EXTINF:3.3,\nseg.ts';
      }
      return '';
    });

    const result = await manager.getSegmentEntrySafe('seg.ts', 'REFX');
    expect(result).toBe('#EXTINF:3.3,\nhttp://bee/REFX');
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

  it('getSegmentEntry throws when no EXTINF present', async () => {
    const origPath = path.join(streamPath, 'index.m3u8');
    (fs.readFileSync as Mock).mockImplementation((p: string) => {
      if (p === origPath) {
        return '#EXTM3U\n#EXT-X-VERSION:3\nsome-other.ts\nseg.ts';
      }
      return '';
    });

    await expect(manager.getSegmentEntrySafe('seg.ts', 'REF')).rejects.toThrow('Failed to get EXTINF for seg.ts');
  });
});
