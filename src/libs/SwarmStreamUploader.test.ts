import fs from 'fs';

import { SwarmStreamUploader } from './SwarmStreamUploader';

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

const mockBee = {
  uploadData: jest.fn().mockResolvedValue({ reference: { toHex: () => 'mockRef' } }),
  gsocSend: jest.fn().mockResolvedValue({ reference: { toHex: () => 'gsocRef' } }),
  makeFeedWriter: jest.fn().mockReturnValue({
    uploadPayload: jest.fn().mockResolvedValue({ reference: { toHex: () => 'socRef' } }),
  }),
};

describe('SwarmStreamUploader', () => {
  const streamPath = '/mock/stream';

  const uploader = new SwarmStreamUploader(
    mockBee as any,
    'http://mocked-url',
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    'topic-1',
    '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    streamPath,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('broadcastStart calls bee.gsocSend with correct payload', async () => {
    const result = await uploader.broadcastStart();
    expect(mockBee.gsocSend).toHaveBeenCalled();
    expect(result.reference.toHex()).toBe('gsocRef');
  });

  it('broadcastStop finalizes manifest and sends final message', async () => {
    jest.spyOn(fs, 'readFileSync').mockReturnValue('#EXTINF:6.000000,\nsegment.ts\n');
    jest.spyOn(fs, 'appendFileSync').mockImplementation(() => {});
    jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    const result = await uploader.broadcastStop();

    expect(fs.appendFileSync).toHaveBeenCalledWith(expect.stringContaining('playlist.m3u8'), '#EXT-X-ENDLIST\n');
    expect(mockBee.gsocSend).toHaveBeenCalledWith(
      '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      expect.anything(),
      'mockIdentifier',
      expect.stringContaining('"state":"VOD"'),
    );
    expect(result.reference.toHex()).toBe('gsocRef');
  });

  it('upload skips m3u8 files', async () => {
    const spy = jest.spyOn(uploader as any, 'uploadSegment');
    uploader.upload('index.m3u8');
    expect(spy).not.toHaveBeenCalled();
  });

  it('upload calls uploadSegment and writes manifest', async () => {
    jest.spyOn(fs, 'readFileSync').mockReturnValue('#EXTINF:5.5,\nseg0.ts');
    jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    jest.spyOn(fs, 'rmSync').mockImplementation(() => {});
    uploader.upload('seg0.ts');

    expect(mockBee.uploadData).toHaveBeenCalled();
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('playlist.m3u8'),
      expect.stringContaining('#EXTINF:'),
    );
  });

  it('uploadSegment logs failure if fs.readFileSync throws', async () => {
    jest.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('oops');
    });
    const errHandler = (uploader as any).errorHandler;
    await (uploader as any).uploadSegment('seg-fail.ts');

    expect(errHandler.handleError).toHaveBeenCalled();
  });

  it('uploadManifest pushes manifest to Bee feed writer', async () => {
    jest.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('playlist content'));
    await (uploader as any).uploadManifest(1);
    expect(mockBee.makeFeedWriter).toHaveBeenCalled();
  });

  it('getTotalDurationFromFile parses all EXTINF durations', () => {
    jest.spyOn(fs, 'readFileSync').mockReturnValue('#EXTINF:3.1,\n#EXTINF:4.9,\n');
    const total = (uploader as any).getTotalDurationFromFile();
    expect(total).toBeCloseTo(8.0);
  });
});
