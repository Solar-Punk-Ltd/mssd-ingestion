import { Command } from 'commander';
import crypto from 'crypto';
import dayjs from 'dayjs';

import { Logger } from '../libs/Logger.js';

import { getEnvVariable } from './common.js';

const logger = Logger.getInstance();

const DEFAULT_STREAM = 'default_stream';
const DEFAULT_EXPIRES_MINUTES = 60;

function parsePositiveInteger(value: string, name: string): number {
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function generateStreamKey(stream: string, secret: string, expiresInMinutes: number): string {
  const exp = dayjs().add(expiresInMinutes, 'minute').unix();
  const base = `${stream}?exp=${exp}`;
  const sign = crypto.createHmac('sha256', secret).update(base).digest('hex');
  return `${base}&sign=${sign}`;
}

export function runCLI(): void {
  const program = new Command();

  program
    .option('-s, --stream <name>', 'Stream name', DEFAULT_STREAM)
    .option('-e, --expires <minutes>', 'Expires in N minutes', DEFAULT_EXPIRES_MINUTES.toString());

  program.parse();

  const options = program.opts();

  const stream = options.stream;
  const expiresInMinutes = parsePositiveInteger(options.expires, 'Expires');
  const secret = getEnvVariable('RTMP_SECRET');

  const streamKey = generateStreamKey(stream, secret, expiresInMinutes);

  logger.log('OBS Stream Key:', streamKey);
  logger.log('Full RTMP URL example:', `rtmp://localhost/video/${streamKey}`);
}
