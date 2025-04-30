import { Logger } from './Logger.js';

describe('Logger', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = Logger.getInstance();

    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should log with console.log and include [LOG]', () => {
    logger.log('Hello', 'world');
    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/\[LOG\] - Hello world/));
  });

  it('should log with console.info and include [INFO]', () => {
    logger.info('Info message');
    expect(console.info).toHaveBeenCalledWith(expect.stringMatching(/\[INFO\] - Info message/));
  });

  it('should log with console.warn and include [WARN]', () => {
    logger.warn('Warning');
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/\[WARN\] - Warning/));
  });

  it('should log with console.error and include [ERROR]', () => {
    logger.error('Oops!');
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/\[ERROR\] - Oops!/));
  });

  it('should log with console.debug and include [DEBUG]', () => {
    logger.debug('Debug stuff');
    expect(console.debug).toHaveBeenCalledWith(expect.stringMatching(/\[DEBUG\] - Debug stuff/));
  });

  it('should stringify object arguments in logs', () => {
    logger.log('User:', { id: 123, name: 'Levi' });
    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/"id":123.*"name":"Levi"/));
  });

  it('should return the same instance (singleton)', () => {
    const anotherInstance = Logger.getInstance();
    expect(anotherInstance).toBe(logger);
  });
});
