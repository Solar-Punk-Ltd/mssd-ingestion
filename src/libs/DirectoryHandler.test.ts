import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('fs', async () => {
  const fsMock = {
    rmSync: vi.fn(),
    existsSync: vi.fn(() => true),
  };

  return {
    ...fsMock,
    default: fsMock,
  };
});

vi.mock('./Logger', () => ({
  Logger: {
    getInstance: () => ({
      log: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    }),
  },
}));

vi.mock('@ethersphere/bee-js', () => ({
  Bee: vi.fn(() => ({
    uploadData: vi.fn().mockResolvedValue({ reference: { toHex: () => 'mockRef' } }),
    gsocSend: vi.fn().mockResolvedValue({ reference: { toHex: () => 'gsocRef' } }),
  })),
}));

vi.mock('../utils/common', async () => {
  return {
    retryAwaitableAsync: vi.fn(async (fn: () => Promise<any>) => {
      return await fn();
    }),
    getEnvVariable: vi.fn(
      (key: string) =>
        ({
          SWARM_RPC_URL: 'http://mocked-url',
          STREAM_KEY: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          STAMP: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          GSOC_RESOURCE_ID: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          GSOC_TOPIC: 'mock-topic',
        }[key]),
    ),
  };
});

const startMock = vi.fn();
const closeMock = vi.fn();
const swarmStreamUploaderMock = vi.fn();

vi.mock('./MediaWatcher', () => ({
  MediaWatcher: vi.fn().mockImplementation((p, cb) => ({
    start: () => {
      cb('/mock/path/file.ts');
      startMock();
    },
    close: closeMock,
  })),
}));

vi.mock('./SwarmStreamUploader', () => ({
  SwarmStreamUploader: vi.fn().mockImplementation((bee, rpcUrl, resId, topic, key, stamp, path, mediatype) => {
    swarmStreamUploaderMock(bee, rpcUrl, resId, topic, key, stamp, path, mediatype);
    return {
      onSegmentUpdate: vi.fn(),
      onManifestUpdate: vi.fn(),
      broadcastStart: vi.fn().mockResolvedValue(undefined),
      broadcastStop: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

import fs from 'fs';
import path from 'path';

import { DirectoryHandler } from './DirectoryHandler.js';

describe('DirectoryHandler', () => {
  const basePath = '/mock';
  const audioStreamPath =
    '/audio/test?exp=1745855645&sign=2db33d7b239b628d08b51d2be7951c373dff7a223a4687e0fef5d82d9f191138';
  const videoStreamPath =
    '/video/test?exp=1745855645&sign=2db33d7b239b628d08b51d2be7951c373dff7a223a4687e0fef5d82d9f191138';
  const audioFullPath = path.join(basePath, audioStreamPath);
  const videoFullPath = path.join(basePath, videoStreamPath);
  let handler: DirectoryHandler;

  beforeEach(() => {
    handler = DirectoryHandler.getInstance();
    vi.clearAllMocks();
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
