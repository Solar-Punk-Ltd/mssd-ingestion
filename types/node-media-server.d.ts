declare module 'node-media-server' {
  interface NodeMediaServerConfig {
    logType?: number;
    bind?: string;
    rtmp?: {
      port: number;
      chunk_size?: number;
      gop_cache?: boolean;
      ping?: number;
      ping_timeout?: number;
    };
    http?: {
      port: number;
      allow_origin?: string;
      mediaroot?: string;
    };
    trans?: {
      ffmpeg: string;
      tasks: Array<{
        app: string;
        hls?: boolean;
        hlsKeep?: boolean;
        hlsFlags?: string;
        dash?: boolean;
        dashFlags?: string;
      }>;
      MediaRoot?: string;
    };
  }

  class NodeMediaServer {
    constructor(config: NodeMediaServerConfig);
    run(): void;
    stop(): void;
    on(...args: any[]): void;
  }

  export = NodeMediaServer;
}
