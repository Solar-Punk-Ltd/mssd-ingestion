import { Bee, Bytes, Identifier, PrivateKey, Topic } from '@ethersphere/bee-js';
import crypto from 'crypto';
import fs from 'fs';
import PQueue from 'p-queue';
import path from 'path';
import pkg from '@fairdatasociety/bmt-js';
const { makeChunkedFile } = pkg;

import { retryAwaitableAsync } from '../utils/common.js';

import { ErrorHandler } from './ErrorHandler.js';
import { Logger } from './Logger.js';

// TODO: Refactor idea, separate the upload logic from the manifest handling logic
export class SwarmStreamUploader {
  private readonly liveSwarmManifestName = 'playlist-live.m3u8';
  private readonly vodSwarmManifestName = 'playlist-vod.m3u8';
  private readonly origiManifestName = 'index.m3u8';
  private readonly segmentBufferSize = 10;
  private mediaSequence = 0;

  private segmentQueue = new PQueue({ concurrency: 10 });
  private manifestQueue = new PQueue({ concurrency: 10 });
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
  private mediatype: string;
  private hlsOriginalHeaders: string[] = [];

  constructor(
    bee: Bee,
    swarmRpc: string,
    gsocResId: string,
    gsocTopic: string,
    streamKey: string,
    stamp: string,
    streamPath: string,
    mediatype: string,
  ) {
    this.bee = bee;
    this.manifestBeeUrl = `${swarmRpc}/read/bytes`;
    this.streamSigner = new PrivateKey(streamKey);
    this.streamRawTopic = crypto.randomUUID();
    this.gsocSigner = new PrivateKey(gsocResId);
    this.gsocRawTopic = gsocTopic;
    this.stamp = stamp;
    this.streamPath = streamPath;
    this.mediatype = mediatype;
  }

  public async broadcastStart() {
    const identifier = Identifier.fromString(this.gsocRawTopic);
    const data = {
      owner: this.streamSigner.publicKey().address().toHex(),
      topic: this.streamRawTopic,
      state: 'live',
      mediatype: this.mediatype,
    };

    return retryAwaitableAsync(() => this.bee.gsocSend(this.stamp, this.gsocSigner, identifier, JSON.stringify(data)));
  }

  public async broadcastStop() {
    const validVODManifest = this.isFinalVODManifestValid();
    if (!validVODManifest) {
      return;
    }

    this.closeVODManifest();

    const finalIndex = this.index++;
    this.uploadManifest(this.vodSwarmManifestName, finalIndex);

    await this.segmentQueue.onIdle();
    await this.manifestQueue.onIdle();

    const identifier = Identifier.fromString(this.gsocRawTopic);
    const data = {
      owner: this.streamSigner.publicKey().address().toHex(),
      topic: this.streamRawTopic,
      state: 'VOD',
      index: finalIndex,
      duration: this.getTotalDurationFromFile(),
      mediatype: this.mediatype,
    };

    return retryAwaitableAsync(() => this.bee.gsocSend(this.stamp, this.gsocSigner, identifier, JSON.stringify(data)));
  }

  public upload(segmentPath: string) {
    if (segmentPath.includes('m3u8')) {
      return;
    }

    const data = this.getSegmentData(segmentPath);

    if (!data?.ref || !data?.segmentData) {
      this.logger.error(`Failed to upload segment: ${segmentPath}`);
      return;
    }

    const segmentEntry = this.getSegmentEntry(segmentPath, data.ref);
    this.buildVODManifest(segmentEntry);

    this.processNewSegment(segmentPath, data.segmentData, data.ref);
    this.processLiveManifest(segmentPath);
  }

  private processLiveManifest(segmentPath: string) {
    this.buildLiveManifest();

    const filename = path.basename(segmentPath);
    const fileIndex = parseInt(filename.match(/\d+/)?.[0] || '', 10);
    this.uploadManifest(this.liveSwarmManifestName, fileIndex);
  }

  private processNewSegment(segmentPath: string, segmentData: Uint8Array, ref: string) {
    this.addToSegmentBuffer(ref);

    this.segmentQueue.add(async () => {
      const result = await this.uploadDataAsSoc(this.index, segmentData);
      if (result) {
        this.logger.log(`Segment upload result: ${segmentPath}`, result.reference.toHex());
      } else {
        this.logger.error(`Failed to upload segment: ${segmentPath}`);
      }
    });
  }

