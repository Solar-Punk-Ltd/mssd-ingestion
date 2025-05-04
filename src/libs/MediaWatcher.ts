import { FSWatcher, watch } from 'chokidar';
import fs from 'fs';
import PQueue from 'p-queue';

import { ErrorHandler } from './ErrorHandler.js';
import { Logger } from './Logger.js';

export class MediaWatcher {
  private watcher: FSWatcher | null = null;
  private uploadQueue = new PQueue({ concurrency: 1 });
  private logger = Logger.getInstance();
  private errorHandler = ErrorHandler.getInstance();
  private retryCount = 0;
  private maxRetries = 60;

  constructor(private watchPath: string, private onAdd: (filePath: string) => Promise<void>) {}

  public start(): void {
    this.waitForFolderAndWatch();
  }

  private waitForFolderAndWatch(): void {
    if (fs.existsSync(this.watchPath)) {
      this.logger.log(`[MediaWatcher] Watching started on: ${this.watchPath}`);
      this.watcher = watch(this.watchPath, {
        persistent: true,
        ignoreInitial: true,
      });

      this.watcher
        .on('add', path => this.uploadQueue.add(() => this.onAdd(path)))
        .on('error', error => this.errorHandler.handleError(error, 'MediaWatcher.watchError'));
    } else if (this.retryCount < this.maxRetries) {
      this.logger.log(`[MediaWatcher] Directory not found: ${this.watchPath}, retrying in 1s...`);
      this.retryCount++;
      setTimeout(() => this.waitForFolderAndWatch(), 1000);
    } else {
      this.logger.log(`[MediaWatcher] Folder not found after ${this.maxRetries} retries. Giving up.`);
      this.errorHandler.handleError(
        new Error(`Watcher folder "${this.watchPath}" never appeared.`),
        'MediaWatcher.folderMissingTimeout',
      );
    }
  }

  public async close(): Promise<void> {
    if (this.watcher) {
      await this.uploadQueue.onIdle();
      this.watcher.close();
      this.logger.log(`Stopped watching: ${this.watchPath}`);
    }
  }
}
