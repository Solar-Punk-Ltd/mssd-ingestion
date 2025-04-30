import fs from 'fs';

import { MediaWatcher } from './MediaWatcher.js';

jest.useFakeTimers();

const loggerMock = { log: jest.fn() };
const errorHandlerMock = { handleError: jest.fn() };

const mockOn = jest.fn().mockReturnThis();
const mockClose = jest.fn();
const mockWatcher = { on: mockOn, close: mockClose };

jest.mock('chokidar', () => ({
  watch: jest.fn(() => mockWatcher),
}));

jest.mock('fs');

jest.mock('./Logger', () => ({
  Logger: { getInstance: () => loggerMock },
}));

jest.mock('./ErrorHandler', () => ({
  ErrorHandler: { getInstance: () => errorHandlerMock },
}));

describe('MediaWatcher', () => {
  const watchPath = '/some/media/path';
  const onAddMock = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should start watching immediately if folder exists', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);

    const watcher = new MediaWatcher(watchPath, onAddMock);
    watcher.start();

    expect(fs.existsSync).toHaveBeenCalledWith(watchPath);
    expect(loggerMock.log).toHaveBeenCalledWith(`[MediaWatcher] Watching started on: ${watchPath}`);
    expect(mockOn).toHaveBeenCalledWith('add', onAddMock);
    expect(mockOn).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('should retry until folder exists, then start watching', () => {
    (fs.existsSync as jest.Mock).mockReturnValueOnce(false).mockReturnValueOnce(false).mockReturnValueOnce(true); // found on 3rd try

    const watcher = new MediaWatcher(watchPath, onAddMock);
    watcher.start();

    expect(fs.existsSync).toHaveBeenCalledTimes(1);
    expect(loggerMock.log).toHaveBeenCalledWith(`[MediaWatcher] Directory not found: ${watchPath}, retrying in 1s...`);

    jest.advanceTimersByTime(1000); // retry 1
    expect(fs.existsSync).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(1000); // retry 2
    expect(fs.existsSync).toHaveBeenCalledTimes(3);

    expect(loggerMock.log).toHaveBeenCalledWith(`[MediaWatcher] Watching started on: ${watchPath}`);
    expect(mockOn).toHaveBeenCalledWith('add', onAddMock);
  });

  it('should stop retrying after maxRetries and report error', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);

    const watcher = new MediaWatcher(watchPath, onAddMock);
    watcher.start();

    for (let i = 0; i < 60; i++) {
      jest.advanceTimersByTime(1000);
    }

    expect(loggerMock.log).toHaveBeenCalledWith(`[MediaWatcher] Folder not found after 60 retries. Giving up.`);
    expect(errorHandlerMock.handleError).toHaveBeenCalledWith(
      new Error(`Watcher folder "${watchPath}" never appeared.`),
      'MediaWatcher.folderMissingTimeout',
    );

    expect(fs.existsSync).toHaveBeenCalledTimes(61); // initial + 60 retries
  });

  it('should close the watcher and log', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    const watcher = new MediaWatcher(watchPath, onAddMock);
    watcher.start();

    watcher.close();

    expect(mockClose).toHaveBeenCalled();
    expect(loggerMock.log).toHaveBeenCalledWith(`Stopped watching: ${watchPath}`);
  });

  it('should handle watcher error event', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    const watcher = new MediaWatcher(watchPath, onAddMock);
    watcher.start();

    const errorHandler = mockOn.mock.calls.find(call => call[0] === 'error')?.[1];
    const fakeError = new Error('whoops');
    errorHandler(fakeError);

    expect(errorHandlerMock.handleError).toHaveBeenCalledWith(fakeError, 'MediaWatcher.watchError');
  });
});
