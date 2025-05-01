import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerMock = {
  error: vi.fn(),
};

vi.mock('./Logger', () => ({
  Logger: {
    getInstance: () => loggerMock,
  },
}));

import { ErrorHandler } from './ErrorHandler.js';

describe('ErrorHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should log an error with message and stack when passed an Error object', () => {
    const error = new Error('Something went wrong');
    ErrorHandler.getInstance().handleError(error, 'TestContext');

    expect(loggerMock.error).toHaveBeenCalledWith('Error in TestContext: Something went wrong', { stack: error.stack });
  });

  it('should log an error with "Unknown error occurred" when passed a non-Error', () => {
    ErrorHandler.getInstance().handleError('some string', 'NonErrorContext');

    expect(loggerMock.error).toHaveBeenCalledWith('Error in NonErrorContext: Unknown error occurred', { stack: null });
  });

  it('should log with "unknown context" if context is not provided', () => {
    const error = new Error('Oops!');
    ErrorHandler.getInstance().handleError(error);

    expect(loggerMock.error).toHaveBeenCalledWith('Error in unknown context: Oops!', { stack: error.stack });
  });
});
