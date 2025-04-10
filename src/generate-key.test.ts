import { generateStreamKey } from './generate-key'

describe('generateStreamKey', () => {
  it('should generate a valid stream key', () => {
    const stream = 'test_stream'
    const secret = 'test_secret'
    const expiresInMinutes = 60

    const streamKey = generateStreamKey(stream, secret, expiresInMinutes)

    expect(streamKey).toContain('test_stream')
    expect(streamKey).toContain('?exp=')
    expect(streamKey).toContain('&sign=')
  })
})
