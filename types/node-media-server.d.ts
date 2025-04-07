declare module 'node-media-server' {
  interface NodeMediaServerConfig {
    logType?: number
    rtmp?: {
      port: number
      chunk_size?: number
      gop_cache?: boolean
      ping?: number
      ping_timeout?: number
    }
    http?: {
      port: number
      allow_origin?: string
      mediaroot?: string
    }
    trans?: {
      ffmpeg: string
      tasks: Array<{
        app: string
        hls?: boolean
        hlsKeep?: boolean
        hlsFlags?: string
        dash?: boolean
        dashFlags?: string
      }>
    }
  }

  class NodeMediaServer {
    constructor(config: NodeMediaServerConfig)
    run(): void
    stop(): void
    on(event: string, callback: (...args: any[]) => void): void
  }

  export = NodeMediaServer
}
