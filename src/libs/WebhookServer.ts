import fs from 'fs';
import http from 'http';
import path from 'path';

import { getEnvVariable } from '../utils/common.js';

import { DirectoryHandler } from './DirectoryHandler.js';
import { Logger } from './Logger.js';

const logger = Logger.getInstance();

const WEBHOOK_PORT = parseInt(getEnvVariable('WEBHOOK_PORT', '3000'), 10);

export interface WebhookServerHandle {
  close(): Promise<void>;
}

interface SrsStreamPayload {
  action: 'on_publish' | 'on_unpublish';
  server_id: string;
  client_id: string;
  ip: string;
  vhost: string;
  app: string;
  stream: string;
  tcUrl?: string;
  param?: string;
}

interface SrsHlsPayload {
  action: 'on_hls';
  server_id: string;
  client_id: string;
  ip: string;
  vhost: string;
  app: string;
  stream: string;
  file: string;
  url: string;
  m3u8: string;
  m3u8_url: string;
  seq_no: number;
  duration: number;
}

function parseBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export function startWebhookServer(mediaRootPath: string): WebhookServerHandle {
  const dirHandler = DirectoryHandler.getInstance();

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'POST' && req.url === '/api/v1/streams') {
        const body = await parseBody(req);
        const payload: SrsStreamPayload = JSON.parse(body);

        const { app, stream } = payload;
        const mediatype: 'video' | 'audio' = app === 'audio' ? 'audio' : 'video';
        const streamPath = `/${app}/${stream}`;

        if (payload.action === 'on_publish') {
          logger.info(`[SRS] Stream published: ${streamPath} (${mediatype})`);

          const outputDir = path.join(mediaRootPath, streamPath);
          if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
          }

          dirHandler.acquireDirectory(mediaRootPath, streamPath);
          dirHandler.handleStart(mediaRootPath, streamPath, mediatype);
        } else if (payload.action === 'on_unpublish') {
          logger.info(`[SRS] Stream unpublished: ${streamPath}`);

          try {
            await dirHandler.handleStop(mediaRootPath, streamPath);
            dirHandler.releaseDirectory(mediaRootPath, streamPath);
          } catch (error) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            logger.error(`[SRS] Error during stream stop: ${msg}`);
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('0');
      } else if (req.method === 'POST' && req.url === '/api/v1/hls') {
        const body = await parseBody(req);
        const payload: SrsHlsPayload = JSON.parse(body);

        const { app, stream, file, seq_no, duration } = payload;
        const streamPath = `/${app}/${stream}`;
        // SRS sends container-relative paths like ./objs/nginx/html/video/stream/file.ts
        // Replace the SRS HLS base path with our local media root
        const relativePath = file.replace(/^\.\/objs\/nginx\/html\//, '');
        const segmentPath = path.resolve(mediaRootPath, relativePath);

        logger.debug(`[SRS] HLS segment ready: ${streamPath} seq=${seq_no} duration=${duration}s file=${file}`);

        dirHandler.handleSegment(mediaRootPath, streamPath, segmentPath);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('0');
      } else if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } else {
        res.writeHead(404);
        res.end();
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[SRS] Webhook error: ${msg}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('0'); // Always respond 0 to avoid blocking SRS
    }
  });

  server.listen(WEBHOOK_PORT, () => {
    logger.info(`[SRS] Webhook server listening on port ${WEBHOOK_PORT}`);
  });

  return {
    async close() {
      return new Promise<void>((resolve, reject) => {
        server.close(err => {
          if (err) {
            reject(err);
          } else {
            logger.info('[SRS] Webhook server closed');
            resolve();
          }
        });
      });
    },
  };
}
