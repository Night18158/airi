import { createServer } from 'node:http'

import { useLogg } from '@guiiai/logg'

import { onAppBeforeQuit } from '../../libs/bootkit/lifecycle'

// Port 9001 matches Textractor's WebSocket plugin default — not configurable.
const VN_READER_PORT = 9001

export interface VnReaderService {
  start: () => Promise<void>
  stop: () => Promise<void>
  getStatus: () => { running: boolean, clientCount: number }
  onTextReceived: (handler: (text: string) => void) => () => void
  onConnectionChanged: (handler: (connected: boolean, clientCount: number) => void) => () => void
}

export async function setupVnReaderService(): Promise<VnReaderService> {
  const log = useLogg('main/vn-reader').useGlobalConfig()

  let server: ReturnType<typeof createServer> | null = null
  let running = false
  let clientCount = 0
  let lastText = ''

  const textHandlers = new Set<(text: string) => void>()
  const connectionHandlers = new Set<(connected: boolean, clientCount: number) => void>()

  function notifyConnectionChanged() {
    const connected = clientCount > 0
    for (const handler of connectionHandlers) {
      handler(connected, clientCount)
    }
  }

  async function start() {
    if (running)
      return

    try {
      // Dynamic import to keep this optional at module load time
      const { WebSocketServer } = await import('ws')

      const httpServer = createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('AIRI VN Reader WebSocket server')
      })

      const wss = new WebSocketServer({ server: httpServer })

      wss.on('connection', (ws) => {
        clientCount++
        log.log(`Textractor connected (total clients: ${clientCount})`)
        notifyConnectionChanged()

        ws.on('message', (data) => {
          const text = data.toString('utf-8').trim()
          if (!text)
            return

          // Deduplicate identical consecutive messages (Textractor can send duplicates)
          if (text === lastText)
            return

          lastText = text
          log.withFields({ text }).log('VN text received')

          for (const handler of textHandlers) {
            handler(text)
          }
        })

        ws.on('close', () => {
          clientCount = Math.max(0, clientCount - 1)
          log.log(`Textractor disconnected (remaining clients: ${clientCount})`)
          notifyConnectionChanged()
        })

        ws.on('error', (err) => {
          log.withError(err).error('WebSocket client error')
        })
      })

      server = httpServer

      await new Promise<void>((resolve, reject) => {
        httpServer.once('error', reject)
        httpServer.listen(VN_READER_PORT, '127.0.0.1', () => {
          httpServer.removeListener('error', reject)
          resolve()
        })
      })

      running = true
      log.log(`VN Reader WebSocket server listening on ws://127.0.0.1:${VN_READER_PORT}`)
    }
    catch (error) {
      const nodeError = error as NodeJS.ErrnoException
      if (nodeError.code === 'EADDRINUSE') {
        log.withError(error).warn(`Port ${VN_READER_PORT} already in use — VN Reader server not started`)
      }
      else {
        log.withError(error).error('Failed to start VN Reader WebSocket server')
      }
    }
  }

  async function stop() {
    if (!server)
      return

    await new Promise<void>((resolve) => {
      server!.close(() => resolve())
    })

    server = null
    running = false
    clientCount = 0
    lastText = ''
    log.log('VN Reader WebSocket server stopped')
  }

  function getStatus() {
    return { running, clientCount }
  }

  function onTextReceived(handler: (text: string) => void) {
    textHandlers.add(handler)
    return () => textHandlers.delete(handler)
  }

  function onConnectionChanged(handler: (connected: boolean, clientCount: number) => void) {
    connectionHandlers.add(handler)
    return () => connectionHandlers.delete(handler)
  }

  onAppBeforeQuit(async () => {
    await stop()
  })

  await start()

  return {
    start,
    stop,
    getStatus,
    onTextReceived,
    onConnectionChanged,
  }
}
