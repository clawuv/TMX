import { app, BrowserWindow, ipcMain } from 'electron'
import { randomBytes, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import ssh2 from 'ssh2'
import { queryHosts, querySnippets, readPreferences } from './db'
import { mt } from './i18n'
import { getRecentOutput, hasSession, readPrivateKey, writeSessionInput } from './terminal'
import { sftpListRemote, sftpReadRemoteFile, type SftpHostConfig } from './sftp'

// ── Paths & discovery ────────────────────────────────────────────────────────
const TMX_DIR = path.join(os.homedir(), '.tmx')
const BRIDGE_JSON_PATH = path.join(TMX_DIR, 'bridge.json')

function socketPath(): string {
  return process.platform === 'win32'
    ? '\\\\.\\pipe\\tmx-mcp'
    : path.join(TMX_DIR, 'tmx-mcp.sock')
}

/** Path of the stdio script AI tools spawn (asar-unpacked in production builds). */
function serverScriptPath(): string {
  const p = path.join(app.getAppPath(), 'dist-electron', 'mcp', 'server.mjs')
  return p.replace('app.asar', 'app.asar.unpacked')
}

// ── State ────────────────────────────────────────────────────────────────────
let server: net.Server | null = null
let token = ''
type Emit = (channel: string, payload: unknown) => void
let getWindow: () => BrowserWindow | null = () => null

interface SessionMeta {
  sessionId: string
  title: string
  host: string
  kind: 'local' | 'ssh'
  active: boolean
}
const sessionRegistry = new Map<string, SessionMeta>()

// ── Preferences helpers ──────────────────────────────────────────────────────
function prefBool(key: 'mcpEnabled' | 'mcpRequireConfirm', fallback: boolean): boolean {
  try {
    const prefs = readPreferences()
    const v = prefs?.[key]
    return typeof v === 'boolean' ? v : fallback
  } catch {
    return fallback
  }
}

// ── Host resolution ──────────────────────────────────────────────────────────
function resolveHost(query: string): { host: ReturnType<typeof queryHosts>[number] | null; error?: string } {
  const hosts = queryHosts()
  if (hosts.length === 0) return { host: null, error: mt('noHostsConfigured') }
  const q = query.trim()
  const byName = hosts.find((h) => h.name === q)
  if (byName) return { host: byName }
  const byUserHost = hosts.find((h) => `${h.user}@${h.host}` === q)
  if (byUserHost) return { host: byUserHost }
  const byHostField = hosts.find((h) => h.host === q)
  if (byHostField) return { host: byHostField }
  const byFuzzyName = hosts.find((h) => h.name.toLowerCase().startsWith(q.toLowerCase()))
  if (byFuzzyName) return { host: byFuzzyName }
  return { host: null, error: mt('hostNotFound', { query }) }
}

// ── Confirmation flow (renderer modal, 60s timeout = deny) ───────────────────
const pendingConfirmations = new Map<string, (allowed: boolean) => void>()

function requestConfirmation(tool: string, summary: string): Promise<boolean> {
  return new Promise((resolve) => {
    const reqId = randomUUID()
    const timer = setTimeout(() => {
      if (pendingConfirmations.delete(reqId)) resolve(false)
    }, 60_000)
    pendingConfirmations.set(reqId, (allowed) => {
      clearTimeout(timer)
      resolve(allowed)
    })
    getWindow()?.webContents.send('mcp:confirm-request', { reqId, tool, summary })
  })
}

const MUTATING_TOOLS = new Set(['exec_command', 'send_session_input', 'run_snippet'])

async function confirmIfNeeded(tool: string, summary: string): Promise<void> {
  if (!MUTATING_TOOLS.has(tool)) return
  if (!prefBool('mcpRequireConfirm', true)) return
  const allowed = await requestConfirmation(tool, summary)
  if (!allowed) throw new Error(mt('confirmDenied'))
}

// ── Tool implementations ─────────────────────────────────────────────────────
function toolListHosts() {
  return queryHosts().map((h) => ({
    name: h.name,
    address: `${h.user}@${h.host}:${h.port}`,
    group: h.group,
    tag: h.tag,
    authMethod: h.authMethod,
    os: h.os,
  }))
}

function execOnHost(
  host: { host: string; port?: number; username: string; password?: string; privateKeyPath?: string; passphrase?: string },
  command: string,
  timeoutMs: number,
  maxBytes: number,
): Promise<{ stdout: string; stderr: string; exitCode: number | null; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    if (!host.password && !host.privateKeyPath) {
      reject(new Error(mt('hostNoCreds')))
      return
    }
    const conn = new ssh2.Client()
    let settled = false
    let stdout = Buffer.alloc(0)
    let stderr = Buffer.alloc(0)
    let truncated = false
    let exitCode: number | null = null

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { conn.end() } catch { /* already closed */ }
      fn()
    }
    const timer = setTimeout(() => {
      // Timeout is not fatal: report whatever streamed back before it fired.
      finish(() =>
        resolve({
          stdout: stdout.toString('utf8'),
          stderr: stderr.toString('utf8'),
          exitCode,
          truncated,
        }),
      )
    }, timeoutMs)

    conn.on('error', (err) => finish(() => reject(new Error(err.message))))
    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err || !stream) {
          finish(() => reject(new Error(err?.message || mt('execChannelFailed'))))
          return
        }
        stream.on('data', (chunk: Buffer) => {
          if (stdout.length < maxBytes) stdout = Buffer.concat([stdout, chunk.subarray(0, maxBytes - stdout.length)])
          else truncated = true
        })
        stream.stderr?.on('data', (chunk: Buffer) => {
          if (stderr.length < maxBytes) stderr = Buffer.concat([stderr, chunk.subarray(0, maxBytes - stderr.length)])
        })
        stream.on('close', (code: number | null) => {
          exitCode = code
          finish(() =>
            resolve({
              stdout: stdout.toString('utf8'),
              stderr: stderr.toString('utf8'),
              exitCode,
              truncated,
            }),
          )
        })
      })
    })

    conn.connect({
      host: host.host,
      port: host.port ?? 22,
      username: host.username,
      readyTimeout: 15_000,
      ...(host.privateKeyPath ? { privateKey: readPrivateKey(host.privateKeyPath) } : {}),
      ...(host.password ? { password: host.password } : {}),
      ...(host.passphrase ? { passphrase: host.passphrase } : {}),
    })
  })
}

