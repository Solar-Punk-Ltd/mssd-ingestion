import { beforeAll, beforeEach, describe, expect, it, Mock, vi } from 'vitest';

vi.mock('../libs/Logger', () => {
  const mockLogger = {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    log: vi.fn(),
  };

  return {
    Logger: {
      getInstance: () => mockLogger,
    },
  };
});

vi.mock('child_process', () => ({
  execSync: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('fs', async () => {
  const fsMock = {
    mkdirSync: vi.fn(),
    existsSync: vi.fn(() => false),
    rmSync: vi.fn(),
  };

  return {
    ...fsMock,
    default: fsMock,
  };
});

vi.mock('./DirectoryHandler', () => ({
  DirectoryHandler: {
    getInstance: vi.fn(() => ({
      acquireDirectory: vi.fn(),
      releaseDirectory: vi.fn(),
      handleStart: vi.fn(),
      handleStop: vi.fn().mockResolvedValue(undefined),
    })),
  },
}));

import { execSync, spawn } from 'child_process';
import path from 'path';

import { Logger } from '../libs/Logger.js';

import { buildFFmpegArgs, SrtServerConfig, SrtTask, startSrtServer } from './SRTServer.js';

const mockLogger = Logger.getInstance();

describe('SRTServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SRT_PORT;
    delete process.env.SRT_PASSPHRASE;
  });

  describe('buildFFmpegArgs', () => {
    const srtConfig: SrtServerConfig['srt'] = {
      port: 9000,
      pkt_size: 1316,
      latency: 200,
    };

    it('should build correct args for video task', () => {
      const task: SrtTask = { app: 'video', hls: true, hlsTime: 2, hlsListSize: 10 };
      const args = buildFFmpegArgs(task, srtConfig, '/output/video/stream_1');

      expect(args).toContain('-y');
      expect(args).toContain('-f');
      expect(args).toContain('mpegts');
      expect(args).toContain('-c:v');
      expect(args).toContain('copy');
      expect(args).toContain('-c:a');
      expect(args).toContain('aac');
      expect(args).toContain('-hls_time');
      expect(args).toContain('2');
      expect(args).toContain('-hls_list_size');
      expect(args).toContain('10');

      const srtUrl = args[args.indexOf('-i') + 1];
      expect(srtUrl).toContain('srt://:9000');
      expect(srtUrl).toContain('listener=1');
      expect(srtUrl).toContain('pkt_size=1316');
      expect(srtUrl).toContain('latency=200000');
      expect(srtUrl).not.toContain('passphrase');

      expect(args[args.length - 1]).toBe(path.join('/output/video/stream_1', 'index.m3u8'));
    });

    it('should build correct args for audio task with -vn', () => {
      const task: SrtTask = {
        app: 'audio',
        hls: true,
        hlsTime: 2,
        hlsListSize: 10,
        ac: 'aac',
        ab: '128k',
        vcParam: ['-vn'],
      };
      const args = buildFFmpegArgs(task, srtConfig, '/output/audio/stream_1');

      expect(args).toContain('-vn');
      expect(args).not.toContain('-c:v');
      expect(args).toContain('-c:a');
      expect(args).toContain('aac');
      expect(args).toContain('-b:a');
      expect(args).toContain('128k');

      const srtUrl = args[args.indexOf('-i') + 1];
      expect(srtUrl).toContain('srt://:9001');
    });

    it('should include passphrase in SRT URL when configured', () => {
      const configWithPassphrase: SrtServerConfig['srt'] = {
        ...srtConfig,
        passphrase: 'mysecret',
      };
      const task: SrtTask = { app: 'video', hls: true, hlsTime: 2, hlsListSize: 10 };
      const args = buildFFmpegArgs(task, configWithPassphrase, '/output');

      const srtUrl = args[args.indexOf('-i') + 1];
      expect(srtUrl).toContain('passphrase=mysecret');
    });

    it('should include extra args when provided', () => {
      const task: SrtTask = {
        app: 'video',
        hls: true,
        hlsTime: 2,
        hlsListSize: 10,
        extraArgs: ['-preset', 'fast'],
      };
      const args = buildFFmpegArgs(task, srtConfig, '/output');

      expect(args).toContain('-preset');
      expect(args).toContain('fast');
    });

    it('should use custom video codec when specified', () => {
      const task: SrtTask = { app: 'video', hls: true, hlsTime: 2, hlsListSize: 10, vc: 'libx264' };
      const args = buildFFmpegArgs(task, srtConfig, '/output');

      expect(args).toContain('-c:v');
      expect(args).toContain('libx264');
    });
  });

  describe('startSrtServer', () => {
    const mockOn = vi.fn();
    const mockStdin = { write: vi.fn(), end: vi.fn() };
    const mockStderr = { on: vi.fn() };
    const mockKill = vi.fn();

    beforeAll(() => {
      (spawn as Mock).mockReturnValue({
        on: mockOn,
        kill: mockKill,
        stdin: mockStdin,
        stdout: { on: vi.fn() },
        stderr: mockStderr,
      });
    });

    beforeEach(() => {
      vi.clearAllMocks();
      (spawn as Mock).mockReturnValue({
        on: mockOn,
        kill: mockKill,
        stdin: mockStdin,
        stdout: { on: vi.fn() },
        stderr: mockStderr,
      });
    });

    it('should log an error if mediaRootPath is not provided', () => {
      (execSync as Mock).mockReturnValue(Buffer.from('ffmpeg version 6.0'));
      startSrtServer('', '/path/to/ffmpeg');
      expect(mockLogger.error).toHaveBeenCalledWith('Media root path is required.');
      expect(spawn).not.toHaveBeenCalled();
    });

    it('should throw if ffmpegPath is not provided and ffmpeg is not found', () => {
      (execSync as Mock).mockImplementation(() => {
        throw new Error('FFmpeg not found');
      });

      expect(() => startSrtServer('/path/to/media', '')).toThrow('FFmpeg not found');
      expect(mockLogger.error).toHaveBeenCalledWith('ffmpeg not found, path is required');
    });

    it('should throw if ffmpeg version check fails', () => {
      (execSync as Mock).mockImplementation((cmd: string) => {
        if (cmd === 'which ffmpeg') {
          return Buffer.from('/usr/bin/ffmpeg');
        }
        throw new Error('FFmpeg not found');
      });

      expect(() => startSrtServer('/path/to/media', '')).toThrow('FFmpeg not found');
      expect(mockLogger.error).toHaveBeenCalledWith('FFmpeg is not installed or not found in the specified path.');
    });

    it('should spawn two FFmpeg processes for video and audio', () => {
      (execSync as Mock).mockReturnValue(Buffer.from('ffmpeg version 6.0'));

      const handle = startSrtServer('/path/to/media', '/path/to/ffmpeg');

      expect(handle).toBeDefined();
      expect(spawn).toHaveBeenCalledTimes(2);

      const firstCall = (spawn as Mock).mock.calls[0];
      const secondCall = (spawn as Mock).mock.calls[1];

      expect(firstCall[0]).toBe('/path/to/ffmpeg');
      expect(firstCall[1].join(' ')).toContain('srt://:9000');

      expect(secondCall[0]).toBe('/path/to/ffmpeg');
      expect(secondCall[1].join(' ')).toContain('srt://:9001');
    });

    it('should use custom SRT_PORT from env', () => {
      process.env.SRT_PORT = '8000';
      (execSync as Mock).mockReturnValue(Buffer.from('ffmpeg version 6.0'));

      startSrtServer('/path/to/media', '/path/to/ffmpeg');

      const firstCall = (spawn as Mock).mock.calls[0];
      const secondCall = (spawn as Mock).mock.calls[1];

      expect(firstCall[1].join(' ')).toContain('srt://:8000');
      expect(secondCall[1].join(' ')).toContain('srt://:8001');
    });

    it('should include passphrase when SRT_PASSPHRASE is set', () => {
      process.env.SRT_PASSPHRASE = 'secret123';
      (execSync as Mock).mockReturnValue(Buffer.from('ffmpeg version 6.0'));

      startSrtServer('/path/to/media', '/path/to/ffmpeg');

      const firstCall = (spawn as Mock).mock.calls[0];
      expect(firstCall[1].join(' ')).toContain('passphrase=secret123');
    });

    it('should return a handle with close method', async () => {
      (execSync as Mock).mockReturnValue(Buffer.from('ffmpeg version 6.0'));

      const handle = startSrtServer('/path/to/media', '/path/to/ffmpeg');

      expect(handle).toBeDefined();
      expect(typeof handle?.close).toBe('function');
    });

    it('should register error and close handlers on FFmpeg processes', () => {
      (execSync as Mock).mockReturnValue(Buffer.from('ffmpeg version 6.0'));

      startSrtServer('/path/to/media', '/path/to/ffmpeg');

      const registeredEvents = mockOn.mock.calls.map(call => call[0]);
      expect(registeredEvents).toContain('close');
      expect(registeredEvents).toContain('error');
    });
  });
});
