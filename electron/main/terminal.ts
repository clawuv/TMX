import { BrowserWindow, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import pty from 'node-pty'
import ssh2 from 'ssh2'
import { mt } from './i18n'

export interface LocalTerminalOptions {
  kind: 'local'
}

export interface SshTerminalOptions {
  kind: 'ssh'
  host: string
  port?: number
  username: string
  password?: string
  privateKeyPath?: string
  /** Passphrase for encrypted private keys. */
  passphrase?: string
  /** Keep-alive probe interval in seconds; 0 disables. */
  keepaliveInterval?: number
}

export type TerminalCreateOptions = LocalTerminalOptions | SshTerminalOptions

export interface TerminalSize {
  cols: number
  rows: number
}

interface TerminalSession {
  write: (data: string) => void
  /** Binary-safe channel for ZMODEM protocol frames (rz/sz). */
  writeBinary?: (bytes: Uint8Array) => void
  resize: (size: TerminalSize) => void
  kill: () => void
}

// zmodem frames are binary; node-pty only takes strings, so go through
// latin1 ("binary") which round-trips arbitrary bytes 1:1 through a string.
function ptyWriteBinary(ptyProcess: { write: (d: string) => void }, bytes: Uint8Array): void {
  ptyProcess.write(Buffer.from(bytes).toString('latin1'))
}

const sessions = new Map<string, TerminalSession>()

// Session kind, kept alongside the handle so the close-confirm and tray logic
// can tell remote SSH sessions apart from disposable local shells.
const sessionKinds = new Map<string, 'local' | 'ssh'>()

/** Number of currently-open SSH sessions (used for quit confirmation). */
export function activeSshSessionCount(): number {
  let count = 0
  for (const kind of sessionKinds.values()) if (kind === 'ssh') count += 1
  return count
}

// ── Per-session output ring buffer (lets MCP tools read recent terminal output) ──
const OUTPUT_BUFFER_SIZE = 64 * 1024

class OutputRing {
  private buf = Buffer.alloc(OUTPUT_BUFFER_SIZE)
  private writePos = 0
  private filled = 0

  push(chunk: string): void {
    const b = Buffer.from(chunk, 'utf8')
    if (b.length >= OUTPUT_BUFFER_SIZE) {
      b.subarray(b.length - OUTPUT_BUFFER_SIZE).copy(this.buf)
      this.writePos = 0
      this.filled = OUTPUT_BUFFER_SIZE
      return
    }
    const head = Math.min(b.length, OUTPUT_BUFFER_SIZE - this.writePos)
    b.copy(this.buf, this.writePos, 0, head)
    if (head < b.length) b.copy(this.buf, 0, head)
    this.writePos = (this.writePos + b.length) % OUTPUT_BUFFER_SIZE
    this.filled = Math.min(this.filled + b.length, OUTPUT_BUFFER_SIZE)
  }

  recent(lastBytes = OUTPUT_BUFFER_SIZE): string {
    const n = Math.min(lastBytes, this.filled)
    const start = (this.writePos - n + OUTPUT_BUFFER_SIZE * 2) % OUTPUT_BUFFER_SIZE
    const first = Math.min(n, OUTPUT_BUFFER_SIZE - start)
    return Buffer.concat([
      this.buf.subarray(start, start + first),
      this.buf.subarray(0, n - first),
    ]).toString('utf8')
  }
}

const outputRings = new Map<string, OutputRing>()

/** Recent terminal output for a live session (MCP read_session_output). */
export function getRecentOutput(id: string, lastBytes = 8192): string | null {
  return outputRings.get(id)?.recent(lastBytes) ?? null
}

/** Write raw input into a live session (MCP send_session_input). */
export function writeSessionInput(id: string, data: string): boolean {
  const session = sessions.get(id)
  if (!session) return false
  session.write(data)
  return true
}

export function hasSession(id: string): boolean {
  return sessions.has(id)
}

// ── Output tap (session logger subscribes here) ─────────────────────────────
type SessionDataListener = (sessionId: string, chunk: string) => void
const sessionDataListeners = new Set<SessionDataListener>()

/** Subscribe to every output chunk of every session (before zmodem/raw passthrough). */
export function onSessionData(cb: SessionDataListener): () => void {
  sessionDataListeners.add(cb)
  return () => sessionDataListeners.delete(cb)
}

function tapSessionData(id: string, chunk: string): void {
  for (const cb of sessionDataListeners) cb(id, chunk)
}

type SessionExitListener = (sessionId: string) => void
const sessionExitListeners = new Set<SessionExitListener>()

/** Subscribe to session teardown (logger flushes open files here). */
export function onSessionExit(cb: SessionExitListener): () => void {
  sessionExitListeners.add(cb)
  return () => sessionExitListeners.delete(cb)
}

/** Tell the tap consumers whether a zmodem transfer owns this session's bytes. */
const zmodemActive = new Set<string>()

export function setZmodemActive(id: string, active: boolean): void {
  if (active) zmodemActive.add(id)
  else zmodemActive.delete(id)
}

export function isZmodemActive(id: string): boolean {
  return zmodemActive.has(id)
}

type Emit = (channel: string, payload: unknown) => void

function pickLocalShell(): string {
  if (process.platform === 'win32') return 'powershell.exe'
  return process.env.SHELL || '/bin/bash'
}

function createLocalSession(
  id: string,
  size: TerminalSize,
  emit: Emit,
  onExit: (code: number) => void,
): TerminalSession {
  const shell = pickLocalShell()
  const ring = new OutputRing()
  outputRings.set(id, ring)
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: size.cols,
    rows: size.rows,
    cwd: os.homedir(),
    env: process.env as { [key: string]: string },
  })

  ptyProcess.onData((data) => {
    ring.push(data)
    if (!isZmodemActive(id)) tapSessionData(id, data)
    emit('terminal:data', { id, data: Buffer.from(data, 'utf8') })
  })
  ptyProcess.onExit(({ exitCode }) => onExit(exitCode))

  return {
    write: (data) => ptyProcess.write(data),
    writeBinary: (bytes) => ptyWriteBinary(ptyProcess, bytes),
    resize: (next) => {
      try {
        ptyProcess.resize(next.cols, next.rows)
      } catch {
        // resizing a dead pty races tab close; ignore
      }
    },
    kill: () => ptyProcess.kill(),
  }
}

