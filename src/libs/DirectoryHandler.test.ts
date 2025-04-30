import fs from 'fs';
import path from 'path';

import { DirectoryHandler } from './DirectoryHandler.js';

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
const swarmStreamUploaderMock = jest.fn();

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
  SwarmStreamUploader: jest.fn().mockImplementation((bee, rpcUrl, resId, topic, key, stamp, path, mediatype) => {
    swarmStreamUploaderMock(bee, rpcUrl, resId, topic, key, stamp, path, mediatype);
    return {
      upload: jest.fn(),
      broadcastStart: jest.fn().mockResolvedValue(undefined),
      broadcastStop: jest.fn().mockResolvedValue(undefined),
    };
  }),
}));

describe('DirectoryHandler', () => {
  const basePath = '/mock';
  const audioStreamPath =
    '/audio/test?exp=1745855645&sign=2db33d7b239b628d08b51d2be7951c373dff7a223a4687e0fef5d82d9f191138';
  const videoStreamPath =
    '/video/test?exp=1745855645&sign=2db33d7b239b628d08b51d2be7951c373dff7a223a4687e0fef5d82d9f191138';
  const invalidStreamPath = '/invalid/test';
  const audioFullPath = path.join(basePath, audioStreamPath);
  const videoFullPath = path.join(basePath, videoStreamPath);
  let handler: DirectoryHandler;

  beforeEach(() => {
    handler = DirectoryHandler.getInstance();
    jest.clearAllMocks();
  });

  it('should acquire directory successfully', () => {
    handler.acquireDirectory(basePath, audioStreamPath);
    expect(() => handler.acquireDirectory(basePath, audioStreamPath)).toThrow(
      `Directory ${audioFullPath} is already in use.`,
    );
  });

  it('should release directory successfully', () => {
    handler.releaseDirectory(basePath, audioStreamPath);

    handler.acquireDirectory(basePath, audioStreamPath);
    handler.releaseDirectory(basePath, audioStreamPath);
    expect(() => handler.acquireDirectory(basePath, audioStreamPath)).not.toThrow();
  });

  it('should start handling audio stream directory and pass mediatype as audio', async () => {
    handler.handleStart(basePath, audioStreamPath);
    await new Promise(resolve => setTimeout(resolve, 200));

    expect(startMock).toHaveBeenCalled();
    expect(swarmStreamUploaderMock).toHaveBeenCalledWith(
      expect.any(Object), // Bee instance
      'http://mocked-url',
      '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      'mock-topic',
      '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      audioFullPath,
      'audio', // Ensure mediatype is 'audio'
    );
  });

  it('should start handling video stream directory and pass mediatype as video', async () => {
    handler.handleStart(basePath, videoStreamPath);
    await new Promise(resolve => setTimeout(resolve, 200));

    expect(startMock).toHaveBeenCalled();
    expect(swarmStreamUploaderMock).toHaveBeenCalledWith(
      expect.any(Object), // Bee instance
      'http://mocked-url',
      '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      'mock-topic',
      '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      videoFullPath,
      'video', // Ensure mediatype is 'video'
    );
  });

  it('should stop handling directory and clean up properly', async () => {
    handler.handleStart(basePath, audioStreamPath);
    await new Promise(resolve => setTimeout(resolve, 200));

    await handler.handleStop(basePath, audioStreamPath);

    expect(closeMock).toHaveBeenCalled();
    expect(fs.rmSync).toHaveBeenCalledWith(audioFullPath, { recursive: true, force: true });
  });
});
