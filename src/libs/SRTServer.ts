import { ChildProcess, execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import { DirectoryHandler } from './DirectoryHandler.js';
import { Logger } from './Logger.js';

const logger = Logger.getInstance();

// --- Config interfaces ---

export interface SrtTask {
  app: 'video' | 'audio';
  hls: boolean;
  hlsTime: number;
  hlsListSize: number;
  vc?: string;
  ac?: string;
  ab?: string;
  vcParam?: string[];
  extraArgs?: string[];
}

export interface SrtServerConfig {
  srt: {
    port: number;
    pkt_size: number;
    latency: number;
    passphrase?: string;
  };
  trans: {
    ffmpeg: string;
    tasks: SrtTask[];
  };
}

export interface SrtServerHandle {
  close(): Promise<void>;
}

// --- Helpers ---

const APP_PORT_OFFSET: Record<string, number> = { video: 0, audio: 1 };

function resolveFFmpegPath(providedPath?: string): string {
  if (providedPath) {
    return providedPath;
  }

  try {
    const defaultPath = execSync('which ffmpeg').toString().trim();
    logger.info('ffmpeg path is not provided, using default path:', defaultPath);
    return defaultPath;
  } catch (error) {
    logger.error('ffmpeg not found, path is required');
    throw error;
  }
}

function checkFFmpegVersion(ffmpegPath: string): void {
  try {
    execSync(`${ffmpegPath} -version`).toString().trim();
  } catch (error) {
    logger.error('FFmpeg is not installed or not found in the specified path.');
    throw error;
  }
}

export function buildFFmpegArgs(task: SrtTask, srtConfig: SrtServerConfig['srt'], outputDir: string): string[] {
  const port = srtConfig.port + (APP_PORT_OFFSET[task.app] ?? 0);
  const latencyUs = srtConfig.latency * 1000;

  let srtUrl = `srt://:${port}?listener=1&pkt_size=${srtConfig.pkt_size}&latency=${latencyUs}`;
  if (srtConfig.passphrase) {
    srtUrl += `&passphrase=${srtConfig.passphrase}`;
  }

  const args: string[] = ['-y', '-f', 'mpegts', '-i', srtUrl];

  if (task.vcParam) {
    args.push(...task.vcParam);
  } else {
    args.push('-c:v', task.vc || 'copy');
  }

  args.push('-c:a', task.ac || 'aac');
  if (task.ab) {
    args.push('-b:a', task.ab);
  }

  if (task.extraArgs) {
    args.push(...task.extraArgs);
  }

  if (task.hls) {
    args.push('-f', 'hls', '-hls_time', String(task.hlsTime), '-hls_list_size', String(task.hlsListSize));
  }

  args.push(path.join(outputDir, 'index.m3u8'));

  return args;
}

// --- Per-task FFmpeg process handler ---

class FFmpegStreamHandler {
  private ffmpeg: ChildProcess | null = null;
  private streamPath: string | null = null;
  private isStreaming = false;
  private shouldRestart = true;
  private exitPromise: Promise<void> = Promise.resolve();
  private resolveExit: (() => void) | null = null;

  constructor(
    private task: SrtTask,
    private srtConfig: SrtServerConfig['srt'],
    private mediaRootPath: string,
    private ffmpegPath: string,
    private dirHandler: DirectoryHandler,
  ) {}

  start(): void {
    this.shouldRestart = true;
    this.spawnListener();
  }

  private spawnListener(): void {
    const streamName = `stream_${Date.now()}`;
    this.streamPath = `/${this.task.app}/${streamName}`;
    const outputDir = path.join(this.mediaRootPath, this.streamPath);
    fs.mkdirSync(outputDir, { recursive: true });

    const args = buildFFmpegArgs(this.task, this.srtConfig, outputDir);
    this.ffmpeg = spawn(this.ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.isStreaming = false;

    this.exitPromise = new Promise(resolve => {
      this.resolveExit = resolve;
    });

    const port = this.srtConfig.port + (APP_PORT_OFFSET[this.task.app] ?? 0);
    logger.info(`[SRT:${this.task.app}] FFmpeg listening on port ${port}`);

    this.ffmpeg.stderr?.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      if (line) {
        logger.debug(`[FFmpeg:${this.task.app}] ${line}`);
      }
      if (!this.isStreaming && line.includes('Output #0')) {
        this.onStreamStart();
      }
    });

    this.ffmpeg.on('close', async code => {
      logger.info(`[FFmpeg:${this.task.app}] Process exited (code: ${code})`);
      try {
        await this.onStreamEnd();
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`[SRT:${this.task.app}] Cleanup error: ${msg}`);
      }
      this.resolveExit?.();

      if (this.shouldRestart) {
        logger.info(`[SRT:${this.task.app}] Restarting FFmpeg listener...`);
        setTimeout(() => this.spawnListener(), 1000);
      }
    });

    this.ffmpeg.on('error', err => {
      logger.error(`[FFmpeg:${this.task.app}] Process error: ${err.message}`);
    });
  }

  private onStreamStart(): void {
    if (this.isStreaming || !this.streamPath) {
      return;
    }
    this.isStreaming = true;

    try {
      this.dirHandler.acquireDirectory(this.mediaRootPath, this.streamPath);
      this.dirHandler.handleStart(this.mediaRootPath, this.streamPath);
      logger.info(`[SRT:${this.task.app}] Stream started: ${this.streamPath}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[SRT:${this.task.app}] Error: ${msg}`);
    }
  }

  private async onStreamEnd(): Promise<void> {
    if (this.isStreaming && this.streamPath) {
      await this.dirHandler.handleStop(this.mediaRootPath, this.streamPath);
      this.dirHandler.releaseDirectory(this.mediaRootPath, this.streamPath);
      logger.info(`[SRT:${this.task.app}] Stream ended: ${this.streamPath}`);
    } else if (this.streamPath) {
      const fullPath = path.join(this.mediaRootPath, this.streamPath);
      if (fs.existsSync(fullPath)) {
        fs.rmSync(fullPath, { recursive: true, force: true });
      }
    }

    this.isStreaming = false;
    this.streamPath = null;
    this.ffmpeg = null;
  }

  async stop(): Promise<void> {
    this.shouldRestart = false;

    if (!this.ffmpeg) {
      return;
    }

    this.ffmpeg.kill('SIGTERM');
    const timeout = setTimeout(() => this.ffmpeg?.kill('SIGKILL'), 5000);

    await this.exitPromise;
    clearTimeout(timeout);
  }
}

