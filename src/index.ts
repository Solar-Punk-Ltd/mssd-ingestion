import fs from 'fs';

import 'dotenv/config';

import { DirectoryHandler } from './libs/DirectoryHandler.js';
import { Logger } from './libs/Logger.js';
import { SrtServerHandle, startSrtServer, stopSrtServer } from './libs/SRTServer.js';

const logger = Logger.getInstance();
const mediaRootPath = process.argv[2] || './media';
const ffmpegPath = process.argv[3];

let srtServer: SrtServerHandle | undefined;
let isShuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) {
    logger.warn('Shutdown already in progress...');
    return;
  }

  isShuttingDown = true;
  logger.info(`Received ${signal}. Shutting down gracefully...`);

  try {
    const dirHandler = DirectoryHandler.getInstance();
    await dirHandler.cleanup();
    logger.info('Directory handler and all streams stopped');

    if (srtServer) {
      await stopSrtServer(srtServer);
      srtServer = undefined;
      logger.info('SRT server stopped');
    }

    DirectoryHandler.stopCleanup();

    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', error => {
  logger.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', JSON.stringify(promise, null, 2));
  logger.error('Rejection reason:', reason);
  if (reason instanceof Error) {
    logger.error('Error stack:', reason.stack);
  } else {
    logger.error('Reason type:', typeof reason, 'Value:', JSON.stringify(reason));
  }
});

async function startServer() {
  try {
    // Clean up previous run
    if (fs.existsSync(mediaRootPath)) {
      fs.rmSync(mediaRootPath, { recursive: true, force: true });
    }

    srtServer = startSrtServer(mediaRootPath, ffmpegPath);
    logger.info('SRT server started successfully');
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
