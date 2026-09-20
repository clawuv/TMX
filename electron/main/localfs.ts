import { ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { mt } from './i18n'

// Local-filesystem backend for the SFTP panel when the active tab is a local
// shell: instead of an ssh2 SFTP channel we browse the machine's own disk.
// Paths cross the IPC boundary in forward-slash form (Node accepts them on
// Windows too) so the renderer's POSIX-style breadcrumb/join helpers work as-is.

const MAX_PREVIEW_BYTES = 2 * 1024 * 1024

export interface LocalFsEntry {
  name: string
  isDir: boolean
  size: number
  mode: number
  mtime: number
  uid: number
  gid: number
}

const toPosix = (p: string): string => p.split(path.sep).join('/')
const fromClient = (p: string): string => path.normalize(p)

function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000)
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true
  return false
}

export function registerLocalFsIpc(): void {
  ipcMain.handle('localfs:home', () => toPosix(os.homedir()))

  ipcMain.handle('localfs:list', async (_event, dir: string): Promise<LocalFsEntry[]> => {
    const target = fromClient(dir)
    const dirents = await fs.promises.readdir(target, { withFileTypes: true })
    const entries: LocalFsEntry[] = []
    for (const d of dirents) {
      try {
        const st = await fs.promises.stat(path.join(target, d.name))
        entries.push({
          name: d.name,
          // stat() follows symlinks, so directory links report as dirs.
          isDir: st.isDirectory(),
          size: st.size,
          mode: st.mode,
          mtime: st.mtimeMs,
          uid: st.uid,
          gid: st.gid,
        })
      } catch {
        // skip entries we cannot stat (broken symlink / permission)
      }
    }
    return entries
  })

  ipcMain.handle('localfs:read-file', async (_event, filePath: string) => {
    const target = fromClient(filePath)
    const st = await fs.promises.stat(target)
    if (st.size > MAX_PREVIEW_BYTES) throw new Error(mt('fileTooLarge'))
    const buf = await fs.promises.readFile(target)
    if (looksBinary(buf)) throw new Error(mt('binaryFile'))
    return { content: buf.toString('utf8'), size: st.size }
  })

  ipcMain.handle('localfs:write-file', async (_event, filePath: string, content: string) => {
    await fs.promises.writeFile(fromClient(filePath), content, 'utf8')
    return { ok: true }
  })

  ipcMain.handle('localfs:mkdir', async (_event, dirPath: string) => {
    await fs.promises.mkdir(fromClient(dirPath))
    return { ok: true }
  })

  ipcMain.handle('localfs:touch', async (_event, filePath: string) => {
    try {
      const fh = await fs.promises.open(fromClient(filePath), 'wx')
      await fh.close()
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'EEXIST') throw new Error(mt('nameExists'))
      throw err
    }
    return { ok: true }
  })

  ipcMain.handle('localfs:remove', async (_event, p: string, isDir: boolean) => {
    await fs.promises.rm(fromClient(p), { recursive: isDir, force: false })
    return { ok: true }
  })

  // Same-host copy used by upload (OS file → browsed dir) and download (browsed
  // file → OS downloads dir). Kept separate from the ssh transfer pipeline.
  ipcMain.handle('localfs:copy', async (_event, from: string, to: string) => {
    await fs.promises.copyFile(fromClient(from), fromClient(to))
    return { ok: true }
  })
}
