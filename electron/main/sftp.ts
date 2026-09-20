import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import ssh2 from 'ssh2'
import { readPrivateKey } from './terminal'
import { mt } from './i18n'

export interface SftpHostConfig {
  host: string
  port?: number
  username: string
  password?: string
  privateKeyPath?: string
  passphrase?: string
  keepaliveInterval?: number
}

export interface SftpEntry {
  name: string
  isDir: boolean
  size: number
  /** epoch ms */
  mtime: number
  mode: number
  uid: number
  gid: number
}

interface PooledSftp {
  conn: ssh2.Client
  sftp: ssh2.SFTPWrapper
}

interface PoolEntry {
  credentialKey: string
  connection: Promise<PooledSftp>
}

type Emit = (channel: string, payload: unknown) => void

// ── Connection pool: one ssh2 connection (+ sftp channel) per host, reused ──
const pool = new Map<string, PoolEntry>()

function poolKey(cfg: SftpHostConfig): string {
  return `${cfg.username}@${cfg.host}:${cfg.port ?? 22}`
}

function credentialKey(cfg: SftpHostConfig): string {
  return createHash('sha256')
    .update(JSON.stringify({
      password: cfg.password ?? '',
      privateKeyPath: cfg.privateKeyPath ?? '',
      passphrase: cfg.passphrase ?? '',
      keepaliveInterval: cfg.keepaliveInterval ?? 0,
    }))
    .digest('hex')
}

function dropPoolEntry(key: string, expectedCredentialKey: string): void {
  if (pool.get(key)?.credentialKey === expectedCredentialKey) pool.delete(key)
}

async function getSftp(cfg: SftpHostConfig): Promise<PooledSftp> {
  const key = poolKey(cfg)
  const nextCredentialKey = credentialKey(cfg)
  const cached = pool.get(key)
  if (cached?.credentialKey === nextCredentialKey) return cached.connection

  if (cached) {
    try {
      const previous = await cached.connection
      previous.conn.end()
    } catch {
      // Failed connections are removed by their own error handler.
    }
    if (pool.get(key) === cached) pool.delete(key)
  }

  // A concurrent caller may have opened a matching replacement while the
  // previous connection was closing.
  const replacement = pool.get(key)
  if (replacement?.credentialKey === nextCredentialKey) return replacement.connection

  const created = openSftp(cfg, key, nextCredentialKey)
  pool.set(key, { credentialKey: nextCredentialKey, connection: created })
  created.catch(() => dropPoolEntry(key, nextCredentialKey))
  return created
}

function openSftp(
  cfg: SftpHostConfig,
  key: string,
  currentCredentialKey: string,
): Promise<PooledSftp> {
  if (!cfg.password && !cfg.privateKeyPath) {
    return Promise.reject(new Error(mt('noCredentials')))
  }
  return new Promise((resolve, reject) => {
    const conn = new ssh2.Client()
    let settled = false

    conn.on('error', (err) => {
      dropPoolEntry(key, currentCredentialKey)
      if (!settled) {
        settled = true
        reject(new Error(err.message || mt('sshFailed')))
      }
    })
    conn.on('close', () => dropPoolEntry(key, currentCredentialKey))
    conn.on('keyboard-interactive', (_name, _instr, _lang, _prompts, finish) => {
      finish([cfg.password ?? ''])
    })
    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err || !sftp) {
          dropPoolEntry(key, currentCredentialKey)
          try { conn.end() } catch { /* already closed */ }
          if (!settled) {
            settled = true
            reject(new Error(err?.message || mt('sftpChannelFailed')))
          }
          return
        }
        if (!settled) {
          settled = true
          resolve({ conn, sftp })
        }
      })
    })

    conn.connect({
      host: cfg.host,
      port: cfg.port ?? 22,
      username: cfg.username,
      readyTimeout: 15_000,
      ...(cfg.keepaliveInterval && cfg.keepaliveInterval > 0
        ? { keepalive: { interval: cfg.keepaliveInterval * 1000 } }
        : {}),
      ...(cfg.privateKeyPath ? { privateKey: readPrivateKey(cfg.privateKeyPath) } : {}),
      ...(cfg.password ? { password: cfg.password } : {}),
      ...(cfg.passphrase ? { passphrase: cfg.passphrase } : {}),
    })
  })
}

// ── Small promisified wrappers around the callback-style SFTPWrapper API ──
function sftpStat(sftp: ssh2.SFTPWrapper, path: string): Promise<ssh2.Stats> {
  return new Promise((resolve, reject) =>
    sftp.stat(path, (err, stats) => (err ? reject(new Error(err.message)) : resolve(stats))),
  )
}