async function toolExecCommand(args: {
  host?: string
  command?: string
  timeout_s?: number
  max_bytes?: number
}) {
  if (!args.host || !args.command) throw new Error(mt('argsRequired', { args: 'host, command' }))
  const found = resolveHost(args.host)
  if (!found.host) throw new Error(found.error)
  const timeoutMs = Math.min(Math.max((args.timeout_s ?? 30) * 1000, 1000), 300_000)
  const maxBytes = Math.min(args.max_bytes ?? 16_384, 256 * 1024)
  const summary = mt('execSummary', { name: found.host.name, userHost: `${found.host.user}@${found.host.host}`, command: args.command })
  await confirmIfNeeded('exec_command', summary)
  // Map the stored host record onto the SSH config field names explicitly
  // (the record uses `user`; the SSH config wants `username`).
  const result = await execOnHost(
    {
      host: found.host.host,
      port: found.host.port,
      username: found.host.user,
      password: found.host.password,
      privateKeyPath: found.host.privateKeyPath,
      passphrase: found.host.passphrase,
    },
    args.command,
    timeoutMs,
    maxBytes,
  )
  const parts = [`exit_code: ${result.exitCode}${result.truncated ? mt('outputTruncated') : ''}`]
  if (result.stdout) parts.push(`stdout:\n${result.stdout}`)
  if (result.stderr) parts.push(`stderr:\n${result.stderr}`)
  return parts.join('\n')
}

function toolListSessions() {
  const list = [...sessionRegistry.values()]
    .filter((m) => hasSession(m.sessionId))
    .map((m) => ({ session_id: m.sessionId, title: m.title, host: m.host, kind: m.kind, active: m.active }))
  return list.length > 0 ? list : mt('noActiveSessions')
}

