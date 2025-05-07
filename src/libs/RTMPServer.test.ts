import { beforeAll, beforeEach, describe, expect, it, Mock, vi } from 'vitest';

vi.mock('../libs/Logger', () => {
  const mockLogger = {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };

  return {
    Logger: {
      getInstance: () => mockLogger,
    },
  };
});

vi.mock('../utils/common', () => {
  const mockGetEnv = vi.fn();

  return {
    getEnvVariable: mockGetEnv,
  };
});

vi.mock('node-media-server');
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'child_process';
import NodeMediaServer from 'node-media-server';
import path from 'path';

import { Logger } from '../libs/Logger.js';
import { startRtmpServer } from '../libs/RTMPServer.js';
import { getEnvVariable } from '../utils/common.js';

const mockLogger = Logger.getInstance();
const mockGetEnv = getEnvVariable as Mock;

describe('startRtmpServer', () => {
  const mockRun = vi.fn();
  const mockStop = vi.fn();
  const mockOn = vi.fn();
  const mockGetSession = vi.fn();

  beforeAll(() => {
    (NodeMediaServer as Mock).mockImplementation(() => ({
      run: mockRun,
      stop: mockStop,
      on: mockOn,
      getSession: mockGetSession,
    }));
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should log an error if mediaRootPath is not provided', () => {
    startRtmpServer('', '/path/to/ffmpeg');
    expect(mockLogger.error).toHaveBeenCalledWith('Media root path is required.');
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('should log an error if ffmpegPath is not provided and FFmpeg is not installed', () => {
    (execSync as Mock).mockImplementation(() => {
      throw new Error('FFmpeg not found');
    });

    expect(() => startRtmpServer('/path/to/media', '')).toThrow('FFmpeg not found');
    expect(mockLogger.error).toHaveBeenCalledWith('ffmpeg not found, path is required');
  });

  it('should log an error if FFmpeg is not installed or not found in the specified path', () => {
    (execSync as Mock).mockImplementation(() => {
      throw new Error('FFmpeg not found');
    });

    expect(() => startRtmpServer('/path/to/media', '/path/to/ffmpeg')).toThrow('FFmpeg not found');
    expect(mockLogger.error).toHaveBeenCalledWith('FFmpeg is not installed or not found in the specified path.');
  });

  it('should start the NodeMediaServer if all parameters are valid', () => {
    (execSync as Mock).mockImplementation(() => Buffer.from('ffmpeg version 2.7.4'));

    startRtmpServer('/path/to/media', '/path/to/ffmpeg');

    expect(execSync).toHaveBeenCalledWith('/path/to/ffmpeg -version');

    const expectedMediaRoot = path.resolve(__dirname, '../media');
    expect(NodeMediaServer).toHaveBeenCalledWith({
      logType: 3,
      rtmp: {
        port: 1935,
        chunk_size: 60000,
        gop_cache: true,
        ping: 30,
        ping_timeout: 60,
      },
      http: {
        port: 8000,
        allow_origin: '*',
        mediaroot: expectedMediaRoot,
      },
      trans: {
        ffmpeg: '/path/to/ffmpeg',
        tasks: [
          {
            app: 'video',
            hls: true,
            hlsKeep: true,
            hlsFlags: '[hls_time=5:hls_list_size=10]',
          },
          {
            app: 'audio',
            hls: true,
            hlsKeep: true,
            hlsFlags: '[hls_time=5:hls_list_size=10]',
            ac: 'aac',
            ab: '128k',
            mp4: false,
            vc: 'none',
            vcParam: ['-vn'],
          },
        ],
      },
    });
    expect(mockRun).toHaveBeenCalled();
  });

  it('should handle prePublish event when streamPath is invalid', () => {
    mockGetEnv.mockReturnValue('secret');

    const mockSession = {
      reject: vi.fn(),
    };

    mockGetSession.mockReturnValue(mockSession);
    (execSync as Mock).mockImplementation(() => Buffer.from('ffmpeg version 4.3'));

    startRtmpServer('/path/to/media', '/path/to/ffmpeg');

    const prePublishCallback = mockOn.mock.calls.find(call => call[0] === 'prePublish')?.[1];
    expect(prePublishCallback).toBeDefined();

    if (prePublishCallback) {
      const invalidStreamPath = '/invalid/stream';
      prePublishCallback('123', invalidStreamPath, { exp: '12345', sign: 'valid-signature' });

      expect(mockLogger.error).toHaveBeenCalledWith(
        `[prePublish] Error: The stream must be either video or audio: ${invalidStreamPath}`,
      );
      expect(mockSession.reject).toHaveBeenCalled();
    }
  });
});