function sftpReaddir(sftp: ssh2.SFTPWrapper, path: string): Promise<ssh2.FileEntry[]> {
  return new Promise((resolve, reject) =>
    sftp.readdir(path, (err, entries) => (err ? reject(new Error(err.message)) : resolve(entries))),
  )
}

function sftpRealpath(sftp: ssh2.SFTPWrapper, path: string): Promise<string> {
  return new Promise((resolve, reject) =>
    sftp.realpath(path, (err, p) => (err ? reject(new Error(err.message)) : resolve(p))),
  )
}

function sftpUnlink(sftp: ssh2.SFTPWrapper, path: string): Promise<void> {
  return new Promise((resolve, reject) =>
    sftp.unlink(path, (err) => (err ? reject(new Error(err.message)) : resolve())),
  )
}

function sftpRename(sftp: ssh2.SFTPWrapper, from: string, to: string): Promise<void> {
  return new Promise((resolve, reject) =>
    sftp.rename(from, to, (err) => (err ? reject(new Error(err.message)) : resolve())),
  )
}

function sftpRmdir(sftp: ssh2.SFTPWrapper, path: string): Promise<void> {
  return new Promise((resolve, reject) =>
    sftp.rmdir(path, (err) => (err ? reject(new Error(err.message)) : resolve())),
  )
}

const joinRemote = (dir: string, name: string) => `${dir.replace(/\/+$/, '')}/${name}`

// ── Shared remote operations (also used by the MCP bridge) ──
export async function sftpListRemote(cfg: SftpHostConfig, remotePath: string): Promise<SftpEntry[]> {
  const { sftp } = await getSftp(cfg)
  const entries = await sftpReaddir(sftp, remotePath)
  return entries.map((f) => ({
    name: f.filename,
    isDir: f.attrs.isDirectory(),
    size: Number(f.attrs.size),
    mtime: f.attrs.mtime * 1000,
    mode: f.attrs.mode,
    uid: f.attrs.uid,
    gid: f.attrs.gid,
  }))
}

export async function sftpReadRemoteFile(
  cfg: SftpHostConfig,
  remotePath: string,
): Promise<{ content: string; size: number }> {
  const { sftp } = await getSftp(cfg)
  const chunks: Buffer[] = []
  let size = 0
  await new Promise<void>((resolve, reject) => {
    const rs = sftp.createReadStream(remotePath)
    rs.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_PREVIEW_BYTES) {
        rs.destroy()
        reject(new Error(mt('fileTooLarge')))
        return
      }
      chunks.push(chunk)
    })
    rs.on('end', () => resolve())
    rs.on('error', (err) => reject(new Error(err.message)))
  })
  return { content: Buffer.concat(chunks).toString('utf8'), size }
}

async function removeRemote(sftp: ssh2.SFTPWrapper, path: string, isDir: boolean): Promise<void> {
  if (!isDir) {
    await sftpUnlink(sftp, path)
    return
  }
  const entries = await sftpReaddir(sftp, path)
  for (const entry of entries) {
    await removeRemote(sftp, joinRemote(path, entry.filename), entry.attrs.isDirectory())
  }
  await sftpRmdir(sftp, path)
}

// ── Transfers ────────────────────────────────────────────────────────────────
// Manual stream pipeline instead of fastGet/fastPut so transfers can be
// cancelled mid-flight and report progress.
interface ActiveTransfer {
  cancel: () => void
}

const transfers = new Map<string, ActiveTransfer>()
const cancelledTransfers = new Set<string>()

const MAX_PREVIEW_BYTES = 2 * 1024 * 1024

