import { FSWatcher, watch } from 'chokidar';
import fs from 'fs';

import { ErrorHandler } from './ErrorHandler';
import { Logger } from './Logger';

export class MediaWatcher {
  private watcher: FSWatcher | null = null;
  private logger = Logger.getInstance();
  private errorHandler = ErrorHandler.getInstance();
  private retryCount = 0;
  private maxRetries = 60;

  constructor(private watchPath: string, private onAdd: (filePath: string) => void) {}

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
        .on('add', this.onAdd)
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

  public close(): void {
    if (this.watcher) {
      this.watcher.close();
      this.logger.log(`Stopped watching: ${this.watchPath}`);
    }
  }
}
