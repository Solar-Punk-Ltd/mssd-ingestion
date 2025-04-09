const loggerMock = { log: jest.fn() };
const errorHandlerMock = { handleError: jest.fn() };

const mockOn = jest.fn().mockReturnThis();
const mockClose = jest.fn();
const mockWatcher = { on: mockOn, close: mockClose };

jest.mock('chokidar', () => ({
  watch: jest.fn(() => mockWatcher),
}));
jest.mock('./Logger', () => ({
  Logger: { getInstance: () => loggerMock },
}));
jest.mock('./ErrorHandler', () => ({
  ErrorHandler: { getInstance: () => errorHandlerMock },
}));

import { MediaWatcher } from './MediaWatcher';

describe('MediaWatcher', () => {
  const mockAddHandler = jest.fn();
  const watchPath = '/some/media/path';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should attach add and error listeners on start', () => {
    const watcher = new MediaWatcher(watchPath, mockAddHandler);
    watcher.start();

    expect(mockOn).toHaveBeenCalledWith('add', mockAddHandler);
    expect(mockOn).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('should handle errors via errorHandler', () => {
    const fakeError = new Error('fail');
    const watcher = new MediaWatcher(watchPath, mockAddHandler);
    watcher.start();

    const errorHandler = mockOn.mock.calls.find(call => call[0] === 'error')?.[1];
    errorHandler?.(fakeError);

    expect(errorHandlerMock.handleError).toHaveBeenCalledWith(fakeError, 'MediaWatcher.watchError');
  });

  it('should close watcher and log', () => {
    const watcher = new MediaWatcher(watchPath, mockAddHandler);
    watcher.close();

    expect(mockClose).toHaveBeenCalled();
    expect(loggerMock.log).toHaveBeenCalledWith(`Stopped watching: ${watchPath}`);
  });
});
