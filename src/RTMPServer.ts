import { execSync } from 'child_process'
import crypto from 'crypto'
import NodeMediaServer from 'node-media-server'

export function startRtmpServer(mediaRootPath: string, ffmpegPath: string): void {
  if (!mediaRootPath) {
    console.error('Media root path is required.')
    return
  }
  let ffmpegPathDefault = ''
  if (!ffmpegPath) {
    // check if ffmpeg is installed
    try {
      ffmpegPathDefault = execSync('which ffmpeg').toString().trim()
      ffmpegPath = ffmpegPathDefault
      console.log('ffmpeg path is not provided, using default path:', ffmpegPath)
    } catch (error) {
      console.error('ffmpeg not found, path is required')
      return
    }
  }
  try {
    const ffmpegversion = execSync(`${ffmpegPath} -version`)

    // Assigning the FFmpeg version to a global variable.
    // This is required because the `NodeTransServer` in the `node-media-server`
    // package internally references a `version` variable in its `run` method,
    // and there is no direct way to inject it into the package's scope.
    // Using `(global as any)` is a workaround to make the `version` variable
    // accessible globally.
    // Note: Consider refactoring if the `node-media-server` package
    // provides a better way to handle this in the future.
    if (ffmpegversion) {
      ;(global as any).version = ffmpegversion.toString().trim()
    }
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
  server.on('prePublish', (id: string, streamPath: string, args: Record<string, any>) => {
    const session = server.getSession(id)
    const { sign, exp } = args
    const stream = streamPath.split('/')[2]
    const secret = process.env['RTMP_SECRET']

    if (!secret || !stream || !sign || !exp) {
      console.log(`Unauthorized stream: id=${id}, streamPath=${streamPath}, missing parameters or RTMP_SECRET`)
      session?.reject()
      return
    }

    const hash = crypto.createHmac('sha256', secret).update(`${stream}?exp=${exp}`).digest('hex')
    const currentTime = Math.floor(Date.now() / 1000)
    console.log(currentTime)
    console.log(parseInt(exp, 10))
    if (hash !== sign || parseInt(exp, 10) < currentTime) {
      console.log(`Unauthorized stream: id=${id}, streamPath=${streamPath}, invalid or expired signature`)
      session?.reject()
      return
    }
    console.log(`Stream authorized: id=${id}, streamPath=${streamPath}, args=${JSON.stringify(args)}`)
  })

  server.run()
}
