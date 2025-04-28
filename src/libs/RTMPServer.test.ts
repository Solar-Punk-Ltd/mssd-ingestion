const loggerMock = {
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
};

const errorHandlerMock = {
  handleError: jest.fn(),
};

const gentEnvMock = jest.fn();

jest.mock('./Logger', () => ({
  Logger: {
    getInstance: () => loggerMock,
  },
}));

jest.mock('./ErrorHandler', () => ({
  ErrorHandler: {
    getInstance: () => errorHandlerMock,
  },
}));

jest.mock('../utils/common', () => ({
  getEnvVariable: () => gentEnvMock,
}));

jest.mock('node-media-server');
jest.mock('child_process', () => ({
  execSync: jest.fn(),
}));

import { execSync } from 'child_process';
import NodeMediaServer from 'node-media-server';

import { startRtmpServer } from '../libs/RTMPServer';

describe('startRtmpServer', () => {
  const mockRun = jest.fn();
  const mockStop = jest.fn();
  const mockOn = jest.fn();
  const mockGetSession = jest.fn();

  beforeAll(() => {
    (NodeMediaServer as jest.Mock).mockImplementation(() => ({
      run: mockRun,
      stop: mockStop,
      on: mockOn,
      getSession: mockGetSession,
    }));
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should log an error if mediaRootPath is not provided', () => {
    startRtmpServer('', '/path/to/ffmpeg');
    expect(loggerMock.error).toHaveBeenCalledWith('Media root path is required.');
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('should log an error if ffmpegPath is not provided and FFmpeg is not installed', () => {
    (execSync as jest.Mock).mockImplementation(() => {
      throw new Error('FFmpeg not found');
    });

    expect(() => startRtmpServer('/path/to/media', '')).toThrow('FFmpeg not found');
    expect(loggerMock.error).toHaveBeenCalledWith('ffmpeg not found, path is required');
  });

  it('should log an error if FFmpeg is not installed or not found in the specified path', () => {
    (execSync as jest.Mock).mockImplementation(() => {
      throw new Error('FFmpeg not found');
    });

    expect(() => startRtmpServer('/path/to/media', '/path/to/ffmpeg')).toThrow('FFmpeg not found');
    expect(loggerMock.error).toHaveBeenCalledWith('FFmpeg is not installed or not found in the specified path.');
  });

  it('should start the NodeMediaServer if all parameters are valid', () => {
    (execSync as jest.Mock).mockImplementation(() => Buffer.from('ffmpeg version 2.7.4'));

    startRtmpServer('/path/to/media', '/path/to/ffmpeg');

    expect(execSync).toHaveBeenCalledWith('/path/to/ffmpeg -version');
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
        mediaroot: '/path/to/media',
      },
      trans: {
        ffmpeg: '/path/to/ffmpeg',
        tasks: [
          { app: 'video', hls: true, hlsKeep: true, hlsFlags: '[hls_time=5:hls_list_size=20]' },
          {
            app: 'audio',
            hls: true,
            hlsKeep: true,
            hlsFlags: '[hls_time=5:hls_list_size=20]',
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

  it('should handle prePublish event when not authorized', () => {
    gentEnvMock.mockReturnValue('secret');

    const mockSession = {
      reject: jest.fn(),
    };

    mockGetSession.mockReturnValue(mockSession);
    (execSync as jest.Mock).mockImplementation(() => Buffer.from('ffmpeg version 4.3'));

    startRtmpServer('/path/to/media', '/path/to/ffmpeg');

    const prePublishCallback = mockOn.mock.calls.find(call => call[0] === 'prePublish')?.[1];
    expect(prePublishCallback).toBeDefined();

    if (prePublishCallback) {
      prePublishCallback('123', '/video/stream', { key: 'value' });

      expect(loggerMock.error).toHaveBeenCalledWith('Unauthorized stream: missing parameters');
      expect(mockGetSession).toHaveBeenCalledWith('123');
      expect(mockSession.reject).toHaveBeenCalled();
    }
  });
});
