import { execSync } from 'child_process';
import crypto from 'crypto';
import NodeMediaServer from 'node-media-server';
import path from 'path';

import { getEnvVariable } from '../utils/common';

import { DirectoryHandler } from './DirectoryHandler';
import { Logger } from './Logger';

const logger = Logger.getInstance();

function resolveFFmpegPath(providedPath?: string) {
  if (providedPath) return providedPath;

  try {
    const defaultPath = execSync('which ffmpeg').toString().trim();
    logger.info('ffmpeg path is not provided, using default path:', defaultPath);
    return defaultPath;
  } catch (error) {
    logger.error('ffmpeg not found, path is required');
    throw error;
  }
}

function checkFFmpegVersion(ffmpegPath: string) {
  try {
    const versionOutput = execSync(`${ffmpegPath} -version`).toString().trim();
    // Assigning the FFmpeg version to a global variable.
    // This is required because the `NodeTransServer` in the `node-media-server`
    // package internally references a `version` variable in its `run` method,
    // and there is no direct way to inject it into the package's scope.
    // Using `(global as any)` is a workaround to make the `version` variable
    // accessible globally.
    // Note: Consider refactoring if the `node-media-server` package
    // provides a better way to handle this in the future.
    (global as any).version = versionOutput;
  } catch (error) {
    logger.error('FFmpeg is not installed or not found in the specified path.');
    throw error;
  }
}

function authenticateStream(streamPath: string, args: Record<string, any>, session: any) {
  const { sign, exp } = args;
  if (!streamPath.startsWith('/video/') && !streamPath.startsWith('/audio/')) {
    const errorMessage = `The stream must be either video or audio: ${streamPath}`;
    throw new Error(errorMessage);
  }
  const stream = streamPath.split('/')[2];
  const secret = getEnvVariable('RTMP_SECRET');

  if (!secret || !stream || !sign || !exp) {
    logger.error(`Unauthorized stream: missing parameters`);
    session?.reject();
    return;
  }

  const expectedSign = crypto.createHmac('sha256', secret).update(`${stream}?exp=${exp}`).digest('hex');
  const currentTime = Math.floor(Date.now() / 1000);

  if (expectedSign !== sign || parseInt(exp, 10) < currentTime) {
    logger.error(`Unauthorized stream: invalid or expired signature`);
    session?.reject();
  }
}

export function startRtmpServer(mRootPath: string, providedFFmpegPath: string): void {
  if (!mRootPath) {
    logger.error('Media root path is required.');
    return;
  }

  const mediaRootPath = path.resolve(__dirname, '..', 'media');

  const ffmpegPath = resolveFFmpegPath(providedFFmpegPath);
  checkFFmpegVersion(ffmpegPath);

  const config = {
    logType: 3,
    rtmp: { port: 1935, chunk_size: 60000, gop_cache: true, ping: 30, ping_timeout: 60 },
    http: { port: 8000, allow_origin: '*', mediaroot: mediaRootPath },
    trans: {
      ffmpeg: ffmpegPath,
      tasks: [
        { app: 'video', hls: true, hlsKeep: true, hlsFlags: '[hls_time=5:hls_list_size=10:hls_flags=delete_segments]' },
        {
          app: 'audio',
          hls: true,
          hlsKeep: true,
          hlsFlags: '[hls_time=5:hls_list_size=10:hls_flags=delete_segments]',
          ac: 'aac',
          ab: '128k',
          mp4: false,
          vc: 'none',
          vcParam: ['-vn'],
        },
      ],
    },
  };

  const dirHandler = DirectoryHandler.getInstance();
  const nms = new NodeMediaServer(config);

  nms.on('prePublish', (id, streamPath, args) => {
    logger.info('[prePublish]', id, streamPath, args);
    const session = nms.getSession(id);

    try {
      authenticateStream(streamPath, args, session);
      dirHandler.acquireDirectory(mediaRootPath, streamPath);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[prePublish] Error: ${errorMessage}`);
      session.reject();
    }
  });

  nms.on('postPublish', (id, streamPath) => {
    logger.info('[postPublish]', id, streamPath);
    dirHandler.handleStart(mediaRootPath, streamPath);
  });

  nms.on('donePublish', (id, streamPath, args) => {
    logger.info('[donePublish]', id, streamPath, args);
    dirHandler.handleStop(mediaRootPath, streamPath).then(() => {
      dirHandler.releaseDirectory(mediaRootPath, streamPath);
    });
  });

  ['preConnect', 'postConnect', 'doneConnect', 'prePlay', 'postPlay', 'donePlay'].forEach(event => {
    nms.on(event, (id, streamPath, args) => {
      logger.info(`[${event}]`, id, streamPath, args);
    });
  });

  nms.run();
}
