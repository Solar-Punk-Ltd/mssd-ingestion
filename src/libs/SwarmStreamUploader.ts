import { Bee, Bytes, Identifier, PrivateKey, Topic } from '@ethersphere/bee-js';
import { makeChunkedFile } from '@fairdatasociety/bmt-js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { retryAwaitableAsync } from '../utils/common';

import { ErrorHandler } from './ErrorHandler';
import { Logger } from './Logger';
import { Queue } from './Queue';

// TODO: Refactor idea, separate the upload logic from the manifest handling logic
// TODO: omit segmentBuffer, use the manifest file directly
export class SwarmStreamUploader {
  private swarmManifestName = 'playlist.m3u8';
  private origiManifestName = 'index.m3u8';
  private TARGET_DURATION = 6;
  private mediaSequence = 0; // this isn't utalized yet, but it should be set to the first segment number

  private uploadQueue = new Queue();
  private logger = Logger.getInstance();
  private errorHandler = ErrorHandler.getInstance();
  private segmentBuffer: string[] = [];

  private bee: Bee;
  private manifestBeeUrl: string;
  private streamSigner: PrivateKey;
  private streamRawTopic: string;
  private gsocSigner: PrivateKey;
  private gsocRawTopic: string;
  private streamPath: string;
  private stamp: string;
  private index: number = 0;

  constructor(
    bee: Bee,
    swarmRpc: string,
    gsocResId: string,
    gsocTopic: string,
    streamKey: string,
    stamp: string,
    streamPath: string,
  ) {
    this.bee = bee;
    this.manifestBeeUrl = `${swarmRpc}/read/bytes`;
    this.streamSigner = new PrivateKey(streamKey);
    this.streamRawTopic = crypto.randomUUID();
    this.gsocSigner = new PrivateKey(gsocResId);
    this.gsocRawTopic = gsocTopic;
    this.stamp = stamp;
    this.streamPath = streamPath;
  }

  public async broadcastStart() {
    const identifier = Identifier.fromString(this.gsocRawTopic);

    const data = {
      owner: this.streamSigner.publicKey().address().toHex(),
      topic: this.streamRawTopic,
      state: 'live',
    };
    return retryAwaitableAsync(() => this.bee.gsocSend(this.stamp, this.gsocSigner, identifier, JSON.stringify(data)));
  }

  public async broadcastStop() {
    await this.uploadQueue.waitForProcessing();

    this.closeManifest();

    const nextIndex = this.index++;
    this.uploadManifest(nextIndex);

    const duration = this.getTotalDurationFromFile();

    const identifier = Identifier.fromString(this.gsocRawTopic);

    const data = {
      owner: this.streamSigner.publicKey().address().toHex(),
      topic: this.streamRawTopic,
      state: 'VOD',
      index: nextIndex,
      duration,
    };
    return retryAwaitableAsync(() => this.bee.gsocSend(this.stamp, this.gsocSigner, identifier, JSON.stringify(data)));
  }

  public upload(segmentPath: string) {
    if (segmentPath.includes('m3u8')) {
      return;
    }

    const ref = this.uploadSegment(segmentPath);

    if (!ref) {
      this.logger.error(`Failed to upload segment: ${segmentPath}`);
      return;
    }

    this.upsertManifest(segmentPath, ref);

    const filename = path.basename(segmentPath);
    const fileIndex = parseInt(filename.match(/\d+/)?.[0] || '', 10);
    this.uploadManifest(fileIndex);

    this.rmProcessedSegment(segmentPath);
  }

  private rmProcessedSegment(segmentPath: string) {
    try {
      fs.rmSync(segmentPath);
      this.logger.log(`Deleted processed segment: ${segmentPath}`);
    } catch (error) {
      this.errorHandler.handleError(error, 'SwarmStreamUploader.deleteProcessedSegment');
    }
  }

  private closeManifest() {
    const swarmManifestPath = path.join(this.streamPath, this.swarmManifestName);
    const close = `#EXT-X-ENDLIST\n`;
    fs.appendFileSync(swarmManifestPath, close);
    this.logger.log(`Manifest closed: ${swarmManifestPath}`);
  }

