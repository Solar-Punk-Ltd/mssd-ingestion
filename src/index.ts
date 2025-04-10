import { Bee } from '@ethersphere/bee-js';
import fs from 'fs';

import 'dotenv/config';

import { MediaWatcher } from './libs/MediaWatcher';
import { startRtmpServer, waitForStreamPath } from './libs/RTMPServer';
import { SwarmStreamUploader } from './libs/SwarmStreamUploader';
import { getEnvVariable } from './utils/common';

const mediaRootPath = process.argv[2] || './media'; // Get from CLI or use default
const ffmpegPath = process.argv[3];

const WRITER_BEE_URL = getEnvVariable('WRITER_BEE_URL');
const MANIFEST_SEGMENT_URL = getEnvVariable('MANIFEST_SEGMENT_URL');
const STREAM_STAMP = getEnvVariable('STREAM_STAMP');
const GSOC_KEY = getEnvVariable('GSOC_KEY');
const GSOC_TOPIC = getEnvVariable('GSOC_TOPIC');

async function startServer() {
  // Clean up previous run
  if (fs.existsSync(mediaRootPath)) {
    fs.rmSync(mediaRootPath, { recursive: true, force: true });
  }

  startRtmpServer(mediaRootPath, ffmpegPath);

  const streamPath = await waitForStreamPath();

  // pass bee here to reduce testing complexity
  const bee = new Bee(WRITER_BEE_URL);
  const uploader = new SwarmStreamUploader(bee, MANIFEST_SEGMENT_URL, GSOC_KEY, GSOC_TOPIC, STREAM_STAMP, streamPath);
  const watcher = new MediaWatcher(streamPath, uploader.enqueueNewSegment.bind(uploader));

  watcher.start();
}

startServer();
