import { useSyncExternalStore } from 'react'
import { isElectron } from './desktop'

// Shared updater state fed by the electron-updater IPC bridge in
// electron/main/update.ts. One module-level store so the sidebar badge and the
// settings About tab always agree, even though they mount at different times.

export type UpdatePhase = 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'downloaded'

export interface UpdateSnapshot {
  phase: UpdatePhase
  version: string
  newVersion: string | null
  progress: { percent: number; bytesPerSecond: number } | null
  /** Last failure message; null when clean. */
  error: string | null
  /** True when the failure is just "not a packaged build" (dev mode). */
  packagedOnly: boolean
}

let snapshot: UpdateSnapshot = {
  phase: 'idle',
  version: __APP_VERSION__,
  newVersion: null,
  progress: null,
  error: null,
  packagedOnly: false,
}

const listeners = new Set<() => void>()

function setSnapshot(patch: Partial<UpdateSnapshot>): void {
  snapshot = { ...snapshot, ...patch }
  listeners.forEach((l) => l())
}

export function subscribeUpdateState(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getUpdateSnapshot(): UpdateSnapshot {
  return snapshot
}

export function useUpdateState(): UpdateSnapshot {
  return useSyncExternalStore(subscribeUpdateState, getUpdateSnapshot)
}

let wired = false

/** Wire the main-process updater events once per session. No-op outside Electron. */
export function initUpdateBridge(): void {
  if (wired || !isElectron()) return
  wired = true
  const ipc = window.ipcRenderer
  ipc.on('update-can-available', (...args: unknown[]) => {
    const p = args[0] as { update: boolean; version: string; newVersion: string }
    setSnapshot({
      phase: p.update ? 'available' : 'up-to-date',
      version: p.version,
      newVersion: p.newVersion,
      progress: null,
      error: null,
      packagedOnly: false,
    })
  })
  ipc.on('download-progress', (...args: unknown[]) => {
    const info = args[0] as { percent: number; bytesPerSecond: number }
    setSnapshot({
      progress: {
        percent: Math.min(100, Math.round(info?.percent ?? 0)),
        bytesPerSecond: info?.bytesPerSecond ?? 0,
      },
    })
  })
  ipc.on('update-downloaded', () => {
    setSnapshot({ phase: 'downloaded', progress: null })
  })
  ipc.on('update-error', (...args: unknown[]) => {
    const p = args[0] as { message?: string }
    setSnapshot({
      phase: snapshot.phase === 'downloading' ? 'available' : snapshot.phase,
      progress: null,
      error: p?.message || 'Update failed',
    })
  })
  // The main process checks at launch (while the splash is up). Pick up that
  // cached result here in case the event fired before this bridge was wired.
  void (async () => {
    try {
      const last = (await ipc.invoke('update:last-check')) as {
        update: boolean
        version: string
        newVersion: string | null
      } | null
      if (last && snapshot.phase === 'idle') {
        setSnapshot({
          phase: last.update ? 'available' : 'up-to-date',
          version: last.version,
          newVersion: last.newVersion,
          progress: null,
          error: null,
          packagedOnly: false,
        })
      }
    } catch {}
  })()
}

export async function checkForUpdates(): Promise<void> {
  if (!isElectron()) return
  setSnapshot({ phase: 'checking', error: null, packagedOnly: false })
  try {
    const res = await window.ipcRenderer.invoke('check-update')
    if (res?.error) {
      const msg = typeof res.message === 'string' ? res.message : ''
      const packagedOnly = msg.includes('only available after the package')
      // Success path is otherwise driven by the `update-can-available` event.
      setSnapshot({
        phase: 'idle',
        packagedOnly,
        error: packagedOnly ? null : msg || 'Update failed',
      })
    }
  } catch (err) {
    setSnapshot({ phase: 'idle', error: err instanceof Error ? err.message : String(err) })
  }
}

export function startUpdateDownload(): void {
  if (!isElectron()) return
  setSnapshot({ phase: 'downloading', progress: null, error: null })
  void window.ipcRenderer.invoke('start-download')
}

export function cancelUpdateDownload(): void {
  if (!isElectron()) return
  setSnapshot({ phase: snapshot.newVersion ? 'available' : 'idle', progress: null })
  void window.ipcRenderer.invoke('cancel-download')
}

export function installUpdate(): void {
  if (!isElectron()) return
  setSnapshot({ error: null })
  void window.ipcRenderer.invoke('quit-and-install').catch((error: unknown) => {
    setSnapshot({ error: error instanceof Error ? error.message : String(error) })
  })
}
