import { program } from 'commander'
import crypto from 'crypto'
import dayjs from 'dayjs'

const DEFAULT_STREAM = 'default_stream'
const DEFAULT_EXPIRES = 60

function validateEnvironmentVariable(): string {
  const value: string | undefined = process.env['RTMP_SECRET']
  if (!value) {
    throw new Error('RTMP_SECRET environment variable is not defined')
  }
  return value
}

function validatePositiveInteger(value: string, name: string): number {
  const parsed = parseInt(value, 10)
  if (isNaN(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
}

export function generateStreamKey(stream: string, secret: string, expiresInMinutes: number): string {
  const exp: number = Math.floor(dayjs().add(expiresInMinutes, 'minute').unix())
  const base: string = `${stream}?exp=${exp}`
  const sign: string = crypto.createHmac('sha256', secret).update(base).digest('hex')
  return `${base}&sign=${sign}`
}

export function runCLI(): void {
  program
    .option('-s, --stream <name>', 'Stream name', DEFAULT_STREAM)
    .option('-e, --expires <minutes>', 'Expires in N minutes', DEFAULT_EXPIRES.toString())
  program.parse()

  const options = program.opts()
  const stream = options.stream
  const expiresInMinutes = validatePositiveInteger(options.expires, 'Expires')
  const secret = validateEnvironmentVariable()

  const streamKey = generateStreamKey(stream, secret, expiresInMinutes)

  console.log('\n OBS Stream Key:')
  console.log(streamKey)
  console.log('\n Full RTMP URL example:')
  console.log(`rtmp://localhost/live/${streamKey}\n`)
}
