import { FSWatcher, watch } from 'chokidar';

import { ErrorHandler } from './ErrorHandler';
import { Logger } from './Logger';

export class MediaWatcher {
  private watcher: FSWatcher;
  private logger = Logger.getInstance();
  private errorHandler = ErrorHandler.getInstance();

  constructor(private watchPath: string, private onAdd: (filePath: string) => void) {
    this.watcher = watch(this.watchPath, {
      persistent: true,
      ignoreInitial: true, // Don't trigger "add" for existing files
    });
  }

  public start(): void {
    this.watcher
      .on('add', this.onAdd)
      .on('error', error => this.errorHandler.handleError(error, 'MediaWatcher.watchError'));
  }

  public close(): void {
    this.watcher.close();
    this.logger.log(`Stopped watching: ${this.watchPath}`);
  }
}
