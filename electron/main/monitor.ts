// Host monitoring sampler: one SSH connection per host (or a local shell) is
// reused across polls, and each poll runs a single POSIX script that reports every
// metric in one round trip. Nothing here touches the user's interactive session.
import { BrowserWindow, ipcMain } from 'electron'
import { execFile } from 'node:child_process'
import ssh2 from 'ssh2'
import { mt } from './i18n'
import { readPrivateKey } from './terminal'
import {
  fromPosixSections,
  fromWindowsSnapshot,
  parseSections,
  type MonitorNetIface,
  type MonitorSample,
  type WindowsSnapshot,
} from './monitor-parse'
import { POSIX_SCRIPT, SAMPLE_GAP_MS, WINDOWS_JSON_MARKER, WINDOWS_SCRIPT } from './monitor-scripts'

export interface MonitorTarget {
  kind: 'local' | 'ssh'
  host?: string
  port?: number
  username?: string
  password?: string
  privateKeyPath?: string
  passphrase?: string
  keepaliveInterval?: number
}

const EXEC_TIMEOUT_MS = 20_000
const CONNECT_TIMEOUT_MS = 15_000

// ── exec helpers ────────────────────────────────────────────────────────────
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

function runFile(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      // A non-zero exit still carries usable output; only a hard spawn failure is fatal.
      if (err && !stdout) reject(err)
      else resolve(String(stdout ?? ''))
    })
  })
}

function execOnConnection(conn: ssh2.Client, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err || !stream) {
        reject(err ?? new Error(mt('monitorExecFailed')))
        return
      }
      let out = ''
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        try {
          stream.close()
        } catch {
          // channel already gone
        }
        reject(new Error(mt('monitorTimeout')))
      }, EXEC_TIMEOUT_MS)

      stream.on('data', (chunk: Buffer) => {
        out += chunk.toString('utf8')
      })
      // Diagnostics on stderr would corrupt the section blob, so they are dropped.
      stream.stderr?.on('data', () => {})
      stream.on('close', () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(out)
      })
    })
  })
}

// ── SSH connection pool ─────────────────────────────────────────────────────
interface PoolEntry {
  credentialKey: string
  ready: Promise<ssh2.Client>
}

const pool = new Map<string, PoolEntry>()

function targetKey(target: MonitorTarget): string {
  if (target.kind === 'local') return 'local'
  return `${target.username}@${target.host}:${target.port ?? 22}`
}

function credentialKey(target: MonitorTarget): string {
  return JSON.stringify([
    target.kind,
    target.password ?? '',
    target.privateKeyPath ?? '',
    target.passphrase ?? '',
  ])
}

