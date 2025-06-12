import { ErrorHandler } from '../libs/ErrorHandler.js';
import { Logger } from '../libs/Logger.js';

const logger = Logger.getInstance();
const errorHandler = ErrorHandler.getInstance();

export function getEnvVariable(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is not defined`);
  }
  return value;
}

export function sleep(delay: number) {
  return new Promise(resolve => {
    setTimeout(resolve, delay);
  });
}

export async function retryAwaitableAsync<T>(
  fn: () => Promise<T>,
  retries: number = 10,
  delay: number = 350,
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