function toolReadOutput(args: { session_id?: string; last_bytes?: number }) {
  if (!args.session_id) throw new Error(mt('argsRequired', { args: 'session_id' }))
  if (!hasSession(args.session_id)) throw new Error(mt('sessionMissing'))
  const output = getRecentOutput(args.session_id, Math.min(args.last_bytes ?? 4096, 64 * 1024))
  return output ?? mt('noOutput')
}

function toolSendInput(args: { session_id?: string; data?: string }) {
  if (!args.session_id || args.data === undefined) throw new Error(mt('argsRequired', { args: 'session_id, data' }))
  const meta = sessionRegistry.get(args.session_id)
  const summary = mt('inputSummary', { title: meta?.title ?? args.session_id, data: args.data })
  return confirmIfNeeded('send_session_input', summary).then(() => {
    if (!writeSessionInput(args.session_id!, args.data)) throw new Error(mt('sessionMissing'))
    return mt('inputWritten')
  })
}

async function toolRunSnippet(args: { title?: string; host?: string }) {
  if (!args.title) throw new Error(mt('argsRequired', { args: 'title' }))
  const snippets = querySnippets()
  const snippet =
    snippets.find((s) => s.title === args.title) ??
    snippets.find((s) => s.title.toLowerCase().startsWith(args.title!.toLowerCase()))
  if (!snippet) throw new Error(mt('hostNotFound', { query: args.title }))
  const hostQuery = args.host
  if (!hostQuery) throw new Error(mt('argsRequired', { args: 'host' }))
  const found = resolveHost(hostQuery)
  if (!found.host) throw new Error(found.error)
  return toolExecCommand({ host: hostQuery, command: snippet.command })
}

async function toolSftpList(args: { host?: string; path?: string }) {
  if (!args.host || !args.path) throw new Error(mt('argsRequired', { args: 'host, path' }))
  const found = resolveHost(args.host)
  if (!found.host) throw new Error(found.error)
  const cfg: SftpHostConfig = {
    host: found.host.host,
    port: found.host.port,
    username: found.host.user,
    password: found.host.password,
    privateKeyPath: found.host.privateKeyPath,
    passphrase: found.host.passphrase,
  }
  const entries = await sftpListRemote(cfg, args.path)
  return entries.map((e) => ({
    name: e.name,
    type: e.isDir ? 'dir' : 'file',
    size: e.size,
    modified: new Date(e.mtime).toISOString(),
  }))
}

async function toolSftpRead(args: { host?: string; path?: string }) {
  if (!args.host || !args.path) throw new Error(mt('argsRequired', { args: 'host, path' }))
  const found = resolveHost(args.host)
  if (!found.host) throw new Error(found.error)
  const cfg: SftpHostConfig = {
    host: found.host.host,
    port: found.host.port,
    username: found.host.user,
    password: found.host.password,
    privateKeyPath: found.host.privateKeyPath,
    passphrase: found.host.passphrase,
  }
  return sftpReadRemoteFile(cfg, args.path).then((r) => r.content)
}

function dispatchTool(tool: string, args: Record<string, unknown>): Promise<unknown> {
  switch (tool) {
    case 'list_hosts':
      return Promise.resolve(toolListHosts())
    case 'exec_command':
      return toolExecCommand(args as never)
    case 'list_sessions':
      return Promise.resolve(toolListSessions())
    case 'read_session_output':
      return Promise.resolve(toolReadOutput(args as never))
    case 'send_session_input':
      return toolSendInput(args as never)
    case 'run_snippet':
      return toolRunSnippet(args as never)
    case 'sftp_list':
      return toolSftpList(args as never)
    case 'sftp_read_file':
      return toolSftpRead(args as never)
    default:
      return Promise.reject(new Error(mt('unknownTool', { tool })))
  }
}

