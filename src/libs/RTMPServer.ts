import { execSync } from 'child_process';
import NodeMediaServer from 'node-media-server';

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

export function startRtmpServer(mediaRootPath: string, ffmpegPath: string): void {
  if (!mediaRootPath) {
    logger.error('Media root path is required.');
    return;
  }

  if (!ffmpegPath) {
    logger.error('FFmpeg path is required.');
    return;
  }

  try {
    execSync(`${ffmpegPath} -version`, { stdio: 'ignore' });
  } catch {
    logger.error('FFmpeg is not installed or not found at the specified path.');
    return;
  }

  const config = {
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
      mediaroot: mediaRootPath,
    },
    trans: {
      ffmpeg: ffmpegPath,
      tasks: [
        {
          app: 'live',
          hls: true,
          hlsKeep: true,
          hlsFlags: '[hls_time=5:hls_list_size=20]',
        },
      ],
    },
  };

  const nms = new NodeMediaServer(config);

  nms.on('preConnect', (id: string, args: Record<string, any>) => {
    logger.log('[preConnect]', id, args);
  });

  nms.on('postConnect', (id: string, args: Record<string, any>) => {
    logger.log('[postConnect]', id, args);
  });

  nms.on('doneConnect', (id: string, args: Record<string, any>) => {
    logger.log('[doneConnect]', id, args);
  });

  nms.on('prePublish', (id: string, streamPath: string, args: Record<string, any>) => {
    logger.log('[prePublish]', id, streamPath, args);
  });

  nms.on('postPublish', (id: string, streamPath: string, args: Record<string, any>) => {
    fullStreamPath = `${mediaRootPath}/${streamPath}`;
    logger.log('[postPublish]', id, streamPath, args);
  });

  nms.on('donePublish', (id: string, streamPath: string, args: Record<string, any>) => {
    logger.log('[donePublish]', id, streamPath, args);
  });

  nms.on('prePlay', (id: string, streamPath: string, args: Record<string, any>) => {
    logger.log('[prePlay]', id, streamPath, args);
  });

  nms.on('postPlay', (id: string, streamPath: string, args: Record<string, any>) => {
    logger.log('[postPlay]', id, streamPath, args);
  });

  nms.on('donePlay', (id: string, streamPath: string, args: Record<string, any>) => {
    logger.log('[donePlay]', id, streamPath, args);
  });

  nms.run();
}
