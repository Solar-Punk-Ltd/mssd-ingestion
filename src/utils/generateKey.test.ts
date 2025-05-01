import crypto from 'crypto';
import dayjs from 'dayjs';
import { describe, expect, it, vi } from 'vitest';

import { generateStreamKey } from './generateKey.js';

describe('generateStreamKey', () => {
  const stream = 'test_stream';
  const secret = 'test_secret';
  const expiresInMinutes = 60;

  it('should generate a valid stream key structure', () => {
    const streamKey = generateStreamKey(stream, secret, expiresInMinutes);

    expect(streamKey).toContain(stream);
    expect(streamKey).toContain('?exp=');
    expect(streamKey).toContain('&sign=');
  });

  it('should generate a correct sign with HMAC', () => {
    const exp = dayjs().add(expiresInMinutes, 'minute').unix();
    const expectedBase = `${stream}?exp=${exp}`;

    const expectedSign = crypto.createHmac('sha256', secret).update(expectedBase).digest('hex');

    // Freeze time to avoid mismatch due to second differences
    vi.spyOn(dayjs.prototype, 'unix').mockReturnValue(exp);

    const streamKey = generateStreamKey(stream, secret, expiresInMinutes);

    expect(streamKey).toBe(`${expectedBase}&sign=${expectedSign}`);
  });
});
