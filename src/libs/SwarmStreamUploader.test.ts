import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('crypto', async () => {
  const mock = {
    randomUUID: vi.fn(() => 'mocked-uuid'),
  };

  return {
    default: mock,
    ...mock,
  };
});
vi.mock('fs');

vi.mock('@ethersphere/bee-js', () => ({
  Bee: vi.fn(() => mockBee),
  PrivateKey: vi.fn().mockImplementation(() => ({
    publicKey: () => ({
      address: () => ({
        toHex: () => '0xOwnerAddress',
      }),
    }),
  })),
  Identifier: {
    fromString: vi.fn(() => 'mockIdentifier'),
  },
  Topic: {
    fromString: vi.fn(() => 'mockTopic'),
  },
  Bytes: {
    fromSlice: () => ({
      toHex: () => 'hexRef',
    }),
  },
}));

vi.mock('@fairdatasociety/bmt-js', async () => {
  const mock = {
    makeChunkedFile: vi.fn(() => ({
      rootChunk: () => ({
        address: () => new Uint8Array([0xaa]),
      }),
    })),
  };

  return {
    default: mock,
    ...mock,
  };
});

vi.mock('../utils/common', () => ({
  retryAwaitableAsync: vi.fn(fn => fn()),
}));

vi.mock('./Logger', () => ({
  Logger: {
    getInstance: () => ({
      log: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

vi.mock('./ErrorHandler', () => ({
  ErrorHandler: {
    getInstance: () => ({
      handleError: vi.fn(),
    }),
  },
}));

vi.mock('./Queue', () => ({
  Queue: vi.fn().mockImplementation(() => ({
    enqueue: vi.fn(fn => fn()),
    waitForProcessing: vi.fn(() => Promise.resolve()),
  })),
}));

import fs from 'fs';
import path from 'path';

import { SwarmStreamUploader } from './SwarmStreamUploader.js';

const mockBee = {
  uploadData: vi.fn().mockResolvedValue({ reference: { toHex: () => 'mockRef' } }),
  gsocSend: vi.fn().mockResolvedValue({ reference: { toHex: () => 'gsocRef' } }),
  makeFeedWriter: vi.fn().mockReturnValue({
    uploadPayload: vi.fn().mockResolvedValue({ reference: { toHex: () => 'socRef' } }),
  }),
};

describe('SwarmStreamUploader', () => {
  beforeAll(() => {
    vi.useFakeTimers();
    // freeze to 31 Dec 2023
    vi.setSystemTime(new Date(2023, 11, 31));
  });

  afterAll(() => {
    vi.useRealTimers();
  });
  const streamPath = '/mock/stream';

  const createUploader = (mediatype: string) =>
    new SwarmStreamUploader(
      mockBee as any,
      'http://mocked-url',
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      'topic-1',
      '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      streamPath,
      mediatype,
    );

  it('should initialize with mediatype as audio', () => {
    const uploader = createUploader('audio');
    expect(uploader).toBeDefined();
    expect((uploader as any).mediatype).toBe('audio');
  });

  it('should initialize with mediatype as video', () => {
    const uploader = createUploader('video');
    expect(uploader).toBeDefined();
    expect((uploader as any).mediatype).toBe('video');
  });

  it('broadcastStart includes mediatype in payload', async () => {
    const uploader = createUploader('audio');
    await uploader.broadcastStart();

    expect(mockBee.gsocSend).toHaveBeenCalledWith(
      '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      expect.anything(),
      'mockIdentifier',
      expect.stringContaining('"mediatype":"audio"'),
    );
  });

  it('broadcastStart includes title in payload', async () => {
    const uploader = createUploader('audio');
    await uploader.broadcastStart();

    expect(mockBee.gsocSend).toHaveBeenCalledWith(
      expect.any(String),
      expect.anything(),
      expect.any(String),
      expect.stringContaining('"title":"31/12/2023"'),
    );
  });

  it('broadcastStop includes mediatype in payload', async () => {
    const uploader = createUploader('video/mp4');

    vi.spyOn(fs, 'readFileSync').mockImplementation((path: any) => {
      if (typeof path === 'string' && path.includes('playlist-vod.m3u8')) {
        return [
          '#EXTM3U',
          '#EXT-X-VERSION:3',
          '#EXT-X-TARGETDURATION:4',
          '#EXTINF:6.000,',
          'http://swarm.test/seg1.ts',
          '#EXT-X-ENDLIST',
        ].join('\n');
      }
      return Buffer.from('');
    });

    vi.spyOn(fs, 'existsSync').mockImplementation((path: any) => path.includes('playlist-vod.m3u8'));

    await uploader.broadcastStop();

    expect(mockBee.gsocSend).toHaveBeenCalledWith(
      '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      expect.any(Object),
      'mockIdentifier',
      expect.stringContaining('"mediatype":"video/mp4"'),
    );
  });

  it('broadcastStop includes title in payload', async () => {
    const uploader = createUploader('video/mp4');

    // stub VOD manifest so broadcastStop runs through
    vi.spyOn(fs, 'readFileSync').mockImplementation((p: any) => {
      if (typeof p === 'string' && p.includes('playlist-vod.m3u8')) {
        return ['#EXTM3U', '#EXTINF:5.000,', 'http://swarm.test/seg1.ts', '#EXT-X-ENDLIST'].join('\n');
      }
      return Buffer.from('');
    });
    vi.spyOn(fs, 'existsSync').mockImplementation((p: any) => typeof p === 'string' && p.includes('playlist-vod.m3u8'));

    await uploader.broadcastStop();

    expect(mockBee.gsocSend).toHaveBeenCalledWith(
      expect.any(String),
      expect.anything(),
      expect.any(String),
      expect.stringContaining('"title":"31/12/2023"'),
    );
  });

  it('getFormattedDate returns dd/mm/yyyy', () => {
    const uploader = createUploader('video/mp4');
    const formatted = (uploader as any).getFormattedDate();
    expect(formatted).toBe('31/12/2023');
  });

  it('onSegmentUpdate should skip processing manifest files', () => {
    const uploader = createUploader('audio/mpeg');
    const uploadSpy = vi.spyOn(uploader as any, 'uploadSegment');

    const manifestPaths = [
      'index.m3u8',
      path.join(streamPath, 'playlist-live.m3u8'),
      path.join(streamPath, 'variant.m3u8'),
    ];

    manifestPaths.forEach(manifestPath => {
      uploader.onSegmentUpdate(manifestPath);
      expect(uploadSpy).not.toHaveBeenCalled();
      expect(mockBee.uploadData).not.toHaveBeenCalled();
    });

    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('onManifestUpdate should do nothing if path does not match original manifest', () => {
    const uploader = createUploader('video');
    const mockSetOriginalManifest = vi.spyOn(uploader['manifestManager'], 'setOriginalManifest');
    const mockBuildManifests = vi.spyOn(uploader['manifestManager'], 'buildManifests');
    const mockUploadManifest = vi.spyOn(uploader as any, 'uploadManifest');

    uploader.onManifestUpdate();

    expect(mockSetOriginalManifest).not.toHaveBeenCalled();
    expect(mockBuildManifests).not.toHaveBeenCalled();
    expect(mockUploadManifest).not.toHaveBeenCalled();
  });

  it('getTotalDurationFromFile parses all EXTINF durations', () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue('#EXTINF:3.1,\n#EXTINF:4.9,\n');
    const uploader = createUploader('audio');
    const total = (uploader as any).manifestManager.getTotalDurationFromVodManifest();
    expect(total).toBeCloseTo(8.0);
  });
});
