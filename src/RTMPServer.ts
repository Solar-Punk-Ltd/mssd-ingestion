import { execSync } from 'child_process'
import NodeMediaServer from 'node-media-server'

export function startRtmpServer(mediaRootPath: string, ffmpegPath: string): void {
  if (!mediaRootPath) {
    console.error('Media root path is required.')
    return
  }
  if (!ffmpegPath) {
    console.error('FFmpeg path is required.')
    return
  }
  try {
    execSync(`${ffmpegPath} -version`, { stdio: 'ignore' })
  } catch (error) {
    console.error('FFmpeg is not installed or not found in the specified path.')
    return
  }
  const server = new NodeMediaServer({
    logType: 4,
    rtmp: {
      port: 1935,
      chunk_size: 60000,
      gop_cache: true,
      ping: 30,
      ping_timeout: 60,
    },
    http: {
      port: 8000,
      allow_origin: '*',
      mediaroot: mediaRootPath,
    },
    trans: {
      ffmpeg: ffmpegPath,
      tasks: [
        {
          app: 'live',
          hls: true,
          hlsKeep: true,
          hlsFlags: '[hls_playlist_type=event:hls_time=5:hls_list_size=0]',
          dash: true,
          dashFlags: '[f=dash:window_size=3:extra_window_size=5]',
        },
      ],
    },
  })

  server.run()
}