function openConnection(target: MonitorTarget): Promise<ssh2.Client> {
  return new Promise((resolve, reject) => {
    const conn = new ssh2.Client()
    const fail = (err: Error) => reject(new Error(mt('monitorSshFailed', { reason: err.message })))
    conn.on('error', fail)
    conn.on('keyboard-interactive', (_n, _i, _l, _p, finish) => finish([target.password ?? '']))
    conn.on('ready', () => resolve(conn))
    try {
      conn.connect({
        host: target.host,
        port: target.port ?? 22,
        username: target.username,
        readyTimeout: CONNECT_TIMEOUT_MS,
        ...(target.keepaliveInterval && target.keepaliveInterval > 0
          ? { keepalive: { interval: target.keepaliveInterval * 1000 } }
          : {}),
        ...(target.privateKeyPath ? { privateKey: readPrivateKey(target.privateKeyPath) } : {}),
        ...(target.password ? { password: target.password } : {}),
        ...(target.passphrase ? { passphrase: target.passphrase } : {}),
      })
    } catch (err) {
      fail(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

async function getConnection(target: MonitorTarget): Promise<ssh2.Client> {
  const key = targetKey(target)
  const nextCredentials = credentialKey(target)
  const cached = pool.get(key)
  if (cached?.credentialKey === nextCredentials) {
    try {
      return await cached.ready
    } catch {
      // Connection died since it was cached; fall through and rebuild it.
      if (pool.get(key) === cached) pool.delete(key)
    }
  } else if (cached) {
    pool.delete(key)
    void cached.ready.then((conn) => conn.end()).catch(() => {})
  }
  const entry: PoolEntry = { credentialKey: nextCredentials, ready: openConnection(target) }
  pool.set(key, entry)
  entry.ready.catch(() => {
    if (pool.get(key) === entry) pool.delete(key)
  })
  return entry.ready
}

export function releaseMonitorTarget(target: MonitorTarget): void {
  const key = targetKey(target)
  const entry = pool.get(key)
  if (!entry) return
  pool.delete(key)
  void entry.ready.then((conn) => conn.end()).catch(() => {})
}

// Network counters are absolute, so rates need the previous sample per target.
const lastNetByTarget = new Map<string, { ifaces: MonitorNetIface[]; at: number }>()

function rememberNet(key: string, ifaces: MonitorNetIface[], at: number): void {
  lastNetByTarget.set(key, { ifaces, at })
}

function previousNet(key: string, now: number): { ifaces: MonitorNetIface[]; seconds: number } {
  const prev = lastNetByTarget.get(key)
  if (!prev) return { ifaces: [], seconds: SAMPLE_GAP_MS / 1000 }
  const seconds = Math.max(0.001, (now - prev.at) / 1000)
  return { ifaces: prev.ifaces, seconds }
}

// ── samplers ────────────────────────────────────────────────────────────────
async function sampleSsh(target: MonitorTarget): Promise<MonitorSample> {
  const conn = await getConnection(target)
  const started = Date.now()
  const raw = await execOnConnection(conn, POSIX_SCRIPT)
  const elapsed = Date.now() - started
  const sample = fromPosixSections(
    parseSections(raw),
    SAMPLE_GAP_MS / 1000,
    Math.max(0, elapsed - SAMPLE_GAP_MS),
  )
  rememberNet(targetKey(target), sample.net, sample.sampledAt)
  return sample
}

async function sampleLocalPosix(): Promise<MonitorSample> {
  const started = Date.now()
  const raw = await runFile('sh', ['-c', POSIX_SCRIPT])
  const elapsed = Date.now() - started
  const sample = fromPosixSections(
    parseSections(raw),
    SAMPLE_GAP_MS / 1000,
    Math.max(0, elapsed - SAMPLE_GAP_MS),
  )
  rememberNet('local', sample.net, sample.sampledAt)
  return sample
}

async function sampleLocalWindows(): Promise<MonitorSample> {
  const started = Date.now()
  const raw = await runFile('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    WINDOWS_SCRIPT,
  ])
  const elapsed = Date.now() - started
  const marker = raw.indexOf(WINDOWS_JSON_MARKER)
  if (marker === -1) throw new Error(mt('monitorExecFailed'))
  const snap = JSON.parse(raw.slice(marker + WINDOWS_JSON_MARKER.length).trim()) as WindowsSnapshot
  const prev = previousNet('local', Date.now())
  const sample = fromWindowsSnapshot(snap, prev.ifaces, prev.seconds, Math.max(0, elapsed))
  rememberNet('local', sample.net, sample.sampledAt)
  return sample
}

async function sampleLocal(): Promise<MonitorSample> {
  if (process.platform === 'win32') return sampleLocalWindows()
  if (process.platform === 'linux' || process.platform === 'darwin') return sampleLocalPosix()
  throw new Error(mt('monitorUnsupported'))
}

async function sample(target: MonitorTarget): Promise<MonitorSample> {
  if (target.kind === 'local') return sampleLocal()
  if (!target.host || !target.username) throw new Error(mt('monitorNoCreds'))
  if (!target.password && !target.privateKeyPath) throw new Error(mt('monitorNoCreds'))
  return sampleSsh(target)
}

// ── IPC ─────────────────────────────────────────────────────────────────────
export function registerMonitorIpc(_getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('monitor:sample', async (_event, target: MonitorTarget) => {
    if (!target || (target.kind !== 'local' && target.kind !== 'ssh')) {
      throw new Error(mt('invalidArgs'))
    }
    return withTimeout(
      sample(target),
      CONNECT_TIMEOUT_MS + EXEC_TIMEOUT_MS + 5_000,
      mt('monitorTimeout'),
    )
  })

  ipcMain.handle('monitor:release', (_event, target: MonitorTarget) => {
    if (target?.kind === 'ssh') releaseMonitorTarget(target)
    return { ok: true }
  })
}
