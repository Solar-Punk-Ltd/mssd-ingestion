jest.mock('fs');
jest.mock('../utils/common', () => ({
  retryAwaitableAsync: jest.fn(),
}));
jest.mock('./Logger', () => ({
  Logger: { getInstance: () => ({ log: jest.fn(), error: jest.fn() }) },
}));
jest.mock('./ErrorHandler', () => ({
  ErrorHandler: { getInstance: () => ({ handleError: jest.fn() }) },
}));
jest.mock('./Queue', () => {
  return {
    Queue: jest.fn().mockImplementation(() => ({
      enqueue: jest.fn(),
    })),
  };
});

const mockBee = {
  uploadData: jest.fn().mockResolvedValue({ reference: { toHex: () => 'mockRef' } }),
  gsocSend: jest.fn().mockResolvedValue({ reference: { toHex: () => 'gsocRef' } }),
};

import { SwarmStreamUploader } from './SwarmStreamUploader';

describe('SwarmStreamUploader', () => {
  const mockParams = {
    manifestBeeUrl: 'http://my.bee.node',
    gsocKey: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    gsocTopic: 'topic-1',
    stamp: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    streamPath: '/mock/stream',
  };

  const createUploader = () =>
    new SwarmStreamUploader(
      mockBee as any, // Mockround :)
      mockParams.manifestBeeUrl,
      mockParams.gsocKey,
      mockParams.gsocTopic,
      mockParams.stamp,
      mockParams.streamPath,
    );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should enqueue a segment upload', () => {
    const uploader = createUploader();
    uploader['queue'].enqueue = jest.fn();

    uploader.enqueueNewSegment('/mock/stream/seg.ts');
    expect(uploader['queue'].enqueue).toHaveBeenCalledWith(expect.any(Function));
  });

  it('should skip uploading .m3u8 files', async () => {
    const uploader = createUploader();
    const spy = jest.spyOn(uploader as any, 'uploadSegment');
    await (uploader as any).upload('/mock/stream/index.m3u8');

    expect(spy).not.toHaveBeenCalled();
  });

  it('should call uploadSegment and upsert manifest on valid segment', async () => {
    const uploader = createUploader();

    const uploadSegmentMock = jest.spyOn(uploader as any, 'uploadSegment').mockResolvedValue('mockRef');

    const upsertManifestMock = jest.spyOn(uploader as any, 'upsertManifest').mockImplementation(() => {});
    const uploadManifestMock = jest.spyOn(uploader as any, 'uploadManifest').mockResolvedValue(undefined);
    const rmProcessedSegmentMock = jest.spyOn(uploader as any, 'rmProcessedSegment').mockImplementation(() => {});

    await (uploader as any).upload('/mock/stream/seg.ts');

    expect(uploadSegmentMock).toHaveBeenCalled();
    expect(upsertManifestMock).toHaveBeenCalledWith('/mock/stream/seg.ts', 'mockRef');
    expect(uploadManifestMock).toHaveBeenCalled();
    expect(rmProcessedSegmentMock).toHaveBeenCalledWith('/mock/stream/seg.ts');
  });

  it('should log error and skip if uploadSegment fails', async () => {
    const uploader = createUploader();

    jest.spyOn(uploader as any, 'uploadSegment').mockResolvedValue(undefined);
    const loggerErrorMock = jest.spyOn((uploader as any).logger, 'error');

    await (uploader as any).upload('/mock/stream/seg.ts');

    expect(loggerErrorMock).toHaveBeenCalledWith(expect.stringMatching(/Failed to upload segment/));
  });
});
