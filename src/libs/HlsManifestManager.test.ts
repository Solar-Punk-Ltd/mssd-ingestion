// src/libs/HlsManifestManager.test.ts
import fs from 'fs';

import { HlsManifestManager, HlsManifestOptions } from './HlsManifestManager';

jest.mock('fs');

describe('HlsManifestManager', () => {
  const originalPath = '/mock/original.m3u8';
  const swarmPath = '/mock/playlist.m3u8';
  const beeUrl = 'http://swarm/bytes';
  const baseOptions: HlsManifestOptions = {
    originalManifestPath: originalPath,
    swarmManifestPath: swarmPath,
    manifestBeeUrl: beeUrl,
    targetDuration: 5,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loadOriginalManifest parses EXTINF, MEDIA-SEQUENCE, TARGETDURATION', () => {
    const sample = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:7',
      '#EXT-X-MEDIA-SEQUENCE:42',
      '#EXTINF:3.5,',
      'seg1.ts',
      '#EXTINF:4.0,',
      'seg2.ts',
    ].join('\n');

    (fs.readFileSync as jest.Mock).mockReturnValue(sample);

    const mgr = new HlsManifestManager(baseOptions);
    mgr.loadOriginalManifest();

    // Internally, segments should be two entries with correct durations & URIs
    const content = mgr.getManifestContent();
    expect(content).toContain('#EXT-X-TARGETDURATION:7');
    expect(content).toContain('#EXT-X-MEDIA-SEQUENCE:42');
    expect(content).toContain('#EXTINF:3.500000,');
    expect(content).toContain('seg1.ts');
    expect(content).toContain('#EXTINF:4.000000,');
    expect(content).toContain('seg2.ts');
  });

  it('getSegmentDurationFromOriginal returns correct duration or default', () => {
    const sample = ['#EXTINF:2.2,', 'foo.ts', '#EXTINF:3.3,', 'bar.ts'].join('\n');
    (fs.readFileSync as jest.Mock).mockReturnValue(sample);

    const mgr = new HlsManifestManager(baseOptions);

    const durFoo = mgr.getSegmentDurationFromOriginal('/some/path/foo.ts');
    expect(durFoo).toBeCloseTo(2.2);

    const durMissing = mgr.getSegmentDurationFromOriginal('/some/path/unknown.ts');
    expect(durMissing).toBe(baseOptions.targetDuration!);
  });

  it('addSegment and getManifestContent include new Swarm URIs', () => {
    (fs.readFileSync as jest.Mock).mockReturnValue(''); // no original
    const mgr = new HlsManifestManager(baseOptions);

    mgr.addSegment('abc123', 5.5);
    const content = mgr.getManifestContent();

    expect(content).toContain('#EXTINF:5.500000,');
    expect(content).toContain(`${beeUrl}/abc123`);
  });

  it('closePlaylist appends EXT-X-ENDLIST', () => {
    (fs.readFileSync as jest.Mock).mockReturnValue('');
    const mgr = new HlsManifestManager(baseOptions);

    mgr.addSegment('ref1', 1.1);
    mgr.closePlaylist();
    const content = mgr.getManifestContent();

    expect(content.trim().endsWith('#EXT-X-ENDLIST')).toBe(true);
  });

  it('saveManifest writes out the manifest file', () => {
    const mgr = new HlsManifestManager(baseOptions);
    // stub getManifestContent
    jest.spyOn(mgr, 'getManifestContent').mockReturnValue('PLAYLIST');
    mgr.saveManifest();
    expect(fs.writeFileSync).toHaveBeenCalledWith(swarmPath, 'PLAYLIST');
  });

  it('getTotalDuration sums segment durations', () => {
    (fs.readFileSync as jest.Mock).mockReturnValue('');
    const mgr = new HlsManifestManager(baseOptions);

    // manually push segments
    (mgr as any).segments = [
      { duration: 2.0, uri: 'a' },
      { duration: 3.5, uri: 'b' },
    ];

    expect(mgr.getTotalDuration()).toBeCloseTo(5.5);
  });
});
