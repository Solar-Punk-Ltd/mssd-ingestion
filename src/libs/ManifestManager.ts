import fs from 'fs';
import path from 'path';

import { sleep } from '../utils/common.js';

import { Logger } from './Logger.js';

interface SegmentBufferEntry {
  origiName: string;
  ref: string;
}

export class ManifestManager {
  constructor(private streamPath: string, private manifestBeeUrl: string) {}

  private liveSwarmManifestName = 'playlist-live.m3u8';
  private vodSwarmManifestName = 'playlist-vod.m3u8';
  private origiManifestName = 'index.m3u8';
  private segmentBuffer: SegmentBufferEntry[] = [];
  private originalManifest: string = '';
  private hlsOriginalHeaders: string[] = [];
  private logger = Logger.getInstance();

  public getLiveManifestName(): string {
    return this.liveSwarmManifestName;
  }

  public getVODManifestName(): string {
    return this.vodSwarmManifestName;
  }

  public getOrigiManifestName(): string {
    return this.origiManifestName;
  }

  public setOriginalManifest() {
    const p = this.getOrigiManifestPath();
    if (fs.existsSync(p)) {
      this.originalManifest = fs.readFileSync(p, 'utf-8');
    }
  }

  public async buildManifests() {
    const segmentEntry = await this.getSegmentEntry();
    if (!segmentEntry) {
      this.logger.warn('No segment entry to build manifests');
      return;
    }

    this.buildVODManifest(segmentEntry);
    this.buildLiveManifest();
  }

  private buildVODManifest(segmentEntry: string) {
    if (this.hlsOriginalHeaders.length === 0) {
      this.extractHlsHeaders();
    }

    const p = this.getVODManifestPath();
    if (!fs.existsSync(p)) {
      const hdrs = [...this.hlsOriginalHeaders, '#EXT-X-PLAYLIST-TYPE:VOD', '#EXT-X-MEDIA-SEQUENCE:0'];
      fs.writeFileSync(p, hdrs.join('\n') + '\n');
    }

    fs.appendFileSync(p, segmentEntry + '\n');
    this.logger.log(`VOD Manifest updated: ${p}`);
  }

  private buildLiveManifest() {
    const mediaSequence = this.extractMediaSequenceFromManifest(this.originalManifest);
    if (mediaSequence === null) {
      throw new Error('Failed to extract media sequence from original manifest');
    }

    const hdrs = [...this.hlsOriginalHeaders, `#EXT-X-MEDIA-SEQUENCE:${mediaSequence}`];
    const entries = this.extractSegmentEntriesFromVODManifest(mediaSequence);

    const p = this.getLiveManifestPath();
    const content = hdrs.join('\n') + '\n' + entries.join('\n') + '\n';
    fs.writeFileSync(p, content);

    this.logger.log(`Live Manifest updated: ${p}`);
  }

  public closeVODManifest() {
    const vodPath = this.getVODManifestPath();
    fs.appendFileSync(vodPath, '#EXT-X-ENDLIST\n');
    this.logger.log(`Manifest closed: ${vodPath}`);
  }

  public getTotalDurationFromVodManifest(): number {
    const p = this.getVODManifestPath();
    const manifest = fs.readFileSync(p, 'utf-8');

    return manifest
      .split('\n')
      .filter(l => l.startsWith('#EXTINF'))
      .reduce((sum, l) => sum + parseFloat(l.split(':')[1]) || 0, 0);
  }

