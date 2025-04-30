import fs from 'fs';
import path from 'path';

jest.mock('fs');
jest.mock('./Logger', () => ({
  Logger: { getInstance: () => ({ log: jest.fn() }) },
}));

import { ManifestManager } from './ManifestManager';

describe('ManifestManager', () => {
  const streamPath = '/mock/stream';
  const manifestBeeUrl = 'http://bee';
  let manager: ManifestManager;

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new ManifestManager(streamPath, manifestBeeUrl, 2);
  });

  it('buildVODManifest writes headers and entry when file does not exist', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    (fs.readFileSync as jest.Mock).mockReturnValue('#EXTM3U\n#EXTINF:3.0,\nsegment.ts');

    manager.buildVODManifest('ENTRY');

    const vodPath = path.join(streamPath, 'playlist-vod.m3u8');
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      vodPath,
      '#EXTM3U\n#EXT-X-PLAYLIST-TYPE: VOD\n#EXT-X-MEDIA-SEQUENCE: 0\n',
    );
    expect(fs.appendFileSync).toHaveBeenCalledWith(vodPath, 'ENTRY\n');
  });

  it('buildVODManifest appends entry when file exists', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    manager.buildVODManifest('E2');

    const vodPath = path.join(streamPath, 'playlist-vod.m3u8');
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(fs.appendFileSync).toHaveBeenCalledWith(vodPath, 'E2\n');
  });

  it('buildLiveManifest writes live manifest content', () => {
    // simulate headers and buffer
    (fs.readFileSync as jest.Mock).mockReturnValue('#EXTINF:1.0,\nseg.ts');
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
    (fs.readFileSync as jest.Mock).mockReturnValue(content);
    const total = manager.getTotalDurationFromFile();
    expect(total).toBeCloseTo(4.0);
  });

  it('getSegmentEntry returns entry with correct duration and URL', () => {
    const origPath = path.join(streamPath, 'index.m3u8');
    (fs.readFileSync as jest.Mock).mockImplementation((p: string) => {
      if (p === origPath) return '#EXTINF:5.5,\nseg.ts';
      return '';
    });

    const entry = manager.getSegmentEntry('seg.ts', 'REF');
    expect(entry).toBe('#EXTINF:5.5,\nhttp://bee/REF');
  });

  it('checkFinalVODManifest returns false if file missing or invalid', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    expect(manager.checkFinalVODManifest()).toBe(false);

    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockReturnValue('#EXTINF:1.0,' + '\n#COMMENT');
    expect(manager.checkFinalVODManifest()).toBe(false);
  });

  it('checkFinalVODManifest returns true for valid manifest', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    const lines = '#EXTINF:1.0,\nuri.ts';
    (fs.readFileSync as jest.Mock).mockReturnValue(lines);
    expect(manager.checkFinalVODManifest()).toBe(true);
  });

  it('getSegmentEntry throws when no EXTINF present', () => {
    (fs.readFileSync as jest.Mock).mockReturnValue('foo\nbar\n');
    expect(() => manager.getSegmentEntry('seg.ts', 'REF')).toThrow('Failed to get EXTINF');
  });
});
