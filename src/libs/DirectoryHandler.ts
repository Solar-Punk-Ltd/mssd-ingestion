import { Bee } from '@ethersphere/bee-js';
import fs from 'fs';
import path from 'path';

import { getEnvVariable } from '../utils/common';

import { Logger } from './Logger';
import { MediaWatcher } from './MediaWatcher';
import { Queue } from './Queue';
import { SwarmStreamUploader } from './SwarmStreamUploader';

const SWARM_RPC_URL = getEnvVariable('SWARM_RPC_URL');
const STREAM_KEY = getEnvVariable('STREAM_KEY');
const STAMP = getEnvVariable('STAMP');
const GSOC_RESOURCE_ID = getEnvVariable('GSOC_RESOURCE_ID');
const GSOC_TOPIC = getEnvVariable('GSOC_TOPIC');

export class DirectoryHandler {
  private logger = Logger.getInstance();
  private queue: Queue;

  private static instance: DirectoryHandler;

  private static activeStreams = new Set<string>();
  private static uploaders = new Map<string, SwarmStreamUploader>();
  private static watchers = new Map<string, MediaWatcher>();

  private constructor() {
    this.queue = new Queue();
  }

  public static getInstance(): DirectoryHandler {
    if (!DirectoryHandler.instance) {
      DirectoryHandler.instance = new DirectoryHandler();
    }
    return DirectoryHandler.instance;
  }

  public acquireDirectory(mediaRootPath: string, streamPath: string) {
    const fullPath = path.join(mediaRootPath, streamPath);

    if (DirectoryHandler.activeStreams.has(fullPath)) {
      throw new Error(`Directory ${fullPath} is already in use.`);
    }
    DirectoryHandler.activeStreams.add(fullPath);
  }

  public releaseDirectory(mediaRootPath: string, streamPath: string): void {
    const fullPath = path.join(mediaRootPath, streamPath);
    DirectoryHandler.activeStreams.delete(fullPath);
  }

  public handleStart(mediaRootPath: string, streamPath: string): void {
    const fullPath = path.join(mediaRootPath, streamPath);
    if (!streamPath.startsWith('/audio') && !streamPath.startsWith('/video')) {
      throw new Error(`Invalid streamPath: ${streamPath}. Must start with '/audio' or '/video'.`);
    }
    const mediatype = streamPath.startsWith('/audio') ? 'audio' : 'video';
    this.logger.info(`Handling directory: ${fullPath} with mediatype: ${mediatype}`);

    this.queue.enqueue(async () => {
      try {
        // TODO: support rpc and owned nodes
        const bee = new Bee(`${SWARM_RPC_URL}/write`);
        const uploader = new SwarmStreamUploader(
          bee,
          SWARM_RPC_URL,
          GSOC_RESOURCE_ID,
          GSOC_TOPIC,
          STREAM_KEY,
          STAMP,
          fullPath,
          mediatype,
        );
        const watcher = new MediaWatcher(fullPath, uploader.upload.bind(uploader));

        watcher.start();
        await uploader.broadcastStart();

        DirectoryHandler.uploaders.set(fullPath, uploader);
        DirectoryHandler.watchers.set(fullPath, watcher);
      } catch (error) {
        this.logger.error(`Error handling directory ${fullPath}:`, error);
      }
    });
  }

  public async handleStop(mediaRootPath: string, streamPath: string): Promise<void> {
    const fullPath = path.join(mediaRootPath, streamPath);
    const uploader = DirectoryHandler.uploaders.get(fullPath);
    const watcher = DirectoryHandler.watchers.get(fullPath);

    if (watcher) {
      watcher.close();
      DirectoryHandler.watchers.delete(fullPath);
    }

    if (uploader) {
      await uploader.broadcastStop();
      DirectoryHandler.uploaders.delete(fullPath);
    }

    if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath, { recursive: true, force: true });
    }

    this.logger.info(`Stopped handling directory: ${fullPath}`);
  }
}
