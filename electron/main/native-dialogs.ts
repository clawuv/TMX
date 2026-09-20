import { BrowserWindow, dialog, ipcMain } from 'electron'
import { writeFileSync } from 'node:fs'
import { mt } from './i18n'

// Native OS dialogs replace the browser's window.confirm / <a download> blob,
// whose Chromium chrome (origin badge, download shelf) instantly reads as a
// web page in a shell. All of these are safe no-ops in a plain browser because
// the renderer wraps them behind an IPC availability check.

interface ConfirmOptions {
  title?: string
  message: string
  detail?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

interface MessageOptions {
  title?: string
  message: string
  detail?: string
  danger?: boolean
}

interface SaveFileOptions {
  title?: string
  defaultPath?: string
  filters?: Electron.FileFilter[]
  content: string
}

function ownerWindow(getWindow: () => BrowserWindow | null, sender: Electron.WebContents): BrowserWindow | undefined {
  return BrowserWindow.fromWebContents(sender) ?? getWindow() ?? undefined
}

export function registerNativeDialogIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('dialog:confirm', async (event, opts: ConfirmOptions) => {
    const win = ownerWindow(getWindow, event.sender)
    const { response } = await dialog.showMessageBox(win!, {
      type: opts.danger ? 'warning' : 'question',
      title: opts.title ?? mt('dialogConfirmTitle'),
      message: opts.message,
      ...(opts.detail ? { detail: opts.detail } : {}),
      buttons: [opts.confirmLabel ?? mt('dialogOk'), opts.cancelLabel ?? mt('dialogCancel')],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    })
    return response === 0
  })

  ipcMain.handle('dialog:message', async (event, opts: MessageOptions) => {
    const win = ownerWindow(getWindow, event.sender)
    await dialog.showMessageBox(win!, {
      type: opts.danger ? 'warning' : 'info',
      title: opts.title ?? 'TMX',
      message: opts.message,
      ...(opts.detail ? { detail: opts.detail } : {}),
      buttons: [mt('dialogOk')],
      defaultId: 0,
      noLink: true,
    })
    return true
  })

  ipcMain.handle('dialog:save-file', async (event, opts: SaveFileOptions) => {
    const win = ownerWindow(getWindow, event.sender)
    const { canceled, filePath } = await dialog.showSaveDialog(win!, {
      title: opts.title ?? mt('dialogSaveConfigTitle'),
      ...(opts.defaultPath ? { defaultPath: opts.defaultPath } : {}),
      ...(opts.filters ? { filters: opts.filters } : {}),
    })
    if (canceled || !filePath) return { ok: false as const }
    try {
      writeFileSync(filePath, opts.content, 'utf8')
      return { ok: true as const, path: filePath }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
