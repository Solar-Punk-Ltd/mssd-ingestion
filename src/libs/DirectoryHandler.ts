import { Bee } from '@ethersphere/bee-js';

import { getEnvVariable } from '../utils/common';

import { Logger } from './Logger';
import { MediaWatcher } from './MediaWatcher'; // Import MediaWatcher
import { Queue } from './Queue';
import { SwarmStreamUploader } from './SwarmStreamUploader'; // Import SwarmStreamUploader

const WRITER_BEE_URL = getEnvVariable('WRITER_BEE_URL');
const MANIFEST_SEGMENT_URL = getEnvVariable('MANIFEST_SEGMENT_URL');
const STREAM_STAMP = getEnvVariable('STREAM_STAMP');
const GSOC_KEY = getEnvVariable('GSOC_KEY');
const GSOC_TOPIC = getEnvVariable('GSOC_TOPIC');

export class DirectoryHandler {
  private logger = Logger.getInstance();
  private queue: Queue;

  private static instance: DirectoryHandler;
  private static handledDirs = new Set<string>();

  private constructor() {
    this.queue = new Queue();
  }

  public static getInstance(): DirectoryHandler {
    if (!DirectoryHandler.instance) {
      DirectoryHandler.instance = new DirectoryHandler();
    }
    return DirectoryHandler.instance;
  }

  public handleDir(path: string): void {
    if (DirectoryHandler.handledDirs.has(path)) {
      this.logger.info(`Already handling directory: ${path}`);
      return;
    }
    DirectoryHandler.handledDirs.add(path);
    this.logger.info(`Handling directory: ${path}`);
    this.queue.enqueue(async () => {
      try {
        const bee = new Bee(WRITER_BEE_URL);
        const uploader = new SwarmStreamUploader(bee, MANIFEST_SEGMENT_URL, GSOC_KEY, GSOC_TOPIC, STREAM_STAMP, path);
        const watcher = new MediaWatcher(path, uploader.enqueueNewSegment.bind(uploader));
        watcher.start();
      } catch (error) {
        this.logger.error(`Error handling directory ${path}:`, error);
      }
    });
  }
}
