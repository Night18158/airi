import { createServer } from 'node:http'

import { useLogg } from '@guiiai/logg'

import { onAppBeforeQuit } from '../../libs/bootkit/lifecycle'

// Default port matches Textractor's WebSocket plugin default. Configurable at runtime via restart().
const VN_READER_DEFAULT_PORT = 9001

export interface VnReaderService {
  start: () => Promise<void>
  stop: () => Promise<void>
  restart: (port: number) => Promise<void>
  getStatus: () => { running: boolean, clientCount: number, port: number }
  onTextReceived: (handler: (text: string) => void) => () => void
  onConnectionChanged: (handler: (connected: boolean, clientCount: number) => void) => () => void
}

/**
 * Sets up the VN Reader WebSocket server service.
 * Creates a WebSocket server on the given port (defaults to 9001, Textractor's default) that accepts
 * connections from Textractor's WebSocket plugin and forwards extracted Japanese text to the renderer
 * via registered handlers. Handles deduplication of consecutive identical messages.
 * The port can be changed at runtime by calling restart(newPort).
 */
export async function setupVnReaderService(initialPort: number = VN_READER_DEFAULT_PORT): Promise<VnReaderService> {
  const log = useLogg('main/vn-reader').useGlobalConfig()

  let server: ReturnType<typeof createServer> | null = null
  let running = false
  let clientCount = 0
  let lastText = ''
  let currentPort = initialPort

  const textHandlers = new Set<(text: string) => void>()
  const connectionHandlers = new Set<(connected: boolean, clientCount: number) => void>()

  /**
   * Returns true if the message is an AIRI-internal protocol message that should be ignored.
   * Textractor can sometimes echo back messages it receives, including AIRI's own heartbeats.
   */
  function isAiriInternalMessage(text: string): boolean {
    if (!text.startsWith('{'))
      return false
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>
      // Handle superjson-wrapped format: { json: { type: "..." } }
      const messageBody = (parsed.json as Record<string, unknown> | undefined) ?? parsed
      const type = messageBody?.type
      if (typeof type === 'string' && (type.startsWith('transport:') || type.startsWith('module:')))
        return true
      // Also check nested kind field for ping/pong (e.g. data.kind)
      const data = messageBody?.data as Record<string, unknown> | undefined
      const kind = data?.kind
      if (kind === 'ping' || kind === 'pong')
        return true
    }
    catch {
      // Not valid JSON — not an internal message
    }
    return false
  }

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

          // Filter out AIRI internal protocol messages (heartbeats, module announcements, etc.)
          // These can appear when the same WebSocket port is shared between Textractor and AIRI internals.
          if (isAiriInternalMessage(text)) {
            log.log('Ignoring AIRI internal protocol message')
            return
          }

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
        httpServer.listen(currentPort, '127.0.0.1', () => {
          httpServer.removeListener('error', reject)
          resolve()
        })
      })

      running = true
      log.log(`VN Reader WebSocket server listening on ws://127.0.0.1:${currentPort}`)
    }
    catch (error) {
      const nodeError = error as NodeJS.ErrnoException
      if (nodeError.code === 'EADDRINUSE') {
        log.withError(error).warn(`Port ${currentPort} already in use — VN Reader server not started`)
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
    return { running, clientCount, port: currentPort }
  }

  function onTextReceived(handler: (text: string) => void) {
    textHandlers.add(handler)
    return () => textHandlers.delete(handler)
  }

  function onConnectionChanged(handler: (connected: boolean, clientCount: number) => void) {
    connectionHandlers.add(handler)
    return () => connectionHandlers.delete(handler)
  }

  /**
   * Stops the current server and restarts it on the given port.
   * No-op if the server is already running on the requested port.
   */
  async function restart(port: number) {
    if (running && currentPort === port)
      return
    await stop()
    currentPort = port
    await start()
  }

  onAppBeforeQuit(async () => {
    await stop()
  })

  await start()

  return {
    start,
    stop,
    restart,
    getStatus,
    onTextReceived,
    onConnectionChanged,
  }
}
