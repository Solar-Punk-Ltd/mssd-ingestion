const errorHandlerMock = {
  handleError: jest.fn(),
};

jest.mock('./ErrorHandler', () => ({
  ErrorHandler: {
    getInstance: () => errorHandlerMock,
  },
}));

jest.mock('../utils/common', () => ({
  sleep: jest.fn(() => Promise.resolve()),
}));

import { sleep } from '../utils/common';

import { Queue } from './Queue';

describe('Queue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should process a synchronous task', async () => {
    const queue = new Queue();
    const task = jest.fn();

    queue.enqueue(task);
    await queue.waitForProcessing();

    expect(task).toHaveBeenCalledTimes(1);
  });

  it('should process an asynchronous task', async () => {
    const queue = new Queue();
    const asyncTask = jest.fn(() => Promise.resolve());

    queue.enqueue(asyncTask);
    await queue.waitForProcessing();

    expect(asyncTask).toHaveBeenCalledTimes(1);
  });

  it('should process multiple tasks in order', async () => {
    const queue = new Queue();
    const calls: number[] = [];

    queue.enqueue(() => {
      calls.push(1);
    });
    queue.enqueue(() => {
      calls.push(2);
    });
    queue.enqueue(() =>
      Promise.resolve().then(() => {
        calls.push(3);
      }),
    );

    await queue.waitForProcessing();

    expect(calls).toEqual([1, 2, 3]);
  });

  it('should handle errors using errorHandler', async () => {
    const queue = new Queue();
    const error = new Error('Task failed');
    const failingTask = () => {
      throw error;
    };

    queue.enqueue(failingTask);
    await queue.waitForProcessing();

    expect(errorHandlerMock.handleError).toHaveBeenCalledWith(error, 'Queue.processQueue');
  });

  it('should wait until processing is complete', async () => {
    const queue = new Queue({ clearWaitTime: 10 });
    let resolveFn: () => void;
    const asyncTask = jest.fn(
      () =>
        new Promise<void>(resolve => {
          resolveFn = resolve;
        }),
    );

    queue.enqueue(asyncTask);
    const waiting = queue.waitForProcessing();

    // At this point the task is still running
    expect((sleep as jest.Mock).mock.calls.length).toBeGreaterThan(0);

    // Now resolve the task
    resolveFn!();

    await waiting;

    expect(asyncTask).toHaveBeenCalled();
  });
});
