import { app, ipcMain, safeStorage } from 'electron'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

let db: Database.Database | null = null

// ── Credential encryption (OS keychain via Electron safeStorage) ──────────────
// Stored values are prefixed so plaintext rows from older versions keep working.
const ENC_PREFIX = 'enc1:'

function encryptCredential(plain?: string | null): string | null {
  if (!plain) return null
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return ENC_PREFIX + safeStorage.encryptString(plain).toString('base64')
    }
  } catch {
    // fall through to plaintext storage
  }
  return plain
}

function decryptCredential(stored?: string | null): string | undefined {
  if (!stored) return undefined
  if (stored.startsWith(ENC_PREFIX)) {
    try {
      return safeStorage.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), 'base64'))
    } catch {
      // Unreadable (keychain changed / OS profile moved) — treat as no credential
      return undefined
    }
  }
  return stored
}

export function getDbPath(): string {
  return path.join(app.getPath('userData'), 'tmx.db')
}

export function initDb(): void {
  if (db) return
  db = new Database(getDbPath())
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS hosts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      user TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 22,
      group_name TEXT NOT NULL DEFAULT '',
      tag TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'online',
      ping_ms INTEGER,
      cpu_load REAL,
      mem_load REAL,
      disk_load REAL,
      os TEXT,
      fingerprint TEXT,
      auth_method TEXT,
      favorite INTEGER NOT NULL DEFAULT 0,
      sort_index INTEGER,
      password TEXT,
      private_key_path TEXT,
      passphrase TEXT
    );
    CREATE TABLE IF NOT EXISTS snippets (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      command TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS preferences (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
}

// ── Payload shapes (mirrors the renderer's ConnectionHost / QuickSnippet) ──
interface HostPayload {
  id: string
  name: string
  host: string
  user: string
  port: number
  group: string
  tag: string
  status: string
  pingMs: number
  cpuLoad: number
  memLoad: number
  diskLoad: number
  os: string
  fingerprint: string
  authMethod: string
  favorite?: boolean
  sortIndex?: number
  password?: string
  privateKeyPath?: string
  passphrase?: string
}

interface SnippetPayload {
  id: string
  title: string
  command: string
  category: string
  description: string
}

interface HostRow {
  id: string
  name: string
  host: string
  user: string
  port: number
  group_name: string
  tag: string
  status: string
  ping_ms: number | null
  cpu_load: number | null
  mem_load: number | null
  disk_load: number | null
  os: string | null
  fingerprint: string | null
  auth_method: string | null
  favorite: number
  sort_index: number | null
  password: string | null
  private_key_path: string | null
  passphrase: string | null
}

function rowToHost(r: HostRow): HostPayload {
  return {
    id: r.id,
    name: r.name,
    host: r.host,
    user: r.user,
    port: r.port,
    group: r.group_name,
    tag: r.tag,
    status: r.status,
    pingMs: r.ping_ms ?? 0,
    cpuLoad: r.cpu_load ?? 0,
    memLoad: r.mem_load ?? 0,
    diskLoad: r.disk_load ?? 0,
    os: r.os ?? '',
    fingerprint: r.fingerprint ?? '',
    authMethod: r.auth_method ?? 'Password',
    favorite: r.favorite === 1,
    ...(r.sort_index !== null ? { sortIndex: r.sort_index } : {}),
    ...(decryptCredential(r.password) ? { password: decryptCredential(r.password) } : {}),
    ...(r.private_key_path ? { privateKeyPath: r.private_key_path } : {}),
    ...(decryptCredential(r.passphrase) ? { passphrase: decryptCredential(r.passphrase) } : {}),
  }
}

/** All hosts with stored credentials (used by the MCP bridge exec engine). */
export function queryHosts(): HostPayload[] {
  initDb()
  return (db!.prepare('SELECT * FROM hosts ORDER BY (sort_index IS NULL), sort_index, name').all() as HostRow[]).map(rowToHost)
}

export function querySnippets(): SnippetPayload[] {
  initDb()
  return db!.prepare('SELECT * FROM snippets ORDER BY rowid').all() as SnippetPayload[]
}

export function readPreferences(): Record<string, unknown> | null {
  initDb()
  const row = db!.prepare("SELECT value FROM preferences WHERE key = 'preferences'").get() as { value: string } | undefined
  return row ? JSON.parse(row.value) : null
}

/** Read a small app-level state blob (window geometry, last route, …). */
export function readAppState(key: string): string | null {
  initDb()
  const row = db!.prepare('SELECT value FROM app_state WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function writeAppState(key: string, value: string): void {
  initDb()
  db!.prepare('INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value)
}

export function registerDbIpc() {
  ipcMain.handle('db:get-all', () => {
    initDb()
    const hosts = (db!.prepare('SELECT * FROM hosts ORDER BY (sort_index IS NULL), sort_index, name').all() as HostRow[]).map(rowToHost)
    const snippets = db!.prepare('SELECT * FROM snippets ORDER BY rowid').all() as SnippetPayload[]
    const prefsRow = db!.prepare("SELECT value FROM preferences WHERE key = 'preferences'").get() as { value: string } | undefined
    const themeRow = db!.prepare("SELECT value FROM app_state WHERE key = 'themeId'").get() as { value: string } | undefined
    return {
      hosts,
      snippets,
      preferences: prefsRow ? JSON.parse(prefsRow.value) : null,
      themeId: themeRow?.value ?? null,
    }
  })

  ipcMain.handle('db:save-hosts', (_event, hosts: HostPayload[]) => {
    initDb()
    // Snapshot existing credentials so rows where the renderer omitted them
    // (e.g. state loaded before a password was added) keep their stored values
    // instead of being silently wiped by the replace-all below.
    interface CredRow { id: string; password: string | null; private_key_path: string | null; passphrase: string | null }
    const existing = new Map(
      (db!.prepare('SELECT id, password, private_key_path, passphrase FROM hosts').all() as CredRow[]).map((r) => [r.id, r]),
    )
    const insert = db!.prepare(`
      INSERT INTO hosts (id, name, host, user, port, group_name, tag, status, ping_ms, cpu_load, mem_load, disk_load, os, fingerprint, auth_method, favorite, sort_index, password, private_key_path, passphrase)
      VALUES (@id, @name, @host, @user, @port, @group, @tag, @status, @pingMs, @cpuLoad, @memLoad, @diskLoad, @os, @fingerprint, @authMethod, @favorite, @sortIndex, @password, @privateKeyPath, @passphrase)
    `)
    const tx = db!.transaction((list: HostPayload[]) => {
      db!.prepare('DELETE FROM hosts').run()
      for (const h of list) {
        const prev = existing.get(h.id)
        insert.run({
          id: h.id,
          name: h.name,
          host: h.host,
          user: h.user,
          port: h.port ?? 22,
          group: h.group ?? '',
          tag: h.tag ?? '',
          status: h.status ?? 'online',
          pingMs: h.pingMs ?? 0,
          cpuLoad: h.cpuLoad ?? 0,
          memLoad: h.memLoad ?? 0,
          diskLoad: h.diskLoad ?? 0,
          os: h.os ?? '',
          fingerprint: h.fingerprint ?? '',
          authMethod: h.authMethod ?? 'Password',
          favorite: h.favorite ? 1 : 0,
          sortIndex: h.sortIndex ?? null,
          password: h.password !== undefined ? encryptCredential(h.password) : (prev?.password ?? null),
          privateKeyPath: h.privateKeyPath ?? prev?.private_key_path ?? null,
          passphrase: h.passphrase !== undefined ? encryptCredential(h.passphrase) : (prev?.passphrase ?? null),
        })
      }
    })
    tx(hosts ?? [])
    return { ok: true }
  })

  ipcMain.handle('db:save-snippets', (_event, snippets: SnippetPayload[]) => {
    initDb()
    const insert = db!.prepare('INSERT INTO snippets (id, title, command, category, description) VALUES (@id, @title, @command, @category, @description)')
    const tx = db!.transaction((list: SnippetPayload[]) => {
      db!.prepare('DELETE FROM snippets').run()
      for (const s of list) {
        insert.run({
          id: s.id,
          title: s.title,
          command: s.command,
          category: s.category ?? 'System',
          description: s.description ?? '',
        })
      }
    })
    tx(snippets ?? [])
    return { ok: true }
  })

  ipcMain.handle('db:save-preferences', (_event, preferences: unknown) => {
    initDb()
    db!.prepare("INSERT INTO preferences (key, value) VALUES ('preferences', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify(preferences ?? {}))
    return { ok: true }
  })

  ipcMain.handle('db:save-theme', (_event, themeId: string) => {
    initDb()
    db!.prepare("INSERT INTO app_state (key, value) VALUES ('themeId', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(themeId)
    return { ok: true }
  })

  ipcMain.handle('db:clear-credentials', () => {
    initDb()
    db!.prepare('UPDATE hosts SET password = NULL, passphrase = NULL').run()
    return { ok: true }
  })

  ipcMain.handle('db:reset', () => {
    initDb()
    const tx = db!.transaction(() => {
      db!.prepare('DELETE FROM hosts').run()
      db!.prepare('DELETE FROM snippets').run()
      db!.prepare("DELETE FROM preferences WHERE key = 'preferences'").run()
    })
    tx()
    return { ok: true }
  })

  ipcMain.handle('db:get-stats', () => {
    initDb()
    let sizeBytes = 0
    try {
      sizeBytes = fs.statSync(getDbPath()).size
    } catch {
      // DB file not created yet
    }
    return {
      path: getDbPath(),
      hostCount: (db!.prepare('SELECT COUNT(*) AS c FROM hosts').get() as { c: number }).c,
      snippetCount: (db!.prepare('SELECT COUNT(*) AS c FROM snippets').get() as { c: number }).c,
      credentialsStored: (db!.prepare('SELECT COUNT(*) AS c FROM hosts WHERE password IS NOT NULL OR passphrase IS NOT NULL').get() as { c: number }).c,
      sizeBytes,
    }
  })
}
