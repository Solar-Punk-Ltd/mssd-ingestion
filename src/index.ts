import fs from 'fs';

import 'dotenv/config';

import { DirectoryHandler } from './libs/DirectoryHandler.js';
import { Logger } from './libs/Logger.js';
import { startWebhookServer, WebhookServerHandle } from './libs/WebhookServer.js';

const logger = Logger.getInstance();
const mediaRootPath = process.argv[2] || './media';

let webhookServer: WebhookServerHandle | undefined;
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

    if (webhookServer) {
      await webhookServer.close();
      webhookServer = undefined;
    }

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
    // Ensure media directory exists (don't delete — SRS may be using it)
    fs.mkdirSync(mediaRootPath, { recursive: true });

    webhookServer = startWebhookServer(mediaRootPath);
    logger.info('Webhook server started — waiting for SRS stream events');
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
