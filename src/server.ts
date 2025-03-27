import * as http from 'http'

const requestHandler = (req: http.IncomingMessage, res: http.ServerResponse): void => {
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('Hello, World!')
}

const server = http.createServer(requestHandler)

export const startServer = (port: number): http.Server => {
  return server.listen(port, () => {
    console.log(`Server started on port ${port}`)
  })
}
