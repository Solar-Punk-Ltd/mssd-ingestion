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

  it('should respond with "Hello, World!"', done => {
    const options = {
      hostname: 'localhost',
      port: 3001,
      path: '/',
      method: 'GET',
    }

    const req = http.request(options, res => {
      let data = ''

      res.on('data', chunk => {
        data += chunk
      })

      res.on('end', () => {
        expect(res.statusCode).toBe(200)
        expect(data).toBe('Hello, World!')
        done()
      })
    })

    req.on('error', err => {
      done(err)
    })
    req.end()
  })
})
