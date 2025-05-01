import fs from 'fs';

import 'dotenv/config';

import { startRtmpServer } from './libs/RTMPServer.js';
const mediaRootPath = process.argv[2] || './media'; // Get from CLI or use default
const ffmpegPath = process.argv[3];

async function startServer() {
  // Clean up previous run
  if (fs.existsSync(mediaRootPath)) {
    fs.rmSync(mediaRootPath, { recursive: true, force: true });
  }

  startRtmpServer(mediaRootPath, ffmpegPath);
}

startServer();
