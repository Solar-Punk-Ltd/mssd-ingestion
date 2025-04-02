import { Bee, MantarayNode } from '@ethersphere/bee-js';
import { makeChunkedFile } from '@fairdatasociety/bmt-js';
import fs from 'fs';
import * as http from 'http';
import path from 'path';

import { uploadDataToBee, uploadEnvelopedDataToBee, uploadEnvelopedWrappedChunkSOC } from './bee';
import { Queue } from './queue';

const BEE_URL = 'http://65.108.40.58:2033';
//const STAMP = '0xd25b732bc37ae7631be906e2863a0d45d42fb0e74f1140aae1e54cc2af9eead5';
const STAMP = '670ee4ca2b5172e47ae8d23a9818785599b2d85da02c3144cbfd6f0bfa67cdd8';
const PRIVATE_KEY = '719046052c2727eae0f3f5fd6f2e778aa590140e6fb15ba7cb825ed1e426969a';
const TOPIC = 'STREAM';
const SEGMENT_FOLDER = './media';
const SEGMENT_PREFIX = 'segment_';
const SEGMENT_EXTENSION = '.m4s';

const bee = new Bee(BEE_URL);
const uploaded = new Set();
const queue = new Queue();

function getExtInfFromFile(filePath: string, segmentName: string): number | null {
  const manifest = fs.readFileSync(filePath, 'utf-8');
  const lines = manifest.trim().split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line === segmentName && i > 0) {
      const prevLine = lines[i - 1].trim();
      const match = prevLine.match(/^#EXTINF:([\d.]+),?/);
      if (match) {
        return parseFloat(match[1]);
      }
    }
  }

  return null;
}

function listSegments() {
  const files = fs.readdirSync(SEGMENT_FOLDER);
  return files
    .filter(f => f.startsWith(SEGMENT_PREFIX) && f.endsWith(SEGMENT_EXTENSION))
    .sort((a, b) => {
      const matchA = a.match(/\d+/)!;
      const matchB = b.match(/\d+/)!;
      const aNum = parseInt(matchA[0]);
      const bNum = parseInt(matchB[0]);
      return aNum - bNum;
    });
}

function enqueueNewSegments() {
  const segments = listSegments();
  for (const file of segments) {
    if (!uploaded.has(file)) {
      //queue.enqueue();
    }
  }
}

function upload(filename: string) {
  const duration = getExtInfFromFile('./output/playlist.m3u8', filename);
}

// *.m3u8	application/vnd.apple.mpegurl
// init.mp4	video/mp4
// *.m4s	video/mp4 or application/octet-stream*
// *.ts	video/MP2T

// async function uploadManifest() {
//   const mantaray = new MantarayNode();
//   mantaray.addFork(file.path, rootChunk.hash(), {
//     'Content-Type': maybeEnrichMime(mimes[extension.toLowerCase()] || 'application/octet-stream'),
//     Filename: filename,
//   });
// }

async function uploadInitV2() {
  const fullPath = path.join(SEGMENT_FOLDER, 'init.mp4');

  const data = fs.readFileSync(fullPath);

  const uploadResult = await bee.uploadFile(STAMP, data, 'init.mp4', {
    contentType: 'video/mp4',
  });
  if (!uploadResult) {
    console.error('Upload failed');
    return;
  }

  console.log('Upload result initV2:', uploadResult.reference.toHex());
}

async function uploadInit() {
  const fullPath = path.join(SEGMENT_FOLDER, 'init.mp4');

  const buffer = fs.readFileSync(fullPath);
  const uint8Data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  const uploadResult = await uploadEnvelopedDataToBee(bee, PRIVATE_KEY, STAMP, uint8Data);
  if (!uploadResult) {
    console.error('Upload failed');
    return;
  }

  console.log('Upload result init:', uploadResult);
  // const mantaray = new MantarayNode();
  // const fullPath = path.join(SEGMENT_FOLDER, 'init.mp4');
  // const buffer = fs.readFileSync(fullPath);
  // const uint8Data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  // const uploadResult = await uploadEnvelopedDataToBee(bee, PRIVATE_KEY, STAMP, uint8Data);
  // if (!uploadResult) {
  //   console.error('Upload failed');
  //   return;
  // }
  // mantaray.addFork('init.mp4', uploadResult, {
  //   'Content-Type': 'video/mp4',
  //   Filename: 'init.mp4',
  // });
  // const marshaledMantaray = await mantaray.marshal();
  // const result = await uploadEnvelopedDataToBee(bee, PRIVATE_KEY, STAMP, marshaledMantaray);
  // console.log('Upload result:', result);
}

