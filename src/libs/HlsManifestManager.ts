import fs from 'fs';
import path from 'path';

export interface HlsManifestOptions {
  originalManifestPath: string;
  swarmManifestPath: string;
  manifestBeeUrl: string;
  targetDuration?: number;
}

interface Segment {
  duration: number;
  uri: string;
}

export class HlsManifestManager {
  private originalManifestPath: string;
  private swarmManifestPath: string;
  private manifestBeeUrl: string;
  private targetDuration: number;
  private mediaSequence: number;
  private segments: Segment[] = [];
  private closed: boolean = false;

  constructor(options: HlsManifestOptions) {
    this.originalManifestPath = options.originalManifestPath;
    this.swarmManifestPath = options.swarmManifestPath;
    this.manifestBeeUrl = options.manifestBeeUrl;
    this.targetDuration = options.targetDuration ?? 6;
    this.mediaSequence = 0;
  }

  /**
   * Load and parse the original manifest file produced by FFmpeg
   */
  public loadOriginalManifest(): void {
    const content = fs.readFileSync(this.originalManifestPath, 'utf-8');
    const lines = content.split(/\r?\n/);
    this.segments = [];
    this.mediaSequence = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('#EXTINF:')) {
        const match = line.match(/^#EXTINF:([\d.]+),?/);
        if (match) {
          const duration = parseFloat(match[1]);
          const uriLine = lines[i + 1]?.trim() || '';
          this.segments.push({ duration, uri: uriLine });
        }
      } else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
        const seq = parseInt(line.split(':')[1], 10);
        if (!isNaN(seq)) this.mediaSequence = seq;
      } else if (line.startsWith('#EXT-X-TARGETDURATION:')) {
        const td = parseInt(line.split(':')[1], 10);
        if (!isNaN(td)) this.targetDuration = td;
      }
    }
  }

  /**
   * Retrieve the duration for a specific segment from the original manifest
   */
  public getSegmentDurationFromOriginal(segmentPath: string): number {
    const name = path.basename(segmentPath);
    const content = fs.readFileSync(this.originalManifestPath, 'utf-8');
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === name && i > 0) {
        const prev = lines[i - 1].trim();
        const match = prev.match(/^#EXTINF:([\d.]+),?/);
        if (match) return parseFloat(match[1]);
      }
    }
    return this.targetDuration;
  }

  /**
   * Add a new segment entry to the playlist (with Swarm URI)
   */
  public addSegment(swarmRef: string, duration: number): void {
    const uri = `${this.manifestBeeUrl}/${swarmRef}`;
    this.segments.push({ duration, uri });
  }

  /**
   * Mark playlist as ended (for VOD)
   */
  public closePlaylist(): void {
    this.closed = true;
  }

  /**
   * Generate HLS manifest content
   */
  public getManifestContent(): string {
    const header = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      `#EXT-X-TARGETDURATION:${this.targetDuration}`,
      `#EXT-X-MEDIA-SEQUENCE:${this.mediaSequence}`,
    ];

    const body = this.segments.flatMap(seg => [`#EXTINF:${seg.duration.toFixed(6)},`, seg.uri]);

    if (this.closed) {
      body.push('#EXT-X-ENDLIST');
    }

    return header.concat(body).join('\n') + '\n';
  }

  /**
   * Persist the updated manifest to disk
   */
  public saveManifest(): void {
    fs.writeFileSync(this.swarmManifestPath, this.getManifestContent());
  }

  /**
   * Compute total duration of all segments in the playlist
   */
  public getTotalDuration(): number {
    return this.segments.reduce((sum, seg) => sum + seg.duration, 0);
  }
}
