import { Buffer } from 'node:buffer'

import { useLogg } from '@guiiai/logg'

import { onAppBeforeQuit } from '../../libs/bootkit/lifecycle'

// Default port matches textractor_websocket_x86 plugin default.
// Configurable at runtime via restart().
const VN_READER_DEFAULT_PORT = 6677
// NOTICE: Reconnect interval for the WebSocket client. 3 seconds gives Textractor time to
// finish starting up before AIRI retries, without feeling unresponsive to the user.
const RECONNECT_INTERVAL_MS = 3000

export interface VnReaderService {
  start: () => Promise<void>
  stop: () => Promise<void>
  restart: (port: number) => Promise<void>
  getStatus: () => { running: boolean, clientCount: number, port: number }
  onTextReceived: (handler: (text: string) => void) => () => void
  onConnectionChanged: (handler: (connected: boolean, clientCount: number) => void) => () => void
}

/**
 * Sets up the VN Reader WebSocket client service.
 * Connects to the textractor_websocket_x86 server at ws://localhost:{port} (default 6677) and
 * forwards extracted Chinese/Japanese text to the renderer via registered handlers.
 * Automatically reconnects every 3 seconds if the connection is lost.
 * The port can be changed at runtime by calling restart(newPort).
 */
export async function setupVnReaderService(initialPort: number = VN_READER_DEFAULT_PORT): Promise<VnReaderService> {
  const log = useLogg('main/vn-reader').useGlobalConfig()

  let ws: import('ws').WebSocket | null = null
  let running = false
  let connected = false
  let currentPort = initialPort
  let lastText = ''
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  const textHandlers = new Set<(text: string) => void>()
  const connectionHandlers = new Set<(connected: boolean, clientCount: number) => void>()

  /**
   * Returns true if the message is an AIRI-internal protocol message that should be ignored.
   * Textractor can echo back messages it receives, including AIRI's own heartbeats.
   */
  function isAiriInternalMessage(text: string): boolean {
    if (!text.startsWith('{'))
      return false
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>
      // Handle superjson-wrapped format: { json: { type: "..." } }
      const inner = (parsed.json as Record<string, unknown> | undefined) ?? parsed
      const type = inner?.type
      if (typeof type === 'string') {
        if (type.startsWith('transport:') || type.startsWith('module:'))
          return true
      }
      if (text.includes('"proj-airi"') || text.includes('"kind":"ping"') || text.includes('"kind":"pong"'))
        return true
    }
    catch {
      // Not valid JSON — not an internal message
    }
    return false
  }

  function notifyConnectionChanged(isConnected: boolean) {
    connected = isConnected
    for (const handler of connectionHandlers) {
      handler(isConnected, isConnected ? 1 : 0)
    }
  }

  function connect() {
    if (stopped)
      return

    import('ws').then(({ default: WebSocket }) => {
      const url = `ws://localhost:${currentPort}`
      log.log(`Connecting to Textractor at ${url}`)

      const socket = new WebSocket(url)
      ws = socket

      socket.on('open', () => {
        log.log('Connected to Textractor WebSocket server')
        notifyConnectionChanged(true)
      })

      socket.on('message', (data) => {
        const raw = (data as Buffer).toString('utf-8').trim()
        if (!raw)
          return

        // Filter out AIRI internal protocol messages (heartbeats, module announcements, etc.)
        if (isAiriInternalMessage(raw))
          return

        // Extract plain text: if the message looks like JSON, try to pull a text field from it.
        // Otherwise treat the whole message as plain text (Chinese/Japanese game dialogue never
        // starts with '{', so this path is hit directly for typical Textractor output).
        let text = raw
        if (raw.startsWith('{')) {
          try {
            const parsed = JSON.parse(raw) as Record<string, unknown>
            // Some Textractor plugins wrap text in a JSON envelope, e.g. { text: "..." }
            const candidate = (parsed.text ?? parsed.sentence ?? parsed.data) as string | undefined
            if (typeof candidate === 'string' && candidate.trim()) {
              text = candidate.trim()
            }
            else {
              // Valid JSON but no recognisable text field — skip silently
              return
            }
          }
          catch {
            // Not valid JSON — use the raw string as plain text
            text = raw
          }
        }

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

      socket.on('close', () => {
        log.log('Disconnected from Textractor WebSocket server')
        notifyConnectionChanged(false)
        ws = null
        // Auto-reconnect after RECONNECT_INTERVAL_MS if not intentionally stopped
        if (!stopped) {
          reconnectTimer = setTimeout(() => {
            if (!stopped)
              connect()
          }, RECONNECT_INTERVAL_MS)
        }
      })

      socket.on('error', (err) => {
        // 'close' event will fire after error and trigger reconnect
        log.withError(err).warn('WebSocket connection error — will retry')
      })
    }).catch((err) => {
      log.withError(err).error('Failed to import ws module')
    })
  }

  async function start() {
    if (running)
      return
    running = true
    stopped = false
    connect()
    log.log(`VN Reader WebSocket client started — target ws://localhost:${currentPort}`)
  }

  async function stop() {
    stopped = true
    running = false
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (ws) {
      ws.close()
      ws = null
    }
    connected = false
    lastText = ''
    log.log('VN Reader WebSocket client stopped')
  }

  function getStatus() {
    return { running, clientCount: connected ? 1 : 0, port: currentPort }
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
   * Stops the current client and restarts it targeting the given port.
   */
  async function restart(port: number) {
    currentPort = port
    await stop()
    stopped = false
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
