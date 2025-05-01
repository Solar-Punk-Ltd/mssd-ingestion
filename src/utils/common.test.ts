import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../libs/Logger', () => {
  const mockLogger = {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };

  return {
    Logger: {
      getInstance: () => mockLogger,
    },
  };
});

vi.mock('../libs/ErrorHandler', () => {
  const errorHandlerMock = {
    handleError: vi.fn(),
  };

  return {
    ErrorHandler: {
      getInstance: () => errorHandlerMock,
    },
  };
});

import { ErrorHandler } from '../libs/ErrorHandler.js';
import { Logger } from '../libs/Logger.js';

import { retryAwaitableAsync, sleep } from './common.js';

const mockLogger = Logger.getInstance();
const errorHandlerMock = ErrorHandler.getInstance();

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sleep', () => {
  it('should resolve after specified time', async () => {
    const start = Date.now();
    await sleep(200);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(190);
  });
});

describe('retryAwaitableAsync', () => {
  it('should resolve if the function succeeds on first try', async () => {
    const fn = vi.fn().mockResolvedValue('success');
    const result = await retryAwaitableAsync(fn, 3, 100);
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry if the function fails, then succeeds', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('fail 1')).mockResolvedValue('success');

    const result = await retryAwaitableAsync(fn, 2, 100);
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringMatching(/Retrying/));
  });

  it('should reject after all retries fail and call handleError', async () => {
    const error = new Error('total failure');
    const fn = vi.fn().mockRejectedValue(error);

    await expect(retryAwaitableAsync(fn, 2, 50)).rejects.toThrow('total failure');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(errorHandlerMock.handleError).toHaveBeenCalledWith(error, 'Utils.retryAwaitableAsync');
  });
});