  private uploadManifest(manifestName: string, index = 0) {
    try {
      this.index = index;

      const fullPath = path.join(this.streamPath, manifestName);
      const manifestData = fs.readFileSync(fullPath);

      this.manifestQueue.add(async () => {
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
      const { uploadPayload } = this.bee.makeFeedWriter(Topic.fromString(this.streamRawTopic), this.streamSigner, {});
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

  private closeVODManifest() {
    const swarmManifestPath = path.join(this.streamPath, this.vodSwarmManifestName);
    const close = `#EXT-X-ENDLIST\n`;
    fs.appendFileSync(swarmManifestPath, close);
    this.logger.log(`Manifest closed: ${swarmManifestPath}`);
  }

  private buildVODManifest(segmentEntry: string) {
    if (this.hlsOriginalHeaders.length === 0) {
      this.extractHlsHeaders(this.streamPath);
    }

    const swarmVodManifestPath = path.join(this.streamPath, this.vodSwarmManifestName);
    if (!fs.existsSync(swarmVodManifestPath)) {
      const vodManifestHeaders = [...this.hlsOriginalHeaders, '#EXT-X-PLAYLIST-TYPE:VOD', '#EXT-X-MEDIA-SEQUENCE:0'];
      fs.writeFileSync(swarmVodManifestPath, vodManifestHeaders.join('\n') + '\n');
    }

    fs.appendFileSync(swarmVodManifestPath, segmentEntry + '\n');

    this.logger.log(`VOD Manifest updated: ${swarmVodManifestPath}`);
  }

  private buildLiveManifest() {
    const swarmLiveManifestPath = path.join(this.streamPath, this.liveSwarmManifestName);
    const liveManifestHeaders = [...this.hlsOriginalHeaders, `#EXT-X-MEDIA-SEQUENCE:${this.mediaSequence}`];

    const liveManifestContent = liveManifestHeaders.join('\n') + '\n' + this.segmentBuffer.join('\n') + '\n';
    fs.writeFileSync(swarmLiveManifestPath, liveManifestContent);

    this.logger.log(`Live Manifest updated: ${swarmLiveManifestPath}`);
  }

  private buildSegmentEntry(duration: string, ref: string): string {
    return `#EXTINF:${duration},\n${this.manifestBeeUrl}/${ref}`;
  }

  private extractHlsHeaders(streamPath: string) {
    const origiManifestPath = path.join(streamPath, this.origiManifestName);
    const manifest = fs.readFileSync(origiManifestPath, 'utf-8');
    const lines = manifest.split('\n');
    const headerLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith('#EXTINF')) break;
      if (trimmed.startsWith('#EXT-X-MEDIA-SEQUENCE')) continue;

      headerLines.push(trimmed);
    }

    this.hlsOriginalHeaders = headerLines;
  }

  private getSegmentEntry(segmentPath: string, ref: string) {
    const filename = path.basename(segmentPath);
    const origiManifestPath = path.join(this.streamPath, this.origiManifestName);

    const extInf = this.getExtInfFromFile(origiManifestPath, filename);
    if (!extInf) {
      throw new Error(`Failed to get EXTINF for ${filename}`);
    }

    const segmentEntry = this.buildSegmentEntry(extInf, ref);
    return segmentEntry;
  }

  private getExtInfFromFile(path: string, segmentName: string): string | null {
    const manifest = fs.readFileSync(path, 'utf-8');
    const lines = manifest.trim().split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line === segmentName && i > 0) {
        const prevLine = lines[i - 1].trim();
        const match = prevLine.match(/^#EXTINF:([\d.]+),?/);
        if (match) {
          return match[1];
        }
      }
    }

    return null;
  }

  private getTotalDurationFromFile() {
    const swarmManifestPath = path.join(this.streamPath, this.vodSwarmManifestName);
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

  private getSegmentData(segmentPath: string) {
    try {
      const segmentData = fs.readFileSync(segmentPath);
      const data = makeChunkedFile(segmentData);
      const ref = Bytes.fromSlice(data.rootChunk().address(), 0).toHex();
      return { segmentData, ref };
    } catch (error) {
      this.errorHandler.handleError(error, 'SwarmStreamUploader.uploadSegment');
    }
  }

  private addToSegmentBuffer(ref: string) {
    const vodManifestPath = path.join(this.streamPath, this.vodSwarmManifestName);
    const segmentName = `${this.manifestBeeUrl}/${ref}`;
    const extInf = this.getExtInfFromFile(vodManifestPath, segmentName);

    if (!extInf) {
      throw new Error(`Failed to get EXTINF for ${segmentName}`);
    }

    const segmentEntry = this.buildSegmentEntry(extInf, ref);

    if (this.segmentBuffer.length === this.segmentBufferSize) {
      this.segmentBuffer.shift();
      this.mediaSequence++;
    }
    this.segmentBuffer.push(segmentEntry);
  }

  private isFinalVODManifestValid(): boolean {
    const vodManifestPath = path.join(this.streamPath, this.vodSwarmManifestName);
    if (!fs.existsSync(vodManifestPath)) {
      return false;
    }

    const content = fs.readFileSync(vodManifestPath, 'utf-8').trim();
    const lines = content.split('\n');

    // meta check?
    let hasExtinf = false;
    let hasSegmentUri = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.startsWith('#EXTINF:')) {
        hasExtinf = true;

        const nextLine = lines[i + 1]?.trim();
        if (nextLine && !nextLine.startsWith('#')) {
          hasSegmentUri = true;
        }
      }
    }

    if (!hasExtinf || !hasSegmentUri) {
      this.logger.warn('Invalid VOD manifest: missing required tags or segments.');
      return false;
    }

    return true;
  }
}
