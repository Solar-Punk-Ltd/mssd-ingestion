import { FSWatcher, watch } from 'chokidar';
import fs from 'fs';
import PQueue from 'p-queue';

import { ErrorHandler } from './ErrorHandler.js';
import { Logger } from './Logger.js';

export class MediaWatcher {
  private watcher: FSWatcher | null = null;
  private queue = new PQueue({ concurrency: 1 });
  private logger = Logger.getInstance();
  private errorHandler = ErrorHandler.getInstance();
  private retryCount = 0;
  private maxRetries = 60;

  constructor(
    private watchPath: string,
    private onAdd: (filePath: string) => void,
    private onChange: (filePath: string) => Promise<void>,
  ) {}

  public start(): void {
    this.waitForFolderAndWatch();
  }

  public async close(): Promise<void> {
    if (this.watcher) {
      await this.queue.onIdle();
      this.watcher.close();
      this.logger.log(`Stopped watching: ${this.watchPath}`);
    }
  }

  private waitForFolderAndWatch(): void {
    if (fs.existsSync(this.watchPath)) {
      this.logger.log(`[MediaWatcher] Watching started on: ${this.watchPath}`);
      this.watcher = watch(this.watchPath, {
        persistent: true,
        ignoreInitial: true,
      });

      this.watcher
        .on('add', path => {
          this.queue.add(async () => {
            if (path.endsWith('.m3u8') || path.endsWith('.tmp')) {
              return;
            }

            const isReady = await this.waitUntilFileIsReady(path);
            if (isReady) {
              this.onAdd(path);
            } else {
              this.logger.error(`File not ready on add: ${path}`);
            }
          });
        })
        .on('change', path => {
          this.queue.add(async () => {
            if (path.endsWith('.ts') || path.endsWith('.tmp') || path.includes('playlist')) {
              return;
            }

            const isReady = await this.waitUntilFileIsReady(path);
            if (isReady) {
              await this.onChange(path);
            } else {
              this.logger.error(`File not ready on change: ${path}`);
            }
          });
        })
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

  private async waitUntilFileIsReady(
    filePath: string,
    {
      stableRounds = 3,
      interval = 200,
      maxAttempts = 30,
    }: { stableRounds?: number; interval?: number; maxAttempts?: number } = {},
  ): Promise<boolean> {
    let lastSize = -1;
    let lastMTime = 0;
    let stableCount = 0;

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const stats = fs.statSync(filePath);
        const { size, mtimeMs } = stats;

        if (size === lastSize && mtimeMs === lastMTime && size > 0) {
          stableCount++;
          if (stableCount >= stableRounds) {
            return true;
          }
        } else {
          stableCount = 0;
          lastSize = size;
          lastMTime = mtimeMs;
        }
      } catch (err) {
        this.logger.error(`File readiness check error: ${filePath}`);
      }

      await new Promise(resolve => setTimeout(resolve, interval));
    }

    return false;
  }
}
