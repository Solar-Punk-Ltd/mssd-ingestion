import { ErrorHandler } from '../libs/ErrorHandler';
import { Logger } from '../libs/Logger';

const logger = Logger.getInstance();
const errorHandler = ErrorHandler.getInstance();

/**
 * Pauses the execution of an asynchronous function for a specified duration.
 * @param delay - The delay duration in milliseconds.
 * @returns A promise that resolves after the specified delay.
 */
export function sleep(delay: number) {
  return new Promise(resolve => {
    setTimeout(resolve, delay);
  });
}

/**
 * Retry an asynchronous operation with exponential backoff.
 * @param fn The function to retry.
 * @param retries The number of retries.
 * @param delay The delay between retries in milliseconds.
 * @returns The result of the operation.
 */
export async function retryAwaitableAsync<T>(
  fn: () => Promise<T>,
  retries: number = 3,
  delay: number = 250,
): Promise<T> {
  return new Promise((resolve, reject) => {
    fn()
      .then(resolve)
      .catch(error => {
        if (retries > 0) {
          logger.info(`Retrying... Attempts left: ${retries}. Error: ${error.message}`);
          setTimeout(() => {
            retryAwaitableAsync(fn, retries - 1, delay)
              .then(resolve)
              .catch(reject);
          }, delay);
        } else {
          errorHandler.handleError(error, 'Utils.retryAwaitableAsync');
          reject(error);
        }
      });
  });
}
