import fs from 'fs';
import path from 'path';

import { Logger } from './Logger';

export class ManifestManager {
  constructor(private streamPath: string, private manifestBeeUrl: string, private segmentBufferSize = 10) {}

  private liveSwarmManifestName = 'playlist-live.m3u8';
  private vodSwarmManifestName = 'playlist-vod.m3u8';
  private origiManifestName = 'index.m3u8';
  private mediaSequence = 0;
  private segmentBuffer: string[] = [];
  private hlsOriginalHeaders: string[] = [];
  private logger = Logger.getInstance();

  private extractHlsHeaders() {
    const origiManifestPath = path.join(this.streamPath, this.origiManifestName);
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

  public buildVODManifest(segmentEntry: string) {
    if (this.hlsOriginalHeaders.length === 0) this.extractHlsHeaders();

    const p = path.join(this.streamPath, this.vodSwarmManifestName);
    if (!fs.existsSync(p)) {
      const hdrs = [...this.hlsOriginalHeaders, '#EXT-X-PLAYLIST-TYPE: VOD', '#EXT-X-MEDIA-SEQUENCE: 0'];
      fs.writeFileSync(p, hdrs.join('\n') + '\n');
    }

    fs.appendFileSync(p, segmentEntry + '\n');
    this.logger.log(`VOD Manifest updated: ${p}`);
  }

  public buildLiveManifest() {
    const p = path.join(this.streamPath, this.liveSwarmManifestName);
    const hdrs = [...this.hlsOriginalHeaders, `#EXT-X-MEDIA-SEQUENCE:${this.mediaSequence}`];
    const content = hdrs.join('\n') + '\n' + this.segmentBuffer.join('\n') + '\n';
    fs.writeFileSync(p, content);
    this.logger.log(`Live Manifest updated: ${p}`);
  }

  public closeVODManifest() {
    const p = path.join(this.streamPath, this.vodSwarmManifestName);
    fs.appendFileSync(p, '#EXT-X-ENDLIST\n');
    this.logger.log(`Manifest closed: ${p}`);
  }

  public getTotalDurationFromFile(): number {
    const p = path.join(this.streamPath, this.vodSwarmManifestName);
    const manifest = fs.readFileSync(p, 'utf-8');
    return manifest
      .split('\n')
      .filter(l => l.startsWith('#EXTINF'))
      .reduce((sum, l) => sum + parseFloat(l.split(':')[1]) || 0, 0);
  }

  public getSegmentEntry(segmentPath: string, ref: string): string {
    const filename = path.basename(segmentPath);
    const originalPath = path.join(this.streamPath, this.origiManifestName);
    const extInf = this.getExtInfFromFile(originalPath, filename);
    if (!extInf) throw new Error(`Failed to get EXTINF for ${filename}`);
    return this.buildSegmentEntry(extInf, ref);
  }

  public addToSegmentBuffer(ref: string) {
    const p = path.join(this.streamPath, this.vodSwarmManifestName);
    const segmentName = `${this.manifestBeeUrl}/${ref}`;
    const extInf = this.getExtInfFromFile(p, segmentName);
    if (!extInf) throw new Error(`Failed to get EXTINF for ${segmentName}`);

    if (this.segmentBuffer.length === this.segmentBufferSize) {
      this.segmentBuffer.shift();
      this.mediaSequence++;
    }
    this.segmentBuffer.push(this.buildSegmentEntry(extInf, ref));
  }

  public checkFinalVODManifest(): boolean {
    const p = path.join(this.streamPath, this.vodSwarmManifestName);
    if (!fs.existsSync(p)) return false;
    const lines = fs.readFileSync(p, 'utf-8').trim().split('\n');
    let hasExtinf = false,
      hasUri = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('#EXTINF:')) {
        hasExtinf = true;
        const next = lines[i + 1]?.trim();
        if (next && !next.startsWith('#')) hasUri = true;
      }
    }
    return hasExtinf && hasUri;
  }

  private getExtInfFromFile(p: string, segmentName: string): string | null {
    const manifest = fs.readFileSync(p, 'utf-8');
    const lines = manifest.trim().split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === segmentName && i > 0) {
        const match = lines[i - 1].trim().match(/^#EXTINF:([\d.]+),?/);
        if (match) return match[1];
      }
    }
    return null;
  }

  private buildSegmentEntry(duration: string, ref: string): string {
    return `#EXTINF:${duration},\n${this.manifestBeeUrl}/${ref}`;
  }
}