  private upsertManifest(segmentPath: string, ref: string) {
    const filename = path.basename(segmentPath);
    const origiManifestPath = path.join(this.streamPath, this.origiManifestName);
    const swarmManifestPath = path.join(this.streamPath, this.swarmManifestName);

    const extInf = this.getExtInfFromFile(origiManifestPath, filename);
    if (!extInf) {
      this.logger.error(`Failed to get EXTINF for ${filename}`);
      return;
    }

    const segmentLine = this.buildSegmentEntry(extInf, ref);
    this.segmentBuffer.push(segmentLine);

    const manifest = this.buildManifest();
    fs.writeFileSync(swarmManifestPath, manifest);

    this.logger.log(`Manifest updated (seq=${this.mediaSequence}): ${filename}`);
  }

  private buildSegmentEntry(duration: number, ref: string): string {
    return `#EXTINF:${duration.toFixed(6)},\n${this.manifestBeeUrl}/${ref}`;
  }

  private buildManifest(): string {
    const header = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      `#EXT-X-TARGETDURATION:${this.TARGET_DURATION}`,
      `#EXT-X-MEDIA-SEQUENCE:${this.mediaSequence}`,
    ];

    return `${header.join('\n')}\n${this.segmentBuffer.join('\n')}\n`;
  }

  private getExtInfFromFile(path: string, segmentName: string): number | null {
    const manifest = fs.readFileSync(path, 'utf-8');
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

  private getTotalDurationFromFile() {
    const swarmManifestPath = path.join(this.streamPath, this.swarmManifestName);
    const manifest = fs.readFileSync(swarmManifestPath, 'utf-8');

    const totalDuration = manifest
      .split('\n')
      .filter(line => line.startsWith('#EXTINF'))
      .reduce((sum, line) => {
        const duration = parseFloat(line.split(':')[1]);
        return sum + (isNaN(duration) ? 0 : duration);
      }, 0);

    return totalDuration;
  }

  private uploadSegment(segmentPath: string) {
    try {
      const segmentData = fs.readFileSync(segmentPath);

      this.uploadQueue.enqueue(async () => {
        const result = await this.uploadDataToBee(segmentData);
        if (result) {
          this.logger.log(`Segment upload result: ${segmentPath}`, result.reference.toHex());
        } else {
          this.logger.error(`Failed to upload segment: ${segmentPath}`);
        }
      });

      const data = makeChunkedFile(segmentData);
      const hexRef = Bytes.fromSlice(data.rootChunk().address(), 0).toHex();

      return hexRef;
    } catch (error) {
      this.errorHandler.handleError(error, 'SwarmStreamUploader.uploadSegment');
    }
  }

  private uploadManifest(index = 0) {
    try {
      this.index = index;

      const fullPath = path.join(this.streamPath, this.swarmManifestName);
      const manifestData = fs.readFileSync(fullPath);

      this.uploadQueue.enqueue(async () => {
        const result = await this.uploadDataAsSoc(index, manifestData);
        if (result) {
          this.logger.log(`Manifest upload result: ${fullPath}`, result.reference.toHex());
        } else {
          this.logger.error(`Failed to upload manifest: ${fullPath}`);
        }
      });
    } catch (error) {
      this.errorHandler.handleError(error, 'SwarmStreamUploader.uploadManifest');
    }
  }

  private async uploadDataAsSoc(index: number, data: Uint8Array) {
    try {
      const { uploadPayload } = this.bee.makeFeedWriter(Topic.fromString(this.streamRawTopic), this.streamSigner);
      return uploadPayload(this.stamp, data, { index });
    } catch (error) {
      this.errorHandler.handleError(error, 'SwarmStreamUploader.uploadDataAsSoc');
      return null;
    }
  }

  private async uploadDataToBee(data: Uint8Array) {
    try {
      return retryAwaitableAsync(() => this.bee.uploadData(this.stamp, data));
    } catch (error) {
      this.errorHandler.handleError(error, 'SwarmStreamUploader.uploadDataToBee');
      return null;
    }
  }
}
