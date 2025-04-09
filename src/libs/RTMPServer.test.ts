const loggerMock = {
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
};

const errorHandlerMock = {
  handleError: jest.fn(),
};

jest.mock('../libs/Logger', () => ({
  Logger: {
    getInstance: () => loggerMock,
  },
}));

jest.mock('../libs/ErrorHandler', () => ({
  ErrorHandler: {
    getInstance: () => errorHandlerMock,
  },
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

  beforeAll(() => {
    (NodeMediaServer as jest.Mock).mockImplementation(() => ({
      run: mockRun,
      stop: mockStop,
      on: mockOn,
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

  it('should log an error if ffmpegPath is not provided', () => {
    startRtmpServer('/path/to/media', '');

    expect(loggerMock.error).toHaveBeenCalledWith('FFmpeg path is required.');
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('should handle error if FFmpeg is not installed', () => {
    (execSync as jest.Mock).mockImplementation(() => {
      throw new Error('FFmpeg not found');
    });

    startRtmpServer('/path/to/media', '/path/to/ffmpeg');

    expect(loggerMock.error).toHaveBeenCalledWith('FFmpeg is not installed or not found at the specified path.');
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('should start the NodeMediaServer if all parameters are valid', () => {
    (execSync as jest.Mock).mockImplementation(() => {}); // Mock FFmpeg check to pass

    startRtmpServer('/path/to/media', '/path/to/ffmpeg');

    expect(execSync).toHaveBeenCalledWith('/path/to/ffmpeg -version', { stdio: 'ignore' });
    expect(NodeMediaServer).toHaveBeenCalledWith({
      logType: 4,
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
          {
            app: 'live',
            hls: true,
            hlsKeep: true,
            hlsFlags: '[hls_time=5:hls_list_size=20]',
          },
        ],
      },
    });
    expect(mockRun).toHaveBeenCalled();
  });
});
