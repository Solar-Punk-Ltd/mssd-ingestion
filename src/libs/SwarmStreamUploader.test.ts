import fs from 'fs';
import path from 'path';

jest.mock('crypto', () => ({
  randomUUID: jest.fn(() => 'mocked-uuid'),
}));

jest.mock('fs');

jest.mock('@ethersphere/bee-js', () => ({
  Bee: jest.fn(() => mockBee),
  PrivateKey: jest.fn().mockImplementation(() => ({
    publicKey: () => ({
      address: () => ({
        toHex: () => '0xOwnerAddress',
      }),
    }),
  })),
  Identifier: {
    fromString: jest.fn(() => 'mockIdentifier'),
  },
  Topic: {
    fromString: jest.fn(() => 'mockTopic'),
  },
  Bytes: {
    fromSlice: () => ({
      toHex: () => 'hexRef',
    }),
  },
}));

jest.mock('@fairdatasociety/bmt-js', () => ({
  makeChunkedFile: jest.fn(() => ({
    rootChunk: () => ({
      address: () => new Uint8Array([0xaa]),
    }),
  })),
}));

jest.mock('../utils/common', () => ({
  retryAwaitableAsync: jest.fn(fn => fn()),
}));

jest.mock('./Logger', () => ({
  Logger: {
    getInstance: () => ({
      log: jest.fn(),
      error: jest.fn(),
    }),
  },
}));

jest.mock('./ErrorHandler', () => ({
  ErrorHandler: {
    getInstance: () => ({
      handleError: jest.fn(),
    }),
  },
}));

jest.mock('./Queue', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    enqueue: jest.fn(fn => fn()),
    waitForProcessing: jest.fn(() => Promise.resolve()),
  })),
}));

import { SwarmStreamUploader } from './SwarmStreamUploader';

const mockBee = {
  uploadData: jest.fn().mockResolvedValue({ reference: { toHex: () => 'mockRef' } }),
  gsocSend: jest.fn().mockResolvedValue({ reference: { toHex: () => 'gsocRef' } }),
  makeFeedWriter: jest.fn().mockReturnValue({
    uploadPayload: jest.fn().mockResolvedValue({ reference: { toHex: () => 'socRef' } }),
  }),
};

describe('SwarmStreamUploader', () => {
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

  it('broadcastStop includes mediatype in payload', async () => {
    const uploader = createUploader('video/mp4');

    jest.spyOn(fs, 'readFileSync').mockImplementation((path: any) => {
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

    jest.spyOn(fs, 'existsSync').mockImplementation((path: any) => path.includes('playlist-vod.m3u8'));

    await uploader.broadcastStop();

    expect(mockBee.gsocSend).toHaveBeenCalledWith(
      '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      expect.any(Object),
      'mockIdentifier',
      expect.stringContaining('"mediatype":"video/mp4"'),
    );
  });

  it('upload should skip processing manifest files', () => {
    const uploader = createUploader('audio/mpeg');
    const processSpy = jest.spyOn(uploader as any, 'processNewSegment');

    const manifestPaths = [
      'index.m3u8',
      path.join(streamPath, 'playlist-live.m3u8'),
      path.join(streamPath, 'variant.m3u8'),
    ];

    manifestPaths.forEach(manifestPath => {
      uploader.upload(manifestPath);
      expect(processSpy).not.toHaveBeenCalled();
      expect(mockBee.uploadData).not.toHaveBeenCalled();
    });

    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('getTotalDurationFromFile parses all EXTINF durations', () => {
    jest.spyOn(fs, 'readFileSync').mockReturnValue('#EXTINF:3.1,\n#EXTINF:4.9,\n');
    const uploader = createUploader('audio');
    const total = (uploader as any).manifestManager.getTotalDurationFromFile();
    expect(total).toBeCloseTo(8.0);
  });
});
