import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';

vi.useFakeTimers();

const loggerMock = { log: vi.fn() };
const errorHandlerMock = { handleError: vi.fn() };

const mockOn = vi.fn().mockReturnThis();
const mockClose = vi.fn();
const mockWatcher = { on: mockOn, close: mockClose };

vi.mock('chokidar', () => ({
  watch: vi.fn(() => mockWatcher),
}));

vi.mock('fs');

vi.mock('./Logger', () => ({
  Logger: { getInstance: () => loggerMock },
}));

vi.mock('./ErrorHandler', () => ({
  ErrorHandler: { getInstance: () => errorHandlerMock },
}));

import fs from 'fs';

import { MediaWatcher } from './MediaWatcher.js';

describe('MediaWatcher', () => {
  const watchPath = '/some/media/path';
  const onAddMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should start watching immediately if folder exists', () => {
    (fs.existsSync as Mock).mockReturnValue(true);

    const watcher = new MediaWatcher(watchPath, onAddMock);
    watcher.start();

    expect(fs.existsSync).toHaveBeenCalledWith(watchPath);
    expect(loggerMock.log).toHaveBeenCalledWith(`[MediaWatcher] Watching started on: ${watchPath}`);
    expect(mockOn).toHaveBeenCalledWith('add', onAddMock);
    expect(mockOn).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('should retry until folder exists, then start watching', () => {
    (fs.existsSync as Mock).mockReturnValueOnce(false).mockReturnValueOnce(false).mockReturnValueOnce(true); // found on 3rd try

    const watcher = new MediaWatcher(watchPath, onAddMock);
    watcher.start();

    expect(fs.existsSync).toHaveBeenCalledTimes(1);
    expect(loggerMock.log).toHaveBeenCalledWith(`[MediaWatcher] Directory not found: ${watchPath}, retrying in 1s...`);

    vi.advanceTimersByTime(1000); // retry 1
    expect(fs.existsSync).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(1000); // retry 2
    expect(fs.existsSync).toHaveBeenCalledTimes(3);

    expect(loggerMock.log).toHaveBeenCalledWith(`[MediaWatcher] Watching started on: ${watchPath}`);
    expect(mockOn).toHaveBeenCalledWith('add', onAddMock);
  });

  it('should stop retrying after maxRetries and report error', () => {
    (fs.existsSync as Mock).mockReturnValue(false);

    const watcher = new MediaWatcher(watchPath, onAddMock);
    watcher.start();

    for (let i = 0; i < 60; i++) {
      vi.advanceTimersByTime(1000);
    }

    expect(loggerMock.log).toHaveBeenCalledWith(`[MediaWatcher] Folder not found after 60 retries. Giving up.`);
    expect(errorHandlerMock.handleError).toHaveBeenCalledWith(
      new Error(`Watcher folder "${watchPath}" never appeared.`),
      'MediaWatcher.folderMissingTimeout',
    );

    expect(fs.existsSync).toHaveBeenCalledTimes(61); // initial + 60 retries
  });

  it('should close the watcher and log', () => {
    (fs.existsSync as Mock).mockReturnValue(true);
    const watcher = new MediaWatcher(watchPath, onAddMock);
    watcher.start();

    watcher.close();

    expect(mockClose).toHaveBeenCalled();
    expect(loggerMock.log).toHaveBeenCalledWith(`Stopped watching: ${watchPath}`);
  });

  it('should handle watcher error event', () => {
    (fs.existsSync as Mock).mockReturnValue(true);
    const watcher = new MediaWatcher(watchPath, onAddMock);
    watcher.start();

    const errorHandler = mockOn.mock.calls.find(call => call[0] === 'error')?.[1];
    const fakeError = new Error('whoops');
    errorHandler(fakeError);

    expect(errorHandlerMock.handleError).toHaveBeenCalledWith(fakeError, 'MediaWatcher.watchError');
  });
});
