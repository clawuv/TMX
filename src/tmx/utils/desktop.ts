// Renderer-side facade over the native desktop capabilities added in the main
// process. Every helper degrades gracefully in a plain browser (dev server /
// Playwright) so the same components work in both environments.

import { hasConfirmHost, requestConfirm } from './confirm'

export function isElectron(): boolean {
  return typeof window !== 'undefined' && typeof window.ipcRenderer !== 'undefined'
}

const ip = () => window.ipcRenderer

// ── Dialogs ──────────────────────────────────────────────────────────────────

export interface ConfirmOptions {
  title?: string
  message: string
  detail?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

/**
 * Ask the user to confirm. Prefers the in-app themed dialog (the OS message box
 * reads as a web-page dialog in a desktop shell) and only falls back to the native
 * box when no host is mounted.
 */
export async function nativeConfirm(opts: ConfirmOptions): Promise<boolean> {
  if (hasConfirmHost()) return requestConfirm(opts)
  if (!isElectron()) {
    const text = opts.detail ? `${opts.message}\n\n${opts.detail}` : opts.message
    return typeof window !== 'undefined' ? window.confirm(text) : false
  }
  try {
    return (await ip().invoke('dialog:confirm', opts)) as boolean
  } catch {
    return false
  }
}

export async function nativeMessage(opts: { message: string; detail?: string; title?: string; danger?: boolean }): Promise<void> {
  if (hasConfirmHost()) {
    await requestConfirm({ ...opts, kind: 'notice' })
    return
  }
  if (!isElectron()) {
    if (typeof window !== 'undefined') window.alert(opts.detail ? `${opts.message}\n\n${opts.detail}` : opts.message)
    return
  }
  try {
    await ip().invoke('dialog:message', opts)
  } catch {
    // ignore
  }
}

export interface SaveFileOptions {
  content: string
  defaultPath?: string
  title?: string
  filters?: { name: string; extensions: string[] }[]
}

export async function nativeSaveFile(opts: SaveFileOptions): Promise<{ ok: boolean; path?: string }> {
  if (!isElectron()) {
    // Browser fallback: a transient object-URL download.
    try {
      const blob = new Blob([opts.content], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = opts.defaultPath?.split(/[\\/]/).pop() ?? 'export.json'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      return { ok: true }
    } catch {
      return { ok: false }
    }
  }
  return (await ip().invoke('dialog:save-file', opts)) as { ok: boolean; path?: string }
}

// ── Native context menus ─────────────────────────────────────────────────────

export interface MenuItemSpec {
  id?: string
  label?: string
  type?: 'normal' | 'separator'
  /** Native menu role (cut/copy/paste/selectAll) handled by Electron. */
  role?: 'cut' | 'copy' | 'paste' | 'selectAll'
  enabled?: boolean
  checked?: boolean
}

/** Pop a native OS context menu; invokes `onAction(id)` when an item is chosen. */
export function showContextMenu(items: MenuItemSpec[], onAction?: (id: string) => void): void {
  if (!isElectron() || items.length === 0) return
  const off = onAction
    ? ip().on('context-menu:action', (...args: unknown[]) => {
        const payload = args[0] as { id?: string } | undefined
        if (payload?.id) onAction(payload.id)
      })
    : null
  void ip()
    .invoke('context-menu:show', { items })
    .catch(() => {})
    .finally(() => off?.())
}

// ── Native application menu ──────────────────────────────────────────────────

export type MenuAction = 'new-tab' | 'close-tab' | 'settings' | 'command-palette' | 'copilot' | 'sftp' | 'split' | 'zen'

export function onMenuAction(cb: (action: MenuAction) => void): () => void {
  if (!isElectron()) return () => {}
  return ip().on('menu:action', (...args: unknown[]) => {
    const payload = args[0] as { action?: MenuAction } | undefined
    if (payload?.action) cb(payload.action)
  })
}

// ── Window / OS integration ──────────────────────────────────────────────────

export function setWindowTitle(title: string): void {
  if (typeof document !== 'undefined') document.title = title
  if (isElectron()) ip().send('window:set-title', title)
}

/** OS locale (e.g. "zh-CN"); empty string outside Electron. */
export function getSystemLocale(): string {
  return isElectron() ? ip().getLocale() : ''
}
