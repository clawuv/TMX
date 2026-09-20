import { app, ipcMain } from 'electron'
import type {
  ProgressInfo,
  UpdateDownloadedEvent,
  UpdateInfo,
} from 'electron-updater'
// Pure cjs module does not support named exports, so we need to import the default export and access the autoUpdater property
import updater from 'electron-updater'

const autoUpdater = updater.autoUpdater
let cancellationToken = new updater.CancellationToken()
let isDownloading = false
let activeWin: Electron.BrowserWindow | null = null
/** Set by index.ts so installing can bypass the SSH-session close confirmation. */
let beforeInstall: (() => void) | null = null
let errorListenerRegistered = false

function reportUpdateError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  isDownloading = false
  if (activeWin && !activeWin.isDestroyed() && !activeWin.webContents.isDestroyed()) {
    activeWin.webContents.send('update-error', { message })
  }
}

export function update(win: Electron.BrowserWindow, onInstall?: () => void) {
  activeWin = win
  beforeInstall = onInstall ?? null
  // Squirrel validates/stages a macOS update AFTER the download event. Keep
  // listening throughout the app lifetime so those asynchronous errors reach UI.
  if (!errorListenerRegistered) {
    autoUpdater.on('error', reportUpdateError)
    errorListenerRegistered = true
  }

  // When set to false, the update download will be triggered through the API
  autoUpdater.autoDownload = false
  autoUpdater.disableWebInstaller = false
  autoUpdater.allowDowngrade = false

  // start check
  autoUpdater.on('checking-for-update', function () { })
  // update available
  autoUpdater.on('update-available', (arg: UpdateInfo) => {
    win.webContents.send('update-can-available', { update: true, version: app.getVersion(), newVersion: arg?.version })
  })
  // update not available
  autoUpdater.on('update-not-available', (arg: UpdateInfo) => {
    win.webContents.send('update-can-available', { update: false, version: app.getVersion(), newVersion: arg?.version })
  })

  // Checking for updates
  ipcMain.handle('check-update', async () => {
    if (!app.isPackaged) {
      const error = new Error('The update feature is only available after the package.')
      return { message: error.message, error }
    }

    try {
      return await autoUpdater.checkForUpdates()
    } catch (error) {
      const resolvedError = error instanceof Error ? error : new Error('Network error')
      return { message: resolvedError.message, error: resolvedError }
    }
  })

  // Start downloading and feedback on progress
  ipcMain.handle('start-download', (event: Electron.IpcMainInvokeEvent) => {
    if (isDownloading) return

    isDownloading = true
    startDownload(
      (error, progressInfo) => {
        if (error) {
          isDownloading = false
          // feedback download error message
          // The persistent updater listener reports emitted errors.
        } else {
          // feedback update progress message
          event.sender.send('download-progress', progressInfo)
        }
      },
      () => {
        isDownloading = false
        // feedback update downloaded message
        event.sender.send('update-downloaded')
      }
    )
  })

  // Cancel downloading
  ipcMain.handle('cancel-download', () => {
    cancellationToken.cancel()
    cancellationToken = new updater.CancellationToken();
  })

  // Install now
  ipcMain.handle('quit-and-install', () => {
    // Installing quits the app; bypass the SSH-session close confirmation so
    // an explicit update install is never silently blocked by it.
    try {
      // Squirrel.Mac cannot update a translocated copy (app run from the DMG
      // instead of /Applications) — without this check the call fails silently.
      if (process.platform === 'darwin' && app.getPath('exe').includes('AppTranslocation')) {
        throw new Error('AppTranslocation')
      }
      beforeInstall?.()
      autoUpdater.quitAndInstall(false, true)
    } catch (error) {
      reportUpdateError(error)
    }
  })
}

function startDownload(
  callback: (error: Error | null, info: ProgressInfo | null) => void,
  complete: (event: UpdateDownloadedEvent) => void,
) {
  const onDownloadProgress = (info: ProgressInfo) => callback(null, info)
  const onError = (error: Error) => {
    cleanup()
    callback(error, null)
  }
  const onDownloaded = (event: UpdateDownloadedEvent) => {
    cleanup()
    complete(event)
  }

  const cleanup = () => {
    autoUpdater.off('download-progress', onDownloadProgress)
    autoUpdater.off('error', onError)
    autoUpdater.off('update-downloaded', onDownloaded)
  }

  autoUpdater.on('download-progress', onDownloadProgress)
  autoUpdater.on('error', onError)
  autoUpdater.once('update-downloaded', onDownloaded)
  // downloadUpdate can reject without emitting an error (for example before
  // an update has been selected). Never leave an unhandled main-process promise.
  void autoUpdater.downloadUpdate(cancellationToken).catch((error: unknown) => {
    cleanup()
    reportUpdateError(error)
  })
}