// ── Socket server ────────────────────────────────────────────────────────────
function handleConnection(socket: net.Socket) {
  let authenticated = false
  let buffered = ''

  const respond = (msg: Record<string, unknown>) => {
    if (!socket.destroyed) socket.write(JSON.stringify(msg) + '\n')
  }

  socket.on('data', (chunk) => {
    buffered += chunk.toString('utf8')
    let nl: number
    while ((nl = buffered.indexOf('\n')) !== -1) {
      const line = buffered.slice(0, nl)
      buffered = buffered.slice(nl + 1)
      if (!line.trim()) continue
      let msg: { hello?: string; id?: number; tool?: string; args?: Record<string, unknown> }
      try {
        msg = JSON.parse(line)
      } catch {
        continue
      }

      if (!authenticated) {
        if (msg.hello === token) {
          authenticated = true
          respond({ ok: true })
        } else {
          respond({ ok: false, error: mt('tokenFailed') })
          socket.destroy()
        }
        continue
      }

      const reqId = msg.id
      const tool = msg.tool
      if (reqId === undefined || typeof tool !== 'string') continue
      dispatchTool(tool, msg.args ?? {})
        .then((data) => respond({ id: reqId, ok: true, data }))
        .catch((err) => respond({ id: reqId, ok: false, error: err instanceof Error ? err.message : String(err) }))
    }
  })
}

export function startMcpBridge(): void {
  if (server) return
  // bridge.json is written under ~/.tmx on every platform, so the
  // directory must exist before the socket starts listening (Windows named
  // pipes need no parent directory, but the config file still does).
  fs.mkdirSync(TMX_DIR, { recursive: true })
  if (process.platform !== 'win32') {
    try { fs.unlinkSync(socketPath()) } catch { /* not present */ }
  }
  token = randomBytes(24).toString('hex')

  server = net.createServer(handleConnection)
  server.on('error', (err) => {
    console.error('[mcp-bridge] server error:', err.message)
    server = null
  })
  // Publish the bridge config only once the socket is actually accepting
  // connections, so it never points at a dead path.
  server.listen(socketPath(), () => {
    fs.writeFileSync(
      BRIDGE_JSON_PATH,
      JSON.stringify({ socketPath: socketPath(), token, pid: process.pid, protocol: 1 }, null, 2),
    )
    try { fs.chmodSync(BRIDGE_JSON_PATH, 0o600) } catch { /* windows: no-op */ }
    console.error(`[mcp-bridge] listening on ${socketPath()}`)
  })
}

export function stopMcpBridge(): void {
  if (!server) return
  server.close()
  server = null
  try { fs.rmSync(BRIDGE_JSON_PATH, { force: true }) } catch { /* ignore */ }
  if (process.platform !== 'win32') {
    try { fs.unlinkSync(socketPath()) } catch { /* ignore */ }
  }
  console.error('[mcp-bridge] stopped')
}

export function startMcpBridgeIfEnabled(): void {
  if (prefBool('mcpEnabled', true)) startMcpBridge()
}

export function registerMcpBridge(getWin: () => BrowserWindow | null): void {
  getWindow = getWin

  ipcMain.handle('mcp:get-info', () => ({
    enabled: server !== null,
    requireConfirm: prefBool('mcpRequireConfirm', false),
    running: server !== null,
    serverPath: serverScriptPath(),
    bridgeConfigPath: BRIDGE_JSON_PATH,
    socketPath: socketPath(),
  }))

  ipcMain.handle('mcp:apply-config', (_event, cfg: { enabled?: boolean }) => {
    if (cfg.enabled) startMcpBridge()
    else stopMcpBridge()
    return { ok: true }
  })

  ipcMain.handle('mcp:confirm-response', (_event, payload: { reqId: string; allowed: boolean }) => {
    pendingConfirmations.get(payload.reqId)?.(payload.allowed)
    return { ok: true }
  })

  ipcMain.on('mcp:sync-sessions', (_event, list: SessionMeta[]) => {
    sessionRegistry.clear()
    for (const meta of list ?? []) {
      if (meta?.sessionId) sessionRegistry.set(meta.sessionId, meta)
    }
  })

  app.once('will-quit', () => stopMcpBridge())
}
