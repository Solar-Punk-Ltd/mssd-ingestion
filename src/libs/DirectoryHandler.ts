import { Bee } from '@ethersphere/bee-js';
import fs from 'fs';
import PQueue from 'p-queue';
import path from 'path';

import { getEnvVariable, retryAwaitableAsync } from '../utils/common.js';

import { ErrorHandler } from './ErrorHandler.js';
import { Logger } from './Logger.js';
import { MediaWatcher } from './MediaWatcher.js';
import { SwarmStreamUploader } from './SwarmStreamUploader.js';

const BEE_URL = getEnvVariable('BEE_URL');
const MANIFEST_ACCESS_URL = getEnvVariable('MANIFEST_ACCESS_URL');
const STREAM_KEY = getEnvVariable('STREAM_KEY');
const STAMP = getEnvVariable('STAMP');
const GSOC_RESOURCE_ID = getEnvVariable('GSOC_RESOURCE_ID');
const GSOC_TOPIC = getEnvVariable('GSOC_TOPIC');

const WEEK_IN_MS = 7 * 24 * 60 * 60 * 1000;

export class DirectoryHandler {
  private logger = Logger.getInstance();
  private errorHandler = ErrorHandler.getInstance();
  private queue: PQueue;

  private static instance: DirectoryHandler;

  private static activeStreams = new Set<string>();
  private static uploaders = new Map<string, SwarmStreamUploader>();
  private static watchers = new Map<string, MediaWatcher>();
  private static usedStreamIds = new Set<string>();
  private static cleanupIntervalId: NodeJS.Timeout | null = null;

  private constructor() {
    this.queue = new PQueue({ concurrency: 1 });
    this.startWeeklyCleanup();
  }

  private startWeeklyCleanup(): void {
    if (DirectoryHandler.cleanupIntervalId) {
      clearInterval(DirectoryHandler.cleanupIntervalId);
    }

    DirectoryHandler.cleanupIntervalId = setInterval(() => {
      const previousSize = DirectoryHandler.usedStreamIds.size;
      DirectoryHandler.usedStreamIds.clear();
      this.logger.info(`Weekly cleanup: Cleared ${previousSize} used stream IDs from history`);
    }, WEEK_IN_MS);

    this.logger.info('Started weekly stream ID cleanup');
  }

  public static stopCleanup(): void {
    if (DirectoryHandler.cleanupIntervalId) {
      clearInterval(DirectoryHandler.cleanupIntervalId);
      DirectoryHandler.cleanupIntervalId = null;
    }
  }

  public static isStreamIdUsed(streamId: string): boolean {
    return DirectoryHandler.usedStreamIds.has(streamId);
  }

  public static clearUsedStreamIds(): void {
    DirectoryHandler.usedStreamIds.clear();
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
    const mediatype = streamPath.startsWith('/audio') ? 'audio' : 'video';

    if (DirectoryHandler.usedStreamIds.has(fullPath)) {
      throw new Error(
        `Stream path "${fullPath}" has already been used. Stream paths can only be used once per cleanup cycle.`,
      );
    }

    this.logger.info(`Handling directory: ${fullPath} with mediatype: ${mediatype}`);

    this.queue.add(async () => {
      try {
        const bee = new Bee(BEE_URL);
        const uploader = new SwarmStreamUploader(
          bee,
          MANIFEST_ACCESS_URL,
          GSOC_RESOURCE_ID,
          GSOC_TOPIC,
          STREAM_KEY,
          STAMP,
          fullPath,
          mediatype,
        );
        const watcher = new MediaWatcher(
          fullPath,
          uploader.onSegmentUpdate.bind(uploader),
          uploader.onManifestUpdate.bind(uploader),
        );

        watcher.start();

        DirectoryHandler.uploaders.set(fullPath, uploader);
        DirectoryHandler.watchers.set(fullPath, watcher);
        DirectoryHandler.usedStreamIds.add(fullPath);
        this.logger.info(`Stream path "${fullPath}" marked as used`);
      } catch (error) {
        this.logger.error(`Error handling directory ${fullPath}:`, error);
      }
    });
  }

  public async handleStop(mediaRootPath: string, streamPath: string): Promise<void> {
    const fullPath = path.join(mediaRootPath, streamPath);
    const uploader = DirectoryHandler.uploaders.get(fullPath);
    const watcher = DirectoryHandler.watchers.get(fullPath);

    await uploader?.waitForStreamDrain();

    await watcher?.close();
    DirectoryHandler.watchers.delete(fullPath);

    await uploader?.broadcastStop();
    DirectoryHandler.uploaders.delete(fullPath);

    DirectoryHandler.activeStreams.delete(fullPath);
    await this.deleteDirectorySafe(fullPath);

    this.logger.info(`Stopped handling directory: ${fullPath}`);
  }

  public async stopAllStreams(): Promise<void> {
    this.logger.info('Stopping all active streams...');

    const activeStreamPaths = Array.from(DirectoryHandler.activeStreams);

    await Promise.all(
      activeStreamPaths.map(async fullPath => {
        try {
          const pathParts = fullPath.split('/');
          const streamPath = '/' + pathParts.slice(-2).join('/');
          const mediaRootPath = pathParts.slice(0, -2).join('/');

          this.logger.info(`Force stopping stream: ${streamPath}`);
          await this.handleStop(mediaRootPath, streamPath);
          this.releaseDirectory(mediaRootPath, streamPath);
        } catch (error) {
          this.errorHandler.handleError(error, `DirectoryHandler.stopAllStreams - ${fullPath}`);
        }
      }),
    );

    DirectoryHandler.activeStreams.clear();
    DirectoryHandler.uploaders.clear();
    DirectoryHandler.watchers.clear();

    this.logger.info('All streams stopped');
  }

  public async cleanup(): Promise<void> {
    await this.stopAllStreams();
    await this.queue.onIdle();
    this.queue.clear();
  }

  private async deleteDirectorySafe(dirPath: string): Promise<void> {
    return retryAwaitableAsync(
      async () => {
        if (!fs.existsSync(dirPath)) {
          return;
        }

        fs.rmSync(dirPath, { recursive: true, force: true });
        this.logger.info(`Successfully deleted: ${dirPath}`);
      },
      10,
      1000,
    );
  }
}