export function readPrivateKey(path: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(mt('keyReadFailed', { path, reason }))
  }
}

function createSshSession(
  id: string,
  opts: SshTerminalOptions,
  size: TerminalSize,
  emit: Emit,
  onReady: () => void,
  onError: (message: string) => void,
  onExit: (code: number) => void,
): TerminalSession {
  if (!opts.password && !opts.privateKeyPath) {
    // Throwing inside the terminal:create Promise executor rejects it, so the
    // renderer surfaces this message verbatim in the host drawer.
    throw new Error(mt('noCredentials'))
  }

  const conn = new ssh2.Client()
  let stream: ssh2.ClientChannel | null = null
  let ready = false
  const ring = new OutputRing()
  outputRings.set(id, ring)

  const fail = (err: Error) => {
    if (!ready) {
      ready = true
      onError(err.message || mt('sshFailed'))
    }
    try {
      conn.end()
    } catch {
      // already closed
    }
  }

  conn.on('error', fail)
  conn.on('keyboard-interactive', (_name, _instr, _lang, _prompts, finish) => {
    finish([opts.password ?? ''])
  })
  conn.on('ready', () => {
    conn.shell({ term: 'xterm-256color', cols: size.cols, rows: size.rows }, (err, s) => {
      if (err || !s) {
        fail(err ?? new Error(mt('shellFailed')))
        return
      }
      stream = s
      ready = true
      onReady()
      s.on('data', (chunk: Buffer) => {
        ring.push(chunk.toString('utf8'))
        if (!isZmodemActive(id)) tapSessionData(id, chunk.toString('utf8'))
        emit('terminal:data', { id, data: new Uint8Array(chunk) })
      })
      s.stderr?.on('data', (chunk: Buffer) => {
        ring.push(chunk.toString('utf8'))
        if (!isZmodemActive(id)) tapSessionData(id, chunk.toString('utf8'))
        emit('terminal:data', { id, data: new Uint8Array(chunk) })
      })
      s.on('close', () => onExit(0))
    })
  })

  const connectConfig: ssh2.ConnectConfig = {
    host: opts.host,
    port: opts.port ?? 22,
    username: opts.username,
    readyTimeout: 15_000,
    ...(opts.keepaliveInterval && opts.keepaliveInterval > 0
      ? { keepalive: { interval: opts.keepaliveInterval * 1000 } }
      : {}),
    ...(opts.privateKeyPath ? { privateKey: readPrivateKey(opts.privateKeyPath) } : {}),
    ...(opts.password ? { password: opts.password } : {}),
    ...(opts.passphrase ? { passphrase: opts.passphrase } : {}),
  }
  conn.connect(connectConfig)

  return {
    write: (data) => stream?.write(data),
    writeBinary: (bytes) => stream?.write(Buffer.from(bytes)),
    resize: (next) => {
      try {
        stream?.setWindow(next.rows, next.cols, 0, 0)
      } catch {
        // stream already closed
      }
    },
    kill: () => {
      try {
        stream?.end()
      } catch {
        // already closed
      }
      try {
        conn.end()
      } catch {
        // already closed
      }
    },
  }
}

