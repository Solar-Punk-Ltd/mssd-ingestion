import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
      warn: vi.fn(),
      debug: vi.fn(),
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
          BEE_URL: 'http://mocked-url',
          MANIFEST_ACCESS_URL: 'http://mocked-url/manifest',
          STREAM_KEY: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          STAMP: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          GSOC_RESOURCE_ID: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          GSOC_TOPIC: 'mock-topic',
        }[key]),
    ),
  };
});

const swarmStreamUploaderMock = vi.fn();

vi.mock('./SwarmStreamUploader', () => ({
  SwarmStreamUploader: vi.fn().mockImplementation((bee, rpcUrl, resId, topic, key, stamp, path, mediatype) => {
    swarmStreamUploaderMock(bee, rpcUrl, resId, topic, key, stamp, path, mediatype);
    return {
      onSegmentUpdate: vi.fn(),
      onManifestUpdate: vi.fn(),
      broadcastStart: vi.fn().mockResolvedValue(undefined),
      broadcastStop: vi.fn().mockResolvedValue(undefined),
      waitForStreamDrain: vi.fn().mockResolvedValue(undefined),
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

  afterEach(async () => {
    await handler.cleanup();
  });

  it('should acquire directory successfully', async () => {
    await handler.acquireDirectory(basePath, audioStreamPath);
    await expect(handler.acquireDirectory(basePath, audioStreamPath)).rejects.toThrow(
      `Directory ${audioFullPath} is already in use.`,
    );
  });

  it('should release directory successfully', async () => {
    handler.releaseDirectory(basePath, audioStreamPath);

    await handler.acquireDirectory(basePath, audioStreamPath);
    handler.releaseDirectory(basePath, audioStreamPath);
    await expect(handler.acquireDirectory(basePath, audioStreamPath)).resolves.not.toThrow();
  });

  it('should start handling audio stream directory and pass mediatype as audio', async () => {
    handler.handleStart(basePath, audioStreamPath);
    await new Promise(resolve => setTimeout(resolve, 200));

    expect(swarmStreamUploaderMock).toHaveBeenCalledWith(
      expect.any(Object), // Bee instance
      'http://mocked-url/manifest',
      '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      'mock-topic',
      '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      audioFullPath,
      'audio',
    );
  });

  it('should start handling video stream directory and pass mediatype as video', async () => {
    handler.handleStart(basePath, videoStreamPath);
    await new Promise(resolve => setTimeout(resolve, 200));

    expect(swarmStreamUploaderMock).toHaveBeenCalledWith(
      expect.any(Object), // Bee instance
      'http://mocked-url/manifest',
      '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      'mock-topic',
      '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      videoFullPath,
      'video',
    );
  });

  it('should stop handling directory and clean up properly', async () => {
    await handler.acquireDirectory(basePath, audioStreamPath);
    handler.handleStart(basePath, audioStreamPath);
    await new Promise(resolve => setTimeout(resolve, 200));

    await handler.handleStop(basePath, audioStreamPath);

    expect(fs.rmSync).toHaveBeenCalledWith(audioFullPath, { recursive: true, force: true });
  });

  it('should handle stop gracefully when no uploader exists', async () => {
    await expect(handler.handleStop(basePath, audioStreamPath)).resolves.not.toThrow();
  });

  it('should allow re-use of stream path after clean stop', async () => {
    await handler.acquireDirectory(basePath, audioStreamPath);
    handler.handleStart(basePath, audioStreamPath);
    await new Promise(resolve => setTimeout(resolve, 200));

    await handler.handleStop(basePath, audioStreamPath);

    // Should be able to start again on the same path
    await handler.acquireDirectory(basePath, audioStreamPath);
    expect(() => handler.handleStart(basePath, audioStreamPath)).not.toThrow();
  });

  it('should wait for drain before acquiring same path', async () => {
    await handler.acquireDirectory(basePath, audioStreamPath);
    handler.handleStart(basePath, audioStreamPath);
    await new Promise(resolve => setTimeout(resolve, 200));

    // Start drain in background (non-blocking like the webhook does)
    const stopPromise = handler.handleStop(basePath, audioStreamPath);

    // Acquire should wait for drain, not throw
    const acquirePromise = handler.acquireDirectory(basePath, audioStreamPath);

    await stopPromise;
    await expect(acquirePromise).resolves.not.toThrow();
  });

  it('should reject concurrent acquire on same active path', async () => {
    await handler.acquireDirectory(basePath, audioStreamPath);
    handler.handleStart(basePath, audioStreamPath);

    // Second acquire while first is active (not draining) should throw
    await expect(handler.acquireDirectory(basePath, audioStreamPath)).rejects.toThrow('already in use');
  });
});