// --- Public API ---

export function stopSrtServer(handle: SrtServerHandle): Promise<void> {
  return handle.close();
}

export function startSrtServer(mRootPath: string, providedFFmpegPath: string): SrtServerHandle | undefined {
  if (!mRootPath) {
    logger.error('Media root path is required.');
    return;
  }

  const mediaRootPath = path.resolve(mRootPath);
  const ffmpegPath = resolveFFmpegPath(providedFFmpegPath);
  checkFFmpegVersion(ffmpegPath);

  const srtPort = parseInt(process.env.SRT_PORT || '9000', 10);
  const srtPassphrase = process.env.SRT_PASSPHRASE || undefined;

  const config: SrtServerConfig = {
    srt: {
      port: srtPort,
      pkt_size: 1316,
      latency: 200,
      passphrase: srtPassphrase,
    },
    trans: {
      ffmpeg: ffmpegPath,
      tasks: [
        { app: 'video', hls: true, hlsTime: 1.5, hlsListSize: 15 },
        { app: 'audio', hls: true, hlsTime: 1.5, hlsListSize: 15, ac: 'aac', ab: '128k', vcParam: ['-vn'] },
      ],
    },
  };

  const dirHandler = DirectoryHandler.getInstance();
  const handlers: FFmpegStreamHandler[] = [];

  for (const task of config.trans.tasks) {
    const handler = new FFmpegStreamHandler(task, config.srt, mediaRootPath, ffmpegPath, dirHandler);
    handler.start();
    handlers.push(handler);
  }

  logger.info('SRT server started successfully');

  return {
    async close() {
      await Promise.all(handlers.map(h => h.stop()));
      logger.info('SRT server stopped');
    },
  };
}
