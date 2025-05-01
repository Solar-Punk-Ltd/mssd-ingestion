import { Bee, Bytes, Identifier, PrivateKey, Topic } from '@ethersphere/bee-js';
import { makeChunkedFile } from '@fairdatasociety/bmt-js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { retryAwaitableAsync } from '../utils/common';

import { ErrorHandler } from './ErrorHandler';
import { Logger } from './Logger';
import { ManifestManager } from './ManifestManager';
import { Queue } from './Queue';

export class SwarmStreamUploader {
  private segmentQueue = new Queue();
  private manifestQueue = new Queue();
  private logger = Logger.getInstance();
  private errorHandler = ErrorHandler.getInstance();

  private bee: Bee;
  private manifestBeeUrl: string;
  private streamSigner: PrivateKey;
  private streamRawTopic: string;
  private gsocSigner: PrivateKey;
  private gsocRawTopic: string;
  private streamPath: string;
  private stamp: string;
  private index = 0;
  private mediatype: string;

  private manifestManager: ManifestManager;

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

    this.manifestManager = new ManifestManager(streamPath, this.manifestBeeUrl);
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
    await this.segmentQueue.waitForProcessing();
    await this.manifestQueue.waitForProcessing();

    const valid = this.manifestManager.checkFinalVODManifest();
    if (!valid) return;

    this.manifestManager.closeVODManifest();

    const finalIndex = this.index++;
    this.uploadManifest('playlist-vod.m3u8', finalIndex);

    const identifier = Identifier.fromString(this.gsocRawTopic);
    const data = {
      owner: this.streamSigner.publicKey().address().toHex(),
      topic: this.streamRawTopic,
      state: 'VOD',
      index: finalIndex,
      duration: this.manifestManager.getTotalDurationFromFile(),
      mediatype: this.mediatype,
    };

    return retryAwaitableAsync(() => this.bee.gsocSend(this.stamp, this.gsocSigner, identifier, JSON.stringify(data)));
  }

  public upload(segmentPath: string) {
    if (segmentPath.includes('m3u8')) return;

    const data = this.getSegmentData(segmentPath);
    if (!data?.ref || !data?.segmentData) {
      this.logger.error(`Failed to upload segment: ${segmentPath}`);
      return;
    }

    const segmentEntry = this.manifestManager.getSegmentEntry(segmentPath, data.ref);
    this.manifestManager.buildVODManifest(segmentEntry);

    this.processNewSegment(segmentPath, data.segmentData);
  }

  private processNewSegment(segmentPath: string, segmentData: Uint8Array) {
    const filename = path.basename(segmentPath);
    const fileIndex = parseInt(filename.match(/\d+/)?.[0] || '', 10);

    this.segmentQueue.enqueue(async () => {
      const result = await this.uploadDataToBee(segmentData);
      if (result) {
        const hexRef = result.reference.toHex();
        this.logger.log(`Segment upload result: ${segmentPath}`, hexRef);

        this.manifestManager.addToSegmentBuffer(hexRef);
        this.manifestManager.buildLiveManifest();
        this.uploadManifest('playlist-live.m3u8', fileIndex);
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

      this.manifestQueue.enqueue(async () => {
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
}
