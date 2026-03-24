import fs from 'fs';
import path from 'path';

import { sleep } from '../utils/common.js';

import { Logger } from './Logger.js';

interface SegmentBufferEntry {
  origiName: string;
  ref: string;
  index: number;
}

export class ManifestManager {
  constructor(private streamPath: string, private manifestBeeUrl: string) {}

  private liveSwarmManifestName = 'playlist-live.m3u8';
  private vodSwarmManifestName = 'playlist-vod.m3u8';
  private origiManifestName = 'index.m3u8';

  private segmentBuffer = new Map<number, SegmentBufferEntry>();

  private originalManifest: string = '';
  private hlsOriginalHeaders: string[] = [];
  private logger = Logger.getInstance();
  private lastProcessedIndex: number = -1;

  private extinfCache = new Map<string, string>();
  private deferralCounts = new Map<string, number>();
  private readonly MAX_DEFERRALS = 10;
  private lastCachedLine = 0;

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
      this.cacheExtinfEntries(this.originalManifest);
    }
  }

  private cacheExtinfEntries(manifest: string) {
    const lines = manifest.split('\n');
    let cachedCount = 0;

    const startLine = Math.max(0, this.lastCachedLine - 5);

    for (let i = startLine; i < lines.length; i++) {
      if (lines[i].startsWith('#EXTINF:')) {
        const extinfMatch = lines[i].trim().match(/^#EXTINF:([\d.]+),?/);
        const segmentLine = lines[i + 1]?.trim();

        if (extinfMatch && segmentLine && !segmentLine.startsWith('#')) {
          const duration = extinfMatch[1];
          const segmentName = segmentLine;

          if (!this.extinfCache.has(segmentName)) {
            this.extinfCache.set(segmentName, duration);
            cachedCount++;
          }
        }
      }
    }

    this.lastCachedLine = Math.max(0, lines.length - 10);

    if (cachedCount > 0) {
      this.logger.debug(`Cached ${cachedCount} new EXTINF entries. Total cached: ${this.extinfCache.size}`);
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
    const vodManifestPath = this.getVODManifestPath();
    if (!fs.existsSync(vodManifestPath)) {
      this.logger.warn('VOD manifest does not exist yet, skipping live manifest build');
      return;
    }

    const manifest = fs.readFileSync(vodManifestPath, 'utf-8');
    const lines = manifest.trim().split('\n');
    const entries: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('#EXTINF')) {
        const segmentLine = lines[i + 1];
        if (segmentLine && !segmentLine.startsWith('#')) {
          entries.push(`${lines[i]}\n${segmentLine}`);
          i++;
        }
      }
    }

    const totalSegments = entries.length;

    if (totalSegments === 0) {
      this.logger.warn('VOD manifest has no segments yet, skipping live manifest build');
      return;
    }

    const targetWindowSize = 10;
    let mediaSequence = 0;
    let liveEntries: string[] = [];

    if (totalSegments <= targetWindowSize) {
      mediaSequence = 0;
      liveEntries = entries;
    } else {
      mediaSequence = totalSegments - targetWindowSize;
      liveEntries = entries.slice(mediaSequence);
    }

    const hdrs = [...this.hlsOriginalHeaders, `#EXT-X-MEDIA-SEQUENCE:${mediaSequence}`];
    const p = this.getLiveManifestPath();
    const content = hdrs.join('\n') + '\n' + liveEntries.join('\n') + '\n';
    fs.writeFileSync(p, content);

    this.logger.log(
      `Live Manifest updated: ${p} (mediaSequence: ${mediaSequence}, segments: ${liveEntries.length}/${totalSegments})`,
    );
  }

  public closeVODManifest() {
    const vodPath = this.getVODManifestPath();
    if (!fs.existsSync(vodPath)) {
      this.logger.error('Cannot close VOD manifest - file does not exist');
      return;
    }
    fs.appendFileSync(vodPath, '#EXT-X-ENDLIST\n');
    this.logger.log(`Manifest closed: ${vodPath}`);
  }

  public getTotalDurationFromVodManifest(): number {
    const p = this.getVODManifestPath();
    const manifest = fs.readFileSync(p, 'utf-8');

    return manifest
      .split('\n')
      .filter(l => l.startsWith('#EXTINF'))
      .reduce((sum, l) => {
        const duration = parseFloat(l.split(':')[1]?.split(',')[0] || '0');
        return sum + duration;
      }, 0);
  }

  private async getSegmentEntry(retries = 10, delayMs = 250): Promise<string | null> {
    let attempt = 0;

    while (attempt <= retries) {
      let nextExpectedIndex = this.lastProcessedIndex + 1;

      // If no segments processed yet, jump to the lowest available index
      if (this.lastProcessedIndex === -1 && this.segmentBuffer.size > 0) {
        nextExpectedIndex = Math.min(...this.segmentBuffer.keys());
      }

      const segment = this.segmentBuffer.get(nextExpectedIndex);

      if (segment) {
        const segmentName = segment.origiName;
        const extInf = this.getExtInfFromManifest(this.originalManifest, segmentName);

        if (!extInf) {
          const deferrals = this.deferralCounts.get(segmentName) || 0;

          if (deferrals >= this.MAX_DEFERRALS) {
            this.logger.error(
              `Segment ${segmentName} never appeared in manifest after ${deferrals} attempts, skipping`,
            );

            this.segmentBuffer.delete(nextExpectedIndex);
            this.deferralCounts.delete(segmentName);
            this.lastProcessedIndex = nextExpectedIndex;

            continue;
          }

          this.deferralCounts.set(segmentName, deferrals + 1);
          this.logger.debug(
            `Segment ${segmentName} not yet in manifest, deferring (attempt ${deferrals + 1}/${this.MAX_DEFERRALS})`,
          );
          return null;
        }

        this.segmentBuffer.delete(nextExpectedIndex);
        this.deferralCounts.delete(segmentName);
        this.lastProcessedIndex = segment.index;

        this.logger.debug(
          `Processing segment ${segmentName} (index ${segment.index}). Buffer size: ${this.segmentBuffer.size}`,
        );

        return this.buildSegmentEntry(extInf, segment.ref);
      }

      if (this.segmentBuffer.size > 0) {
        const bufferIndices = Array.from(this.segmentBuffer.keys()).sort((a, b) => a - b);
        this.logger.debug(`Waiting for segment index ${nextExpectedIndex}. Buffer has: [${bufferIndices.join(', ')}]`);
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

    const match = origiName.match(/(\d+)\.ts$/);
    if (!match) {
      this.logger.warn(`Could not extract index from segment name: ${origiName}, using -1`);
      this.segmentBuffer.set(-1, { origiName, ref, index: -1 });
      return;
    }

    const index = parseInt(match[1], 10);
    this.segmentBuffer.set(index, { origiName, ref, index });

    this.logger.debug(`Added segment ${origiName} (index ${index}) to buffer. Buffer size: ${this.segmentBuffer.size}`);
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

  public async waitForStreamDrain(
    updateManifest: () => Promise<void>,
    timeout: number = 5 * 60 * 1000,
  ): Promise<boolean> {
    if (this.segmentBuffer.size === 0) {
      return true;
    }

    const start = Date.now();
    let lastBufferSize = this.segmentBuffer.size;

    this.logger.log(`Waiting for stream drain: buffer size=${lastBufferSize}`);

    // eslint-disable-next-line no-constant-condition
    while (true) {
      await sleep(2000);

      const currentBufferSize = this.segmentBuffer.size;

      if (currentBufferSize === 0) {
        this.logger.log(`Stream drain complete: buffer empty.`);
        return true;
      }

      if (currentBufferSize > 0) {
        this.logger.debug(`Buffer not empty (size: ${currentBufferSize}), updating manifest...`);
        await updateManifest();
      }

      if (currentBufferSize >= lastBufferSize && Date.now() - start > timeout) {
        this.logger.warn(`Drain timeout after 5 minutes. Force-processing ${currentBufferSize} stuck segments...`);

        const sortedIndices = Array.from(this.segmentBuffer.keys()).sort((a, b) => a - b);

        for (const index of sortedIndices) {
          const segment = this.segmentBuffer.get(index)!;
          const duration = this.extinfCache.get(segment.origiName) || '5.0';
          const entry = this.buildSegmentEntry(duration, segment.ref);
          this.buildVODManifest(entry);
          this.segmentBuffer.delete(index);
        }

        this.logger.log(`Force-processed all stuck segments. VOD manifest completed.`);
        return true;
      }

      lastBufferSize = currentBufferSize;
    }
  }

  public cleanup() {
    this.extinfCache.clear();
    this.segmentBuffer.clear();
    this.deferralCounts.clear();
    this.lastProcessedIndex = -1;
    this.lastCachedLine = 0;
    this.originalManifest = '';
    this.hlsOriginalHeaders = [];
    this.logger.log('ManifestManager cleaned up');
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
    const cached = this.extinfCache.get(segmentName);
    if (cached) {
      return cached;
    }

    const lines = manifest.split('\n');

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === segmentName && i > 0) {
        const match = lines[i - 1].trim().match(/^#EXTINF:([\d.]+),?/);
        if (match) {
          this.extinfCache.set(segmentName, match[1]);
          return match[1];
        }
      }
    }
    return null;
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
    const uri = this.manifestBeeUrl ? `${this.manifestBeeUrl}/${ref}` : ref;
    return `#EXTINF:${duration},\n${uri}`;
  }
}
