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
  private manifestQueue = new PQueue({ concurrency: 10 });
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
    await this.segmentQueue.onIdle();

    const valid = this.manifestManager.isFinalVODManifestValid();
    if (!valid) {
      return;
    }

    this.manifestManager.closeManifests();

    this.uploadManifest(this.manifestManager.getLiveManifestName());
    this.uploadManifest(this.manifestManager.getVODManifestName());

    await this.manifestQueue.onIdle();

    const identifier = Identifier.fromString(this.gsocRawTopic);
    const data = {
      owner: this.streamSigner.publicKey().address().toHex(),
      topic: this.streamRawTopic,
      state: 'VOD',
      index: this.index,
      duration: this.manifestManager.getTotalDurationFromVodManifest(),
      mediatype: this.mediatype,
    };

    return retryAwaitableAsync(() => this.bee.gsocSend(this.stamp, this.gsocSigner, identifier, JSON.stringify(data)));
  }

  public onSegmentUpdate(segmentPath: string) {
    if (segmentPath.includes('m3u8')) {
      return;
    }

    const data = this.getSegmentData(segmentPath);
    if (!data?.ref || !data?.segmentData) {
      this.logger.error(`Failed to upload segment: ${segmentPath}`);
      return;
    }

    this.uploadSegment(segmentPath, data.segmentData);
    this.manifestManager.addToSegmentBuffer(segmentPath, data.ref);
  }

  public onManifestUpdate(manifestPath: string) {
    const fileName = path.basename(manifestPath);
    if (fileName === this.manifestManager.getOrigiManifestName()) {
      this.manifestManager.setOriginalManifest();
      this.manifestManager.buildManifests();
      this.uploadManifest(this.manifestManager.getLiveManifestName());
    }
  }

  private uploadSegment(segmentPath: string, segmentData: Uint8Array) {
    this.segmentQueue.add(async () => {
      const result = await this.uploadDataToBee(segmentData);
      if (result) {
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
      const manifestData = fs.readFileSync(fullPath);

      this.manifestQueue.add(async () => {
        const result = await this.uploadDataAsSoc(this.index!, manifestData);
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
      return retryAwaitableAsync(() => uploadPayload(this.stamp, data, { index }));
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
