import { Bee, Identifier, PrivateKey } from '@ethersphere/bee-js';
import fs from 'fs';
import path from 'path';

import { retryAwaitableAsync } from '../utils/common';

import { ErrorHandler } from './ErrorHandler';
import { Logger } from './Logger';
import { Queue } from './Queue';

export class SwarmStreamUploader {
  private swarmManifestName = 'playlist.m3u8';
  private origiManifestName = 'index.m3u8';
  private MAX_SEGMENTS = 20;
  private TARGET_DURATION = 6;
  private mediaSequence = 0;

  private queue = new Queue();
  private logger = Logger.getInstance();
  private errorHandler = ErrorHandler.getInstance();
  private segmentBuffer: string[] = [];

  private bee: Bee;
  private manifestBeeUrl: string;
  private gsocSigner: PrivateKey;
  private gsocTopic: string;
  private stamp: string;
  private streamPath: string;

  constructor(bee: Bee, manifestBeeUrl: string, gsocKey: string, gsocTopic: string, stamp: string, streamPath: string) {
    this.bee = bee;
    this.gsocSigner = new PrivateKey(gsocKey);
    this.manifestBeeUrl = manifestBeeUrl;
    this.gsocTopic = gsocTopic;
    this.stamp = stamp;
    this.streamPath = streamPath;
  }

  public enqueueNewSegment(segmentPath: string) {
    this.queue.enqueue(() => this.upload(segmentPath));
  }

  private async upload(segmentPath: string) {
    if (segmentPath.includes('m3u8')) {
      return;
    }

    const ref = await this.uploadSegment(segmentPath);

    if (!ref) {
      this.logger.error(`Failed to upload segment: ${segmentPath}`);
      return;
    }

    this.upsertManifest(segmentPath, ref);
    await this.uploadManifest();

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

    if (this.segmentBuffer.length > this.MAX_SEGMENTS) {
      this.segmentBuffer.shift();
      this.mediaSequence++;
    }

    const manifest = this.buildManifest();
    fs.writeFileSync(swarmManifestPath, manifest);

    this.logger.log(`Manifest updated (seq=${this.mediaSequence}): ${filename}`);
  }

  private buildSegmentEntry(duration: number, ref: string): string {
    return `#EXTINF:${duration.toFixed(6)},\n${this.manifestBeeUrl}/bytes/${ref}`;
  }

  private buildManifest(): string {
    const header = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-PLAYLIST-TYPE:EVENT',
      '#EXT-X-ALLOW-CACHE:NO',
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

  private async uploadSegment(segmentPath: string): Promise<string | undefined> {
    try {
      const segmentData = fs.readFileSync(segmentPath);
      const result = await this.uploadDataToBee(segmentData);

      if (result) {
        this.logger.log(`Upload result: ${segmentPath}`, result.reference.toHex());
        return result.reference.toHex();
      }
    } catch (error) {
      this.errorHandler.handleError(error, 'SwarmStreamUploader.uploadSegment');
    }
  }

  private async uploadManifest() {
    try {
      const fullPath = path.join(this.streamPath, this.swarmManifestName);
      const manifestData = fs.readFileSync(fullPath);

      const result = await this.uploadDataAsSoc(manifestData);
      if (result) {
        this.logger.log('GSOC manifest upload:', result.reference.toHex());
      }
    } catch (error) {
      this.errorHandler.handleError(error, 'SwarmStreamUploader.uploadManifest');
    }
  }

  // Limitation, it has to be GSOC as overwritten SOCs are not distributed properly
  private async uploadDataAsSoc(data: Uint8Array) {
    try {
      const identifier = Identifier.fromString(this.gsocTopic);
      return retryAwaitableAsync(() => this.bee.gsocSend(this.stamp, this.gsocSigner, identifier, data));
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
