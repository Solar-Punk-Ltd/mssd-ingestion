const loggerMock = {
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
};

const errorHandlerMock = {
  handleError: jest.fn(),
};

jest.mock('../libs/Logger', () => ({
  Logger: {
    getInstance: () => loggerMock,
  },
}));

jest.mock('../libs/ErrorHandler', () => ({
  ErrorHandler: {
    getInstance: () => errorHandlerMock,
  },
}));

import { retryAwaitableAsync, sleep } from './common';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('sleep', () => {
  it('should resolve after specified time', async () => {
    const start = Date.now();
    await sleep(200);
    const elapsed = Date.now() - start;

    // Allow some tolerance for timing variations
    expect(elapsed).toBeGreaterThanOrEqual(190);
  });
});

describe('retryAwaitableAsync', () => {
  it('should resolve if the function succeeds on first try', async () => {
    const fn = jest.fn().mockResolvedValue('success');
    const result = await retryAwaitableAsync(fn, 3, 100);
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry if the function fails, then succeeds', async () => {
    const fn = jest.fn().mockRejectedValueOnce(new Error('fail 1')).mockResolvedValue('success');

    const result = await retryAwaitableAsync(fn, 2, 100);
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(loggerMock.info).toHaveBeenCalledWith(expect.stringMatching(/Retrying/));
  });

  it('should reject after all retries fail and call handleError', async () => {
    const error = new Error('total failure');
    const fn = jest.fn().mockRejectedValue(error);

    await expect(retryAwaitableAsync(fn, 2, 50)).rejects.toThrow('total failure');
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
    expect(errorHandlerMock.handleError).toHaveBeenCalledWith(error, 'Utils.retryAwaitableAsync');
  });
});