function destroySession(id: string) {
  sessions.delete(id)
  sessionKinds.delete(id)
  outputRings.delete(id)
  zmodemActive.delete(id)
  for (const cb of sessionExitListeners) cb(id)
}

export function registerTerminalIpc(getWindow: () => BrowserWindow | null) {
  const emit: Emit = (channel, payload) => {
    getWindow()?.webContents.send(channel, payload)
  }

  ipcMain.handle(
    'terminal:create',
    async (_event, options: TerminalCreateOptions, size: TerminalSize) => {
      const id = randomUUID()
      return await new Promise<{ id: string }>((resolve, reject) => {
        const onExit = (code: number) => {
          destroySession(id)
          emit('terminal:exit', { id, code })
        }
        const onReady = () => {
          sessions.set(id, session)
          sessionKinds.set(id, options.kind)
          resolve({ id })
        }
        const onError = (message: string) => reject(new Error(message))

        const session =
          options.kind === 'ssh'
            ? createSshSession(id, options, size, emit, onReady, onError, onExit)
            : createLocalSession(id, size, emit, onExit)

        if (options.kind !== 'ssh') onReady()
      })
    },
  )

  ipcMain.on('terminal:input', (_event, payload: { id: string; data: string | Uint8Array }) => {
    const session = sessions.get(payload.id)
    if (!session) return
    if (typeof payload.data === 'string') {
      session.write(payload.data)
    } else if (session.writeBinary) {
      session.writeBinary(payload.data)
    } else {
      session.write(Buffer.from(payload.data).toString('latin1'))
    }
  })

  // Renderer toggles this while a ZMODEM transfer owns the session's bytes,
  // so the session logger pauses and the MCP ring keeps human-readable text.
  ipcMain.on('terminal:zmodem-active', (_event, payload: { id: string; active: boolean }) => {
    setZmodemActive(payload.id, payload.active)
  })

  ipcMain.on('terminal:resize', (_event, payload: { id: string } & TerminalSize) => {
    const { id, cols, rows } = payload
    sessions.get(id)?.resize({ cols, rows })
  })

  ipcMain.handle('terminal:kill', (_event, id: string) => {
    const session = sessions.get(id)
    if (session) {
      sessions.delete(id)
      sessionKinds.delete(id)
      session.kill()
    }
  })
}