async function uploadSegment(filename: string) {
  const [_prefix, num] = filename.split('_');
  const index = parseInt(num);
  console.log(`Uploading segment ${filename} with index ${index}`);

  const fullPath = path.join(SEGMENT_FOLDER, filename);

  try {
    const buffer = fs.readFileSync(fullPath);
    const uint8Data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

    const _uploadResult = await uploadEnvelopedDataToBee(bee, PRIVATE_KEY, STAMP, uint8Data);
    console.log(`Upload result: ${filename}`, _uploadResult);
    return;

    const chunkedFile = makeChunkedFile(uint8Data);
    const rootChunk = chunkedFile.rootChunk();

    await uploadEnvelopedWrappedChunkSOC(bee, PRIVATE_KEY, STAMP, TOPIC, index, rootChunk);
  } catch (error) {
    console.error(`Error uploading ${filename}:`, error);
  }
}

async function uploadSegmentV2(filename: string) {
  const [_prefix, num] = filename.split('_');
  const index = parseInt(num);
  console.log(`Uploading segment ${filename} with index ${index}`);

  const fullPath = path.join(SEGMENT_FOLDER, filename);

  try {
    const segmentData = fs.readFileSync(fullPath);

    const uploadResult = await uploadDataToBee(bee, STAMP, segmentData);
    // const uploadResult = await bee.uploadFile(STAMP, segmentData, filename, {
    //   contentType: 'video/mp4',
    // });
    console.log(`Upload result: ${filename}`, uploadResult?.reference.toHex());
    return;
  } catch (error) {
    console.error(`Error uploading ${filename}:`, error);
  }
}

async function uploadManifestV2() {
  const fullPath = path.join(SEGMENT_FOLDER, 'playlist.m3u8');

  const manifestData = fs.readFileSync(fullPath);

  const uploadResult = await uploadDataToBee(bee, STAMP, manifestData);
  if (!uploadResult) {
    console.error('Upload failed');
    return;
  }

  console.log('Upload result manifestV2:', uploadResult.reference.toHex());
}

async function uploadManifest() {
  const fullPath = path.join(SEGMENT_FOLDER, 'playlist.m3u8');

  const buffer = fs.readFileSync(fullPath);
  const uint8Data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  const uploadResult = await uploadEnvelopedDataToBee(bee, PRIVATE_KEY, STAMP, uint8Data);
  if (!uploadResult) {
    console.error('Upload failed');
    return;
  }

  console.log('Upload result:', uploadResult);
}

const startUploader = () => {};

const requestHandler = (_req: http.IncomingMessage, res: http.ServerResponse): void => {
  startUploader();
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Upload has started!');
};

const server = http.createServer(requestHandler);

export const startServer = (port: number): http.Server => {
  return server.listen(port, () => {
    console.log(`Server started on port ${port}`);
  });
};

// uploadSegment('segment_000.m4s');
// uploadSegment('segment_001.m4s');
// uploadSegment('segment_002.m4s');
// uploadSegment('segment_003.m4s');
// uploadSegment('segment_004.m4s');
// uploadSegment('segment_005.m4s');
// uploadSegment('segment_006.m4s');
//uploadInit();
//uploadManifest();

//uploadInitV2();
// uploadSegmentV2('segment_000.ts');
// uploadSegmentV2('segment_001.ts');
// uploadSegmentV2('segment_002.ts');
// uploadSegmentV2('segment_003.ts');
// uploadSegmentV2('segment_004.ts');
// uploadSegmentV2('segment_005.ts');
// uploadSegmentV2('segment_006.ts');
uploadManifestV2();
