import { DirectoryHandler } from './DirectoryHandler';

jest.mock('fs', () => ({
  readFileSync: jest.fn(() => 'abc'),
  rmSync: jest.fn(),
}));

jest.mock('./Logger', () => ({
  Logger: { getInstance: () => ({ log: jest.fn(), error: jest.fn(), info: jest.fn() }) },
}));

jest.mock('./ErrorHandler', () => ({
  ErrorHandler: { getInstance: () => ({ handleError: jest.fn() }) },
}));

const mockedBeeInstance = {
  uploadData: jest.fn().mockResolvedValue({ reference: { toHex: () => 'mockRef' } }),
  gsocSend: jest.fn().mockResolvedValue({ reference: { toHex: () => 'gsocRef' } }),
};

jest.mock('@ethersphere/bee-js', () => ({
  Bee: jest.fn(() => mockedBeeInstance),
  PrivateKey: jest.fn().mockImplementation(() => ({
    sign: jest.fn().mockResolvedValue('mocked-signature'),
  })),
  Identifier: { fromString: jest.fn(() => null) },
}));

jest.mock('../utils/common', () => ({
  getEnvVariable: jest.fn(
    (key: string) =>
      ({
        WRITER_BEE_URL: 'http://mocked-url',
        MANIFEST_SEGMENT_URL: 'http://mocked-manifest-url',
        STREAM_STAMP: 'mocked-stream-stamp',
        GSOC_KEY: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        GSOC_TOPIC: 'mocked-gsoc-topic',
      }[key]),
  ),
  retryAwaitableAsync: jest.requireActual('../utils/common').retryAwaitableAsync,
}));

jest.mock('./MediaWatcher', () => ({
  MediaWatcher: jest.fn().mockImplementation((path, onAdd) => ({
    // At this point (in the start), the `onAdd` callback is triggered with the mock file path `/mock/path/file.ts`
    start: jest.fn(() => onAdd('/mock/path/file.ts')),
  })),
}));

describe('DirectoryHandler', () => {
  it('should call gsocSend and uploadData on the mocked Bee instance', async () => {
    const directoryHandler = DirectoryHandler.getInstance();
    directoryHandler.handleDir('/mock/path');

    await new Promise(resolve => setTimeout(resolve, 1000));

    expect(mockedBeeInstance.gsocSend).toHaveBeenCalled();
    expect(mockedBeeInstance.uploadData).toHaveBeenCalled();
  });
});