  private async getSegmentEntry(retries = 10, delayMs = 250): Promise<string | null> {
    let attempt = 0;

    while (attempt <= retries) {
      const oldestSegment = this.segmentBuffer.shift();

      if (oldestSegment) {
        const segmentName = oldestSegment.origiName;
        const extInf = this.getExtInfFromManifest(this.originalManifest, segmentName);

        if (!extInf) {
          throw new Error(`Failed to get EXTINF for ${segmentName}`);
        }

        return this.buildSegmentEntry(extInf, oldestSegment.ref);
      }

      attempt++;
      if (attempt <= retries) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    return null;
  }

  public addToSegmentBuffer(segmentPath: string, ref: string) {
    const origiName = path.basename(segmentPath);
    this.segmentBuffer.push({ origiName, ref });
  }

  public isFinalVODManifestValid(): boolean {
    const p = this.getVODManifestPath();
    if (!fs.existsSync(p)) {
      return false;
    }

    const lines = fs.readFileSync(p, 'utf-8').trim().split('\n');
    let hasExtinf = false;
    let hasUri = false;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('#EXTINF:')) {
        hasExtinf = true;
        const next = lines[i + 1]?.trim();

        if (next && !next.startsWith('#')) {
          hasUri = true;
        }
      }
    }
    return hasExtinf && hasUri;
  }

  private extractMediaSequenceFromManifest(manifest: string): number | null {
    const match = manifest.match(/^#EXT-X-MEDIA-SEQUENCE:(\d+)/m);
    return match ? parseInt(match[1], 10) : null;
  }

  private extractHlsHeaders() {
    const origiManifestPath = this.getOrigiManifestPath();
    const manifest = fs.readFileSync(origiManifestPath, 'utf-8');
    const lines = manifest.split('\n');
    const headerLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#EXTINF')) {
        break;
      }
      if (trimmed.startsWith('#EXT-X-MEDIA-SEQUENCE')) {
        continue;
      }
      headerLines.push(trimmed);
    }

    this.hlsOriginalHeaders = headerLines;
  }

  private getExtInfFromManifest(manifest: string, segmentName: string): string | null {
    const lines = manifest.split('\n');

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === segmentName && i > 0) {
        const match = lines[i - 1].trim().match(/^#EXTINF:([\d.]+),?/);
        if (match) {
          return match[1];
        }
      }
    }
    return null;
  }

  private extractSegmentEntriesFromVODManifest(mediaSequence: number): string[] {
    const vodManifestPath = this.getVODManifestPath();
    if (!fs.existsSync(vodManifestPath)) {
      throw new Error(`VOD manifest not found: ${vodManifestPath}`);
    }

    const manifest = fs.readFileSync(vodManifestPath, 'utf-8');
    const lines = manifest.trim().split('\n');
    const entries: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('#EXTINF')) {
        const segmentLine = lines[i + 1];
        if (segmentLine && !segmentLine.startsWith('#')) {
          entries.push(`${lines[i]}\n${segmentLine}`);
          i++; // skip the next line (segment URL) since we already added it
        }
      }
    }

    return entries.slice(mediaSequence);
  }

  public async waitForStreamDrain(dirPath: string, updateManifest: () => Promise<void>): Promise<boolean> {
    let lastIndex = this.getMaxSegmentIndex(dirPath);
    let lastBufferSize = this.segmentBuffer.length;

    if (lastIndex === -1 && lastBufferSize === 0) {
      return true;
    }

    const start = Date.now();
    const timeout = 5 * 60 * 1000; // 5 minutes

    this.logger.log(`Waiting for stream drain: .ts max index=${lastIndex}, buffer size=${lastBufferSize}`);

    // eslint-disable-next-line no-constant-condition
    while (true) {
      await sleep(2000);

      const currentIndex = this.getMaxSegmentIndex(dirPath);
      const currentBufferSize = this.segmentBuffer.length;

      // Check for drain completion
      if (currentIndex === -1 && currentBufferSize === 0) {
        this.logger.log(`Stream drain complete: all .ts segments removed and buffer empty.`);
        return true;
      }

      // If buffer not empty, call updateManifest
      if (currentBufferSize > 0) {
        this.logger.debug(`Buffer not empty (size: ${currentBufferSize}), updating manifest...`);
        await updateManifest();
      }

      // Timeout if nothing is progressing
      if (currentIndex >= lastIndex && currentBufferSize >= lastBufferSize && Date.now() - start > timeout) {
        this.logger.warn(
          `Drain stuck at .ts index ${currentIndex}, buffer size ${currentBufferSize} for over 5 minutes, aborting wait.`,
        );
        return false;
      }

      if (currentIndex >= lastIndex && currentIndex !== -1) {
        this.logger.debug(`Still waiting… .ts segment index not decreasing (still at ${currentIndex})`);
      }

      if (currentBufferSize >= lastBufferSize && currentBufferSize !== 0) {
        this.logger.debug(`Still waiting… buffer size not decreasing (still at ${currentBufferSize})`);
      }

      lastIndex = currentIndex;
      lastBufferSize = currentBufferSize;
    }
  }

  private getMaxSegmentIndex(dir: string): number {
    let max = -1;
    const files = fs.readdirSync(dir);

    for (const file of files) {
      const match = file.match(/^index(\d+)\.ts$/);
      if (match) {
        const index = parseInt(match[1], 10);
        if (index > max) {
          max = index;
        }
      }
    }
    return max;
  }

  private getOrigiManifestPath(): string {
    return path.join(this.streamPath, this.origiManifestName);
  }

  private getLiveManifestPath(): string {
    return path.join(this.streamPath, this.liveSwarmManifestName);
  }

  private getVODManifestPath(): string {
    return path.join(this.streamPath, this.vodSwarmManifestName);
  }

  private buildSegmentEntry(duration: string, ref: string): string {
    return `#EXTINF:${duration},\n${this.manifestBeeUrl}/${ref}`;
  }
}
