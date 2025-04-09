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
  private queue = new Queue();
  private logger = Logger.getInstance();
  private errorHandler = ErrorHandler.getInstance();

  private bee: Bee;
  private beeUrl: string;
  private gsocSigner: PrivateKey;
  private gsocTopic: string;
  private stamp: string;
  private streamPath: string;

  constructor(beeUrl: string, gsocKey: string, gsocTopic: string, stamp: string, streamPath: string) {
    this.bee = new Bee(beeUrl);
    this.beeUrl = beeUrl;
    this.gsocSigner = new PrivateKey(gsocKey);
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
  }

  private upsertManifest(segmentPath: string, ref: string) {
    const paths = segmentPath.split('/');
    const filename = paths[paths.length - 1];

    const origiManifestPath = path.join(this.streamPath, this.origiManifestName);
    const swarmManifestPath = path.join(this.streamPath, this.swarmManifestName);

    const extInf = this.getExtInfFromFile(origiManifestPath, filename);

    if (!extInf) {
      this.logger.error(`Failed to get EXTINF for ${filename}`);
      return;
    }

    // TODO: make this configurable
    const url = 'https://rpc.swarmens.limo:8443';
    const manifestLine = `#EXTINF:${extInf.toFixed(6)},\n${url}/bytes/${ref}`;

    let manifestContent = '';

    if (!fs.existsSync(swarmManifestPath)) {
      const manifestHeader = this.extractBaseHeaderFrom(origiManifestPath);
      manifestContent = `${manifestHeader}\n${manifestLine}\n`;
      this.logger.log(`Manifest created with first segment: ${filename}`);
    } else {
      manifestContent = fs.readFileSync(swarmManifestPath, 'utf8').trimEnd();
      manifestContent += `\n${manifestLine}`;
      this.logger.log(`Segment appended to manifest: ${filename}`);
    }

    fs.writeFileSync(swarmManifestPath, manifestContent);
  }

  private extractBaseHeaderFrom(path: string): string {
    const content = fs.readFileSync(path, 'utf-8');
    const lines = content.split('\n');

    const headerLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith('#EXTINF')) break;
      headerLines.push(line);
    }

    return headerLines.join('\n');
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
    const fullPath = path.join(this.streamPath, this.swarmManifestName);

    try {
      const manifestData = fs.readFileSync(fullPath);
      const result = await this.uploadDataAsSoc(manifestData);
      if (result) {
        console.log('GSOC manifest upload:', result.reference.toHex()); // TODO logger fix
      }
    } catch (error) {
      this.errorHandler.handleError(error, 'SwarmStreamUploader.uploadManifest');
    }
  }

  private async uploadDataAsSoc(data: Uint8Array) {
    try {
      const identifier = Identifier.fromString(this.gsocTopic);
      return this.bee.gsocSend(this.stamp, this.gsocSigner, identifier, data);
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
