import { startServer } from './server'

import * as http from 'http'

describe('Server', () => {
  let server: http.Server

  beforeAll(() => {
    server = startServer(3001)
  })

  afterAll(() => {
    server.close()
  })

  it('should respond with "Hello, World!"', async () => {
    const response = await fetch('http://localhost:3001')
    const text = await response.text()

    expect(response.status).toBe(200)
    expect(text).toBe('Hello, World!')
  })
})
