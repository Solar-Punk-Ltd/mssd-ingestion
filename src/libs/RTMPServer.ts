import { execSync } from 'child_process';
import crypto from 'crypto';
import NodeMediaServer from 'node-media-server';
import path from 'path';

import { sleep } from '../utils/common';

import { Logger } from './Logger';

const logger = Logger.getInstance();

let fullStreamPath: string | null = null;

export async function waitForStreamPath() {
  while (!fullStreamPath) {
    await sleep(5000);
  }
  return fullStreamPath;
}

function resolveFFmpegPath(providedPath?: string) {
  if (providedPath) return providedPath;

  try {
    const defaultPath = execSync('which ffmpeg').toString().trim();
    logger.log('ffmpeg path is not provided, using default path:', defaultPath);
    return defaultPath;
  } catch (error) {
    logger.error('ffmpeg not found, path is required');
    throw error;
  }
}

function checkFFmpegVersion(ffmpegPath: string) {
  try {
    const versionOutput = execSync(`${ffmpegPath} -version`).toString().trim();
    (global as any).version = versionOutput;
  } catch (error) {
    logger.error('FFmpeg is not installed or not found in the specified path.');
    throw error;
  }
}

function authenticateStream(streamPath: string, args: Record<string, any>, session: any) {
  const { sign, exp } = args;
  const stream = streamPath.split('/')[2];
  const secret = process.env['RTMP_SECRET'];

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

export function startRtmpServer(mediaRootPath: string, providedFFmpegPath: string): void {
  if (!mediaRootPath) {
    logger.error('Media root path is required.');
    return;
  }

  const ffmpegPath = resolveFFmpegPath(providedFFmpegPath);
  checkFFmpegVersion(ffmpegPath);

  const config = {
    logType: 3,
    rtmp: { port: 1935, chunk_size: 60000, gop_cache: true, ping: 30, ping_timeout: 60 },
    http: { port: 8000, allow_origin: '*', mediaroot: mediaRootPath },
    trans: {
      ffmpeg: ffmpegPath,
      tasks: [{ app: 'live', hls: true, hlsKeep: true, hlsFlags: '[hls_time=5:hls_list_size=20]' }],
    },
  };

  const nms = new NodeMediaServer(config);

  nms.on('prePublish', (id, streamPath, args) => authenticateStream(streamPath, args, nms.getSession(id)));

  nms.on('postPublish', (id, streamPath) => {
    fullStreamPath = path.join(mediaRootPath, streamPath);
    logger.log('[postPublish]', id, streamPath);
  });

  ['preConnect', 'postConnect', 'doneConnect', 'donePublish', 'prePlay', 'postPlay', 'donePlay'].forEach(event => {
    nms.on(event, (id, streamPath, args) => {
      logger.log(`[${event}]`, id, streamPath, args);
    });
  });

  nms.run();
}
