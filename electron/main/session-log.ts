import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { createWriteStream, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { onSessionData, onSessionExit } from './terminal'
import { mt } from './i18n'

// ── Session output logging ───────────────────────────────────────────────────
// One append-only plain-text file per recorded session under userData/logs.
// The tap in terminal.ts feeds every output chunk; zmodem transfers suspend it.

interface ActiveLog {
  stream: NodeJS.WriteStream
  path: string
}

const activeLogs = new Map<string, ActiveLog>()
let getWindow: () => BrowserWindow | null = () => null

function logsDir(): string {
  return path.join(app.getPath('userData'), 'logs')
}

function safeTitle(title: string): string {
  const cleaned = title.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '')
  return cleaned.slice(0, 40) || 'session'
}

function emitState(sessionId: string, recording: boolean, filePath?: string): void {
  getWindow()?.webContents.send('terminal-log:state', { sessionId, recording, path: filePath ?? null })
}

function stopLog(sessionId: string, notify: boolean): string | null {
  const entry = activeLogs.get(sessionId)
  if (!entry) return null
  activeLogs.delete(sessionId)
  entry.stream.end()
  if (notify) emitState(sessionId, false, entry.path)
  return entry.path
}

export function registerSessionLogIpc(getWin: () => BrowserWindow | null): void {
  getWindow = getWin

  // Subscribe once: append chunks for sessions that have an open log.
  onSessionData((sessionId, chunk) => {
    activeLogs.get(sessionId)?.stream.write(chunk)
  })

  ipcMain.handle('terminal-log:start', (_event, sessionId: string, title: string) => {
    if (activeLogs.has(sessionId)) return { ok: true, path: activeLogs.get(sessionId)!.path }
    mkdirSync(logsDir(), { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const filePath = path.join(logsDir(), `${stamp}-${safeTitle(title)}.log`)
    const stream = createWriteStream(filePath, { flags: 'ax' }) as unknown as NodeJS.WriteStream
    stream.write(`# TMX 会话日志\n# 标签: ${title}\n# 开始: ${new Date().toLocaleString()}\n\n`)
    activeLogs.set(sessionId, { stream, path: filePath })
    emitState(sessionId, true, filePath)
    return { ok: true, path: filePath }
  })

  ipcMain.handle('terminal-log:stop', (_event, sessionId: string) => {
    const filePath = stopLog(sessionId, true)
    return { ok: true, path: filePath }
  })

  ipcMain.handle('terminal-log:open-dir', () => {
    mkdirSync(logsDir(), { recursive: true })
    void shell.openPath(logsDir())
    return { ok: true, path: logsDir() }
  })

  // Sessions that exit while recording are flushed here automatically.
  onSessionExit((sessionId) => stopLog(sessionId, true))
}

// ── ZMODEM file IO (rz/sz payloads stream through the renderer's zmodem.js) ──

const writeStreams = new Map<number, { stream: NodeJS.WriteStream; path: string }>()
let nextHandle = 1

ipcMain.handle('zmodem:begin-write', (_event, filePath: string) => {
  // Avoid clobbering an existing download: name, name-1, name-2, …
  let target = filePath
  if (existsSync(target)) {
    const dot = filePath.lastIndexOf('.')
    const stem = dot > 0 ? filePath.slice(0, dot) : filePath
    const ext = dot > 0 ? filePath.slice(dot) : ''
    for (let i = 1; existsSync(target); i++) target = `${stem}-${i}${ext}`
  }
  const stream = createWriteStream(target, { flags: 'wx' }) as unknown as NodeJS.WriteStream
  const handle = nextHandle++
  writeStreams.set(handle, { stream, path: target })
  return { handle, path: target }
})

ipcMain.handle('zmodem:write-chunk', (_event, handle: number, bytes: Uint8Array) => {
  const entry = writeStreams.get(handle)
  if (!entry) throw new Error(mt('writeHandleMissing'))
  entry.stream.write(Buffer.from(bytes))
  return { ok: true }
})

ipcMain.handle('zmodem:end-write', (_event, handle: number, failed: boolean) => {
  const entry = writeStreams.get(handle)
  if (!entry) return { ok: false }
  writeStreams.delete(handle)
  entry.stream.end()
  if (failed) {
    // best-effort removal of a partial file so retries start clean
    try { unlinkSync(entry.path) } catch { /* already gone */ }
  }
  return { ok: true, path: entry.path }
})

ipcMain.handle('zmodem:default-download-dir', () => app.getPath('downloads'))

ipcMain.handle('zmodem:pick-send-file', async () => {
  const result = await dialog.showOpenDialog({
    title: mt('pickSendFile'),
    properties: ['openFile'],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

ipcMain.handle('zmodem:read-file-meta', (_event, filePath: string) => {
  try {
    return { size: statSync(filePath).size }
  } catch {
    throw new Error(mt('fileReadFailed', { path: filePath }))
  }
})

ipcMain.handle('zmodem:read-file-chunk', async (_event, filePath: string, offset: number, length: number) => {
  const fs = await import('node:fs')
  const fh = await fs.promises.open(filePath, 'r')
  try {
    const buf = Buffer.alloc(Math.min(length, 1024 * 512))
    const { bytesRead } = await fh.read(buf, 0, buf.length, offset)
    return new Uint8Array(buf.subarray(0, bytesRead))
  } finally {
    await fh.close()
  }
})
