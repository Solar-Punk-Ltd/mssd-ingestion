import fs from 'fs';
import path from 'path';

import { DirectoryHandler } from './DirectoryHandler';

jest.mock('fs', () => ({
  rmSync: jest.fn(),
  existsSync: jest.fn(() => true),
}));
jest.mock('./Logger', () => ({
  Logger: {
    getInstance: () => ({
      log: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
    }),
  },
}));
jest.mock('@ethersphere/bee-js', () => ({
  Bee: jest.fn(() => ({
    uploadData: jest.fn().mockResolvedValue({ reference: { toHex: () => 'mockRef' } }),
    gsocSend: jest.fn().mockResolvedValue({ reference: { toHex: () => 'gsocRef' } }),
  })),
}));
jest.mock('../utils/common', () => ({
  getEnvVariable: jest.fn(
    (key: string) =>
      ({
        SWARM_RPC_URL: 'http://mocked-url',
        STREAM_KEY: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        STAMP: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        GSOC_RESOURCE_ID: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        GSOC_TOPIC: 'mock-topic',
      }[key]),
  ),
}));

const startMock = jest.fn();
const closeMock = jest.fn();

jest.mock('./MediaWatcher', () => ({
  MediaWatcher: jest.fn().mockImplementation((p, cb) => ({
    start: () => {
      cb('/mock/path/file.ts');
      startMock();
    },
    close: closeMock,
  })),
}));

jest.mock('./SwarmStreamUploader', () => ({
  SwarmStreamUploader: jest.fn().mockImplementation(() => ({
    upload: jest.fn(),
    broadcastStart: jest.fn().mockResolvedValue(undefined),
    broadcastStop: jest.fn().mockResolvedValue(undefined),
  })),
}));

describe('DirectoryHandler', () => {
  const basePath = '/mock';
  const streamPath = 'stream';
  const fullPath = path.join(basePath, streamPath);
  let handler: DirectoryHandler;

  beforeEach(() => {
    handler = DirectoryHandler.getInstance();
    jest.clearAllMocks();
  });

  it('should acquire directory successfully', () => {
    handler.acquireDirectory(basePath, streamPath);
    expect(() => handler.acquireDirectory(basePath, streamPath)).toThrow(`Directory ${fullPath} is already in use.`);
  });

  it('should release directory successfully', () => {
    // Prev run (it's static)
    handler.releaseDirectory(basePath, streamPath);

    handler.acquireDirectory(basePath, streamPath);
    handler.releaseDirectory(basePath, streamPath);
    expect(() => handler.acquireDirectory(basePath, streamPath)).not.toThrow();
  });

  it('should start handling stream directory and store uploader and watcher', async () => {
    handler.handleStart(basePath, streamPath);
    await new Promise(resolve => setTimeout(resolve, 200));

    expect(startMock).toHaveBeenCalled();
  });

  it('should stop handling directory and clean up properly', async () => {
    handler.handleStart(basePath, streamPath);
    await new Promise(resolve => setTimeout(resolve, 200));

    await handler.handleStop(basePath, streamPath);

    expect(closeMock).toHaveBeenCalled();
    expect(fs.rmSync).toHaveBeenCalledWith(fullPath, { recursive: true, force: true });
  });
});
