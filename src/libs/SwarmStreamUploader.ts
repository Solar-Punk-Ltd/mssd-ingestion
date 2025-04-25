import { Bee, Bytes, Identifier, PrivateKey, Topic } from '@ethersphere/bee-js';
import { makeChunkedFile } from '@fairdatasociety/bmt-js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { retryAwaitableAsync } from '../utils/common';

import { ErrorHandler } from './ErrorHandler';
import { HlsManifestManager } from './HlsManifestManager';
import { Logger } from './Logger';
import { Queue } from './Queue';

export class SwarmStreamUploader {
  private swarmManifestName = 'playlist.m3u8';
  private origiManifestName = 'index.m3u8';

  private uploadQueue = new Queue();
  private logger = Logger.getInstance();
  private errorHandler = ErrorHandler.getInstance();

  private bee: Bee;
  private stamp: string;
  private streamSigner: PrivateKey;
  private streamRawTopic: string;
  private gsocSigner: PrivateKey;
  private gsocIdentifier: Identifier;
  private manifestBeeUrl: string;
  private streamPath: string;

  private manifestManager: HlsManifestManager;
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
    this.stamp = stamp;
    this.streamPath = streamPath;
    this.manifestBeeUrl = `${swarmRpc}/read/bytes`;

    this.streamSigner = new PrivateKey(streamKey);
    this.streamRawTopic = crypto.randomUUID();
    this.gsocSigner = new PrivateKey(gsocResId);
    this.gsocIdentifier = Identifier.fromString(gsocTopic);

    const originalManifestPath = path.join(streamPath, this.origiManifestName);
    const swarmManifestPath = path.join(streamPath, this.swarmManifestName);
    this.manifestManager = new HlsManifestManager({
      originalManifestPath,
      swarmManifestPath,
      manifestBeeUrl: this.manifestBeeUrl,
    });

    if (fs.existsSync(originalManifestPath)) {
      this.manifestManager.loadOriginalManifest();
    }
  }

  /** Start broadcast: send 'live' message and return its result */
  public async broadcastStart(): Promise<any> {
    const payload = {
      owner: this.streamSigner.publicKey().address().toHex(),
      topic: this.streamRawTopic,
      state: 'live',
    };
    const result = await retryAwaitableAsync(() =>
      this.bee.gsocSend(this.stamp, this.gsocSigner, this.gsocIdentifier, JSON.stringify(payload)),
    );
    this.logger.log('Broadcast start sent to GSOC feed', payload);
    return result;
  }

  /** Stop broadcast: append ENDLIST, finalize playlist, send 'VOD' message and return its result */
  public async broadcastStop(): Promise<any> {
    await this.uploadQueue.waitForProcessing();

    // Append the #EXT-X-ENDLIST tag
    const swarmManifestPath = path.join(this.streamPath, this.swarmManifestName);
    fs.appendFileSync(swarmManifestPath, '#EXT-X-ENDLIST\n');

    this.manifestManager.closePlaylist();
    this.manifestManager.saveManifest();

    // Upload final manifest snapshot
    const finalIndex = this.index++;
    await this.uploadManifest(finalIndex);

    // Compute total duration for VOD metadata
    const duration = this.getTotalDurationFromFile();

    const payload = {
      owner: this.streamSigner.publicKey().address().toHex(),
      topic: this.streamRawTopic,
      state: 'VOD',
      index: finalIndex,
      duration,
    };
    const result = await retryAwaitableAsync(() =>
      this.bee.gsocSend(this.stamp, this.gsocSigner, this.gsocIdentifier, JSON.stringify(payload)),
    );
    this.logger.log('Broadcast stop sent to GSOC feed', payload);
    return result;
  }

  /** Called when chokidar detects a new segment file */
  public upload(segmentPath: string): void {
    if (segmentPath.endsWith('.m3u8')) return;

    const ref = this.uploadSegment(segmentPath);
    if (!ref) return;

    // Update and write the swarm manifest
    const duration = this.manifestManager.getSegmentDurationFromOriginal(segmentPath);
    this.manifestManager.addSegment(ref, duration);
    this.manifestManager.saveManifest();

    // Push the updated manifest to Swarm feed
    const fileIndex = parseInt(path.basename(segmentPath).match(/\d+/)?.[0] || '0', 10);
    this.uploadQueue.enqueue(() => this.uploadManifest(fileIndex));

    // Clean up the local segment file
    this.rmProcessedSegment(segmentPath);
  }

  /** Encapsulates reading + enqueuing the segment upload, returns the Swarm ref */
  private uploadSegment(segmentPath: string): string | undefined {
    try {
      const segmentData = fs.readFileSync(segmentPath);
      this.uploadQueue.enqueue(async () => {
        const res = await this.uploadDataToBee(segmentData);
        if (res) {
          this.logger.log(`Segment uploaded: ${path.basename(segmentPath)} → ${res.reference.toHex()}`);
        } else {
          this.logger.error(`Segment upload failed: ${segmentPath}`);
        }
      });
      const chunked = makeChunkedFile(segmentData);
      return Bytes.fromSlice(chunked.rootChunk().address(), 0).toHex();
    } catch (err) {
      this.errorHandler.handleError(err, 'SwarmStreamUploader.uploadSegment');
      return undefined;
    }
  }

  /** Total up all the EXTINF lines in the current swarm playlist file */
  private getTotalDurationFromFile(): number {
    const swarmManifestPath = path.join(this.streamPath, this.swarmManifestName);
    const content = fs.readFileSync(swarmManifestPath, 'utf-8');
    return content
      .split('\n')
      .filter(line => line.startsWith('#EXTINF'))
      .reduce((sum, line) => sum + parseFloat(line.split(':')[1]), 0);
  }

  /** Enqueue pushing the current manifest snapshot to the Swarm feed */
  private async uploadManifest(index: number): Promise<void> {
    this.index = index;
    const content = Buffer.from(this.manifestManager.getManifestContent(), 'utf-8');
    this.uploadQueue.enqueue(async () => {
      const res = await this.uploadDataAsSoc(index, content);
      if (res) {
        this.logger.log(`Manifest uploaded (index=${index}) → ${res.reference.toHex()}`);
      } else {
        this.logger.error(`Manifest upload failed at index ${index}`);
      }
    });
  }

  /** Send bytes as a SOC feed payload */
  private async uploadDataAsSoc(index: number, data: Uint8Array) {
    try {
      const { uploadPayload } = this.bee.makeFeedWriter(Topic.fromString(this.streamRawTopic), this.streamSigner);
      return await uploadPayload(this.stamp, data, { index });
    } catch (err) {
      this.errorHandler.handleError(err, 'SwarmStreamUploader.uploadDataAsSoc');
      return null;
    }
  }

  /** Send raw data to Swarm */
  private async uploadDataToBee(data: Uint8Array) {
    try {
      return await retryAwaitableAsync(() => this.bee.uploadData(this.stamp, data));
    } catch (err) {
      this.errorHandler.handleError(err, 'SwarmStreamUploader.uploadDataToBee');
      return null;
    }
  }

  /** Remove the TS file once it’s been enqueued */
  private rmProcessedSegment(segmentPath: string): void {
    try {
      fs.rmSync(segmentPath, { force: true });
      this.logger.log(`Deleted local segment: ${segmentPath}`);
    } catch (err) {
      this.errorHandler.handleError(err, 'SwarmStreamUploader.rmProcessedSegment');
    }
  }
}
