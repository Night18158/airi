import type { Buffer } from 'node:buffer'

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
  let pendingText = ''
  let pendingTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  const textHandlers = new Set<(text: string) => void>()
  const connectionHandlers = new Set<(connected: boolean, clientCount: number) => void>()

  /**
   * Returns true if the text looks like valid game dialogue (contains CJK characters and is not
   * obviously garbage from unrelated memory threads).
   *
   * Textractor sends text from ALL hooked threads simultaneously. Most non-dialogue threads
   * produce pure ASCII, numbers, or strings with heavily repeated characters from memory dumps.
   * Keeping only CJK-containing lines eliminates the vast majority of noise.
   */
  function isValidGameText(text: string): boolean {
    if (!text || text.trim().length < 2)
      return false

    // Must contain CJK characters:
    //   U+3040–U+309F Hiragana, U+30A0–U+30FF Katakana,
    //   U+4E00–U+9FFF CJK Unified Ideographs (Chinese/Japanese kanji),
    //   U+F900–U+FAFF CJK Compatibility Ideographs
    const cjkPattern = /[\u3040-\u9FFF\uF900-\uFAFF]/
    if (!cjkPattern.test(text))
      return false

    // Reject if too many repeated characters (memory garbage indicator)
    const chars = text.split('')
    const uniqueChars = new Set(chars).size
    if (uniqueChars < chars.length * 0.3 && chars.length > 10)
      return false

    // Reject extremely long lines without Japanese punctuation (likely a memory dump)
    if (text.length > 500 && !/[。！？「」『』、…]/u.test(text))
      return false

    return true
  }

  /**
   * Schedules text emission with a 300 ms debounce so that when Textractor sends both a partial
   * and a complete version of the same line, only the longer (more complete) version is emitted.
   * If the new text is a substring/superset of the already-pending text, the longer one wins.
   * If the texts are unrelated, the pending text is flushed immediately before queuing the new one.
   */
  function emitText(text: string) {
    // If new text and pending text are substring-related, keep the longer one
    if (pendingText && (text.includes(pendingText) || pendingText.includes(text))) {
      if (pendingTimer) {
        clearTimeout(pendingTimer)
        pendingTimer = null
      }
      pendingText = text.length >= pendingText.length ? text : pendingText
    }
    else {
      // Unrelated text: flush any pending text immediately, then queue the new one
      if (pendingText && pendingText !== lastText) {
        lastText = pendingText
        log.withFields({ text: pendingText }).log('VN text received')
        for (const handler of textHandlers) handler(pendingText)
      }
      if (pendingTimer) {
        clearTimeout(pendingTimer)
        pendingTimer = null
      }
      pendingText = text
    }

    // (Re)schedule delayed emission so we catch fuller versions arriving shortly after
    pendingTimer = setTimeout(() => {
      if (pendingText && pendingText !== lastText) {
        lastText = pendingText
        log.withFields({ text: pendingText }).log('VN text received')
        for (const handler of textHandlers) handler(pendingText)
      }
      pendingText = ''
      pendingTimer = null
    }, 300)
  }

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

        // Filter out lines that are clearly not game dialogue (non-CJK, memory garbage, etc.)
        if (!isValidGameText(text))
          return

        // Debounce + deduplication: wait briefly before emitting so we catch fuller versions
        emitText(text)
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
    if (pendingTimer) {
      clearTimeout(pendingTimer)
      pendingTimer = null
    }
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
    pendingText = ''
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