function runTransfer(
  emit: Emit,
  cfg: SftpHostConfig,
  opts: { transferId: string; direction: 'upload' | 'download'; remotePath: string; localPath: string },
): Promise<void> {
  const { transferId, direction, remotePath, localPath } = opts
  const name = remotePath.split('/').pop() || remotePath

  return getSftp(cfg).then(async ({ sftp }) => {
    if (cancelledTransfers.delete(transferId)) {
      emit('sftp:transfer', { transferId, direction, name, loaded: 0, total: 0, status: 'cancelled' })
      return
    }

    let cancelled = false
    let committed = false
    let finished = false
    let loaded = 0
    let lastEmitAt = 0

    const total =
      direction === 'download'
        ? (await sftpStat(sftp, remotePath)).size
        : (await fs.stat(localPath)).size

    const finish = (status: 'done' | 'cancelled' | 'error', message?: string) => {
      if (finished) return
      finished = true
      transfers.delete(transferId)
      emit('sftp:transfer', { transferId, direction, name, loaded, total, status, error: message })
    }

    const read =
      direction === 'download'
        ? sftp.createReadStream(remotePath, { highWaterMark: 512 * 1024 })
        : createReadStream(localPath, { highWaterMark: 512 * 1024 })
    const tempPath = `${direction === 'download' ? localPath : remotePath}.tmx-${transferId}.part`
    const write =
      direction === 'download'
        ? createWriteStream(tempPath)
        : sftp.createWriteStream(tempPath)

    const cleanupPartial = () =>
      direction === 'download'
        ? fs.unlink(tempPath).catch(() => {})
        : sftpUnlink(sftp, tempPath).catch(() => {})

    const cancel = () => {
      if (committed) return
      cancelled = true
      read.destroy()
      write.destroy()
      // Transfers only write to a private temporary path, so cancellation never
      // truncates or deletes a pre-existing destination file.
      void cleanupPartial()
      finish('cancelled')
    }
    transfers.set(transferId, { cancel })

    read.on('data', (chunk: Buffer) => {
      loaded += chunk.length
      const now = Date.now()
      if (now - lastEmitAt >= 100) {
        lastEmitAt = now
        emit('sftp:transfer', { transferId, direction, name, loaded, total, status: 'active' })
      }
    })

    try {
      await pipeline(read, write)
      if (cancelled) return
      if (direction === 'download') await fs.rename(tempPath, localPath)
      else await sftpRename(sftp, tempPath, remotePath)
      committed = true
      finish('done')
    } catch (err) {
      if (cancelled) return // finish('cancelled') already ran
      await cleanupPartial()
      finish('error', err instanceof Error ? err.message : String(err))
      throw err
    }
  })
}

export function registerSftpIpc(getWindow: () => BrowserWindow | null) {
  const emit: Emit = (channel, payload) => {
    getWindow()?.webContents.send(channel, payload)
  }

  ipcMain.handle('sftp:list', (_event, cfg: SftpHostConfig, path: string) => sftpListRemote(cfg, path))

  ipcMain.handle('sftp:home', async (_event, cfg: SftpHostConfig) => {
    const { sftp } = await getSftp(cfg)
    return { path: await sftpRealpath(sftp, '.') }
  })

  ipcMain.handle('sftp:mkdir', async (_event, cfg: SftpHostConfig, path: string) => {
    const { sftp } = await getSftp(cfg)
    await new Promise<void>((resolve, reject) =>
      sftp.mkdir(path, (err) => (err ? reject(new Error(err.message)) : resolve())),
    )
  })

  ipcMain.handle('sftp:touch', async (_event, cfg: SftpHostConfig, path: string) => {
    const { sftp } = await getSftp(cfg)
    await new Promise<void>((resolve, reject) => {
      // 'wx' fails when the file already exists, matching "新建" semantics.
      sftp.open(path, 'wx', (err, handle) => {
        if (err) {
          reject(new Error(err.message.includes('exists') ? mt('nameExists') : err.message))
          return
        }
        sftp.close(handle, (closeErr) =>
          closeErr ? reject(new Error(closeErr.message)) : resolve(),
        )
      })
    })
  })

  ipcMain.handle('sftp:remove', async (_event, cfg: SftpHostConfig, path: string, isDir: boolean) => {
    const { sftp } = await getSftp(cfg)
    await removeRemote(sftp, path, isDir)
  })

  ipcMain.handle('sftp:read-file', (_event, cfg: SftpHostConfig, path: string) =>
    sftpReadRemoteFile(cfg, path),
  )

  ipcMain.handle('sftp:write-file', async (_event, cfg: SftpHostConfig, path: string, content: string) => {
    const { sftp } = await getSftp(cfg)
    await new Promise<void>((resolve, reject) => {
      const ws = sftp.createWriteStream(path)
      ws.on('error', (err) => reject(new Error(err.message)))
      ws.on('close', () => resolve())
      ws.end(content, 'utf8')
    })
  })

  ipcMain.handle(
    'sftp:download',
    (_event, cfg: SftpHostConfig, remotePath: string, localPath: string, transferId: string) =>
      runTransfer(emit, cfg, { transferId, direction: 'download', remotePath, localPath }),
  )

  ipcMain.handle(
    'sftp:upload',
    (_event, cfg: SftpHostConfig, localPath: string, remotePath: string, transferId: string) =>
      runTransfer(emit, cfg, { transferId, direction: 'upload', remotePath, localPath }),
  )

  ipcMain.handle('sftp:cancel', (_event, transferId: string) => {
    const transfer = transfers.get(transferId)
    if (transfer) transfer.cancel()
    else cancelledTransfers.add(transferId)
  })

  ipcMain.handle('sftp:default-download-dir', () => app.getPath('downloads'))

  ipcMain.handle('sftp:pick-download-dir', async () => {
    const result = await dialog.showOpenDialog({
      title: mt('pickDownloadDir'),
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
}
