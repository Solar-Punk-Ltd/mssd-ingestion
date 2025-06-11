import { Bee, Bytes, Identifier, PrivateKey, Topic } from '@ethersphere/bee-js';
import pkg from '@fairdatasociety/bmt-js';
import crypto from 'crypto';
import fs from 'fs';
import PQueue from 'p-queue';
import path from 'path';
const { makeChunkedFile } = pkg;

import { retryAwaitableAsync } from '../utils/common.js';

import { ErrorHandler } from './ErrorHandler.js';
import { Logger } from './Logger.js';
import { ManifestManager } from './ManifestManager.js';

export class SwarmStreamUploader {
  private segmentQueue = new PQueue({ concurrency: 10 });
  private manifestQueue = new PQueue({ concurrency: 1 });
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
  private index: number | null = null;
  private mediatype: string;
  private isFirstSegmentReady = false;
  private isFirstManifestReady = false;

  private manifestManager: ManifestManager;

  constructor(
    bee: Bee,
    manifestBeeUrl: string,
    gsocResId: string,
    gsocTopic: string,
    streamKey: string,
    stamp: string,
    streamPath: string,
    mediatype: string,
  ) {
    this.bee = bee;
    this.manifestBeeUrl = manifestBeeUrl;
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
      title: this.getFormattedDate(),
      owner: this.streamSigner.publicKey().address().toHex(),
      topic: this.streamRawTopic,
      state: 'live',
      mediatype: this.mediatype,
      timestamp: Date.now(),
    };

    this.logger.log(
      `Broadcasting start with data: ${JSON.stringify({
        ...data,
        rawTopic: this.streamRawTopic,
        topic: Topic.fromString(this.streamRawTopic).toString(),
      })}`,
    );

    return retryAwaitableAsync(() => this.bee.gsocSend(this.stamp, this.gsocSigner, identifier, JSON.stringify(data)));
  }

  public async waitForStreamDrain() {
    return this.manifestManager.waitForStreamDrain(this.streamPath, this.onManifestUpdate.bind(this));
  }

  public async broadcastStop() {
    await this.segmentQueue.onIdle();

    const valid = this.manifestManager.isFinalVODManifestValid();
    if (!valid) {
      return;
    }

    this.manifestManager.closeVODManifest();
    this.uploadManifest(this.manifestManager.getVODManifestName());
    await this.manifestQueue.onIdle();

    const identifier = Identifier.fromString(this.gsocRawTopic);
    const data = {
      title: this.getFormattedDate(),
      owner: this.streamSigner.publicKey().address().toHex(),
      topic: this.streamRawTopic,
      state: 'VOD',
      index: this.index,
      duration: this.manifestManager.getTotalDurationFromVodManifest(),
      mediatype: this.mediatype,
      timestamp: Date.now(),
    };

    this.logger.log(
      `Broadcasting stop with data: ${JSON.stringify({
        ...data,
        rawTopic: this.streamRawTopic,
        topic: Topic.fromString(this.streamRawTopic).toString(),
      })}`,
    );

    return retryAwaitableAsync(() => this.bee.gsocSend(this.stamp, this.gsocSigner, identifier, JSON.stringify(data)));
  }

  public onSegmentUpdate(segmentPath: string) {
    const data = this.getSegmentData(segmentPath);
    if (!data?.ref || !data?.segmentData) {
      this.logger.error(`Failed to upload segment: ${segmentPath}`);
      return;
    }

    this.uploadSegment(segmentPath, data.segmentData);
  }

  public async onManifestUpdate() {
    this.manifestManager.setOriginalManifest();
    await this.manifestManager.buildManifests();
    this.uploadManifest(this.manifestManager.getLiveManifestName());
  }

  private uploadSegment(segmentPath: string, segmentData: Uint8Array) {
    this.segmentQueue.add(async () => {
      const result = await this.uploadDataToBee(segmentData);
      if (result) {
        this.manifestManager.addToSegmentBuffer(segmentPath, result.reference.toHex());
        fs.rmSync(segmentPath, { force: true });
        this.isFirstSegmentReady = true;

        this.logger.log(`Segment upload result: ${segmentPath}`, result.reference.toHex());
      } else {
        this.logger.error(`Failed to upload segment: ${segmentPath}`);
      }
    });
  }

  private uploadManifest(manifestName: string) {
    try {
      this.index = this.index === null ? 0 : this.index + 1;

      const fullPath = path.join(this.streamPath, manifestName);
      if (!fs.existsSync(fullPath)) {
        this.logger.error(`Manifest file does not exist: ${fullPath}`);
        return;
      }

      this.manifestQueue.add(async () => {
        const manifestData = fs.readFileSync(fullPath);
        const result = await this.uploadDataAsSoc(this.index!, manifestData);

        if (result) {
          if (this.isFirstSegmentReady && !this.isFirstManifestReady) {
            this.isFirstManifestReady = true;
            await this.broadcastStart();
          }

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
      return retryAwaitableAsync(() => uploadPayload(this.stamp, data, { index }));
    } catch (error) {
      this.errorHandler.handleError(error, 'SwarmStreamUploader.uploadDataAsSoc');
      return null;
    }
  }

  private async uploadDataToBee(data: Uint8Array) {
    try {
      return retryAwaitableAsync(() => this.bee.uploadData(this.stamp, data, { redundancyLevel: 1 }));
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

  private getFormattedDate(): string {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    return `${day}/${month}/${year}`;
  }
}
