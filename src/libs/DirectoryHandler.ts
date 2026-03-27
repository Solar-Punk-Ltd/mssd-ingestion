import { Bee } from '@ethersphere/bee-js';
import fs from 'fs';
import PQueue from 'p-queue';
import path from 'path';

import { getEnvVariable, retryAwaitableAsync } from '../utils/common.js';

import { ErrorHandler } from './ErrorHandler.js';
import { Logger } from './Logger.js';
import { SwarmStreamUploader } from './SwarmStreamUploader.js';

const BEE_URL = getEnvVariable('BEE_URL');
const MANIFEST_ACCESS_URL = getEnvVariable('MANIFEST_ACCESS_URL', '');
const STREAM_KEY = getEnvVariable('STREAM_KEY');
const STAMP = getEnvVariable('STAMP');
const GSOC_RESOURCE_ID = getEnvVariable('GSOC_RESOURCE_ID');
const GSOC_TOPIC = getEnvVariable('GSOC_TOPIC');

export class DirectoryHandler {
  private logger = Logger.getInstance();
  private errorHandler = ErrorHandler.getInstance();
  private queue: PQueue;

  private static instance: DirectoryHandler;

  private static activeStreams = new Set<string>();
  private static uploaders = new Map<string, SwarmStreamUploader>();
  private static drainPromises = new Map<string, Promise<void>>();

  private constructor() {
    this.queue = new PQueue({ concurrency: 1 });
  }

  public static getInstance(): DirectoryHandler {
    if (!DirectoryHandler.instance) {
      DirectoryHandler.instance = new DirectoryHandler();
    }
    return DirectoryHandler.instance;
  }

  /**
   * Acquires the directory for a stream. If the path is currently draining
   * from a previous stream, waits for drain to complete before acquiring.
   */
  public async acquireDirectory(mediaRootPath: string, streamPath: string): Promise<void> {
    const fullPath = path.join(mediaRootPath, streamPath);

    const pendingDrain = DirectoryHandler.drainPromises.get(fullPath);
    if (pendingDrain) {
      this.logger.info(`Waiting for previous stream drain to complete: ${fullPath}`);
      await pendingDrain;
    }

    if (DirectoryHandler.activeStreams.has(fullPath)) {
      throw new Error(`Directory ${fullPath} is already in use.`);
    }
    DirectoryHandler.activeStreams.add(fullPath);
  }

  public releaseDirectory(mediaRootPath: string, streamPath: string): void {
    const fullPath = path.join(mediaRootPath, streamPath);
    DirectoryHandler.activeStreams.delete(fullPath);
  }

  public handleStart(mediaRootPath: string, streamPath: string, mediatype?: 'video' | 'audio'): void {
    const fullPath = path.join(mediaRootPath, streamPath);
    const resolvedMediatype = mediatype || (streamPath.startsWith('/audio') ? 'audio' : 'video');

    this.logger.info(`Handling directory: ${fullPath} with mediatype: ${resolvedMediatype}`);

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
          resolvedMediatype,
        );

        DirectoryHandler.uploaders.set(fullPath, uploader);
        this.logger.info(`Uploader created for "${fullPath}"`);
      } catch (error) {
        this.logger.error(`Error handling directory ${fullPath}:`, error);
      }
    });
  }

  /**
   * Called by SRS on_hls callback when a new HLS segment is ready.
   */
  public handleSegment(mediaRootPath: string, streamPath: string, segmentPath: string): void {
    const fullPath = path.join(mediaRootPath, streamPath);
    const uploader = DirectoryHandler.uploaders.get(fullPath);
    if (uploader) {
      uploader.onSegmentUpdate(segmentPath);
    } else {
      this.logger.warn(`[DirectoryHandler] No uploader for segment: ${segmentPath} (stream: ${fullPath})`);
    }
  }

  /**
   * Called by SRS on_hls callback when the manifest is updated.
   */
  public handleManifest(mediaRootPath: string, streamPath: string): void {
    const fullPath = path.join(mediaRootPath, streamPath);
    const uploader = DirectoryHandler.uploaders.get(fullPath);
    if (uploader) {
      uploader.onManifestUpdate();
    }
  }

  public async handleStop(mediaRootPath: string, streamPath: string): Promise<void> {
    const fullPath = path.join(mediaRootPath, streamPath);

    const drainPromise = this.performDrain(fullPath);
    DirectoryHandler.drainPromises.set(fullPath, drainPromise);

    try {
      await drainPromise;
    } finally {
      DirectoryHandler.drainPromises.delete(fullPath);
    }
  }

  private async performDrain(fullPath: string): Promise<void> {
    // Wait for any pending handleStart to complete so the uploader exists
    await this.queue.onIdle();

    const uploader = DirectoryHandler.uploaders.get(fullPath);

    if (!uploader) {
      this.logger.warn(`No uploader found for ${fullPath}, cleaning up without drain`);
      DirectoryHandler.activeStreams.delete(fullPath);
      await this.deleteDirectorySafe(fullPath);
      return;
    }

    await uploader.waitForStreamDrain();
    await uploader.broadcastStop();
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
        } catch (error) {
          this.errorHandler.handleError(error, `DirectoryHandler.stopAllStreams - ${fullPath}`);
        }
      }),
    );

    DirectoryHandler.activeStreams.clear();
    DirectoryHandler.uploaders.clear();

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
