import { startRtmpServer } from './RTMPServer'

import { execSync } from 'child_process'
import NodeMediaServer from 'node-media-server'

jest.mock('node-media-server')
jest.mock('child_process', () => ({
  execSync: jest.fn(),
}))

describe('startRtmpServer', () => {
  const mockRun = jest.fn()
  const mockStop = jest.fn()

  beforeAll(() => {
    ;(NodeMediaServer as jest.Mock).mockImplementation(() => ({
      run: mockRun,
      stop: mockStop,
    }))
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should log an error if mediaRootPath is not provided', () => {
    console.error = jest.fn()

    startRtmpServer('', '/path/to/ffmpeg')

    expect(console.error).toHaveBeenCalledWith('Media root path is required.')
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('should log an error if ffmpegPath is not provided and FFmpeg is not installed', () => {
    console.error = jest.fn()
    ;(execSync as jest.Mock).mockImplementation(() => {
      throw new Error('FFmpeg not found')
    })

    startRtmpServer('/path/to/media', '')

    expect(console.error).toHaveBeenCalledWith('ffmpeg not found, path is required')
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('should log an error if FFmpeg is not installed or not found in the specified path', () => {
    console.error = jest.fn()
    ;(execSync as jest.Mock).mockImplementation(() => {
      throw new Error('FFmpeg not found')
    })

    startRtmpServer('/path/to/media', '/path/to/ffmpeg')

    expect(console.error).toHaveBeenCalledWith('FFmpeg is not installed or not found in the specified path.')
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('should start the NodeMediaServer if all parameters are valid', () => {
    ;(execSync as jest.Mock).mockImplementation(() => {}) // Mock FFmpeg check to pass

    startRtmpServer('/path/to/media', '/path/to/ffmpeg')

    expect(execSync).toHaveBeenCalledWith('/path/to/ffmpeg -version', { stdio: 'ignore' })
    expect(NodeMediaServer).toHaveBeenCalledWith({
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
        mediaroot: '/path/to/media',
      },
      trans: {
        ffmpeg: '/path/to/ffmpeg',
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
    expect(mockRun).toHaveBeenCalled()
  })
})
