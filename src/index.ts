import { startRtmpServer } from './RTMPServer'

const mediaRootPath = process.argv[2] || './media' // Get from CLI or use default
const ffmpegPath = process.argv[3]

startRtmpServer(mediaRootPath, ffmpegPath)
