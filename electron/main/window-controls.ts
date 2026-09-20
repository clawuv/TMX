import { BrowserWindow, ipcMain } from 'electron'

export function registerWindowControls(): void {
  ipcMain.handle('window:is-maximized', (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  })
  ipcMain.on('window:control', (event, action: unknown) => {
    const target = BrowserWindow.fromWebContents(event.sender)
    if (!target || target.isDestroyed()) return
    switch (action) {
      case 'minimize': target.minimize(); break
      case 'toggle-maximize':
        if (target.isMaximized()) target.unmaximize()
        else target.maximize()
        break
      // Keep the normal close event, including active SSH session confirmation.
      case 'close': target.close(); break
    }
  })
}

export function trackWindowControls(target: BrowserWindow): void {
  const notify = () => {
    if (!target.isDestroyed() && !target.webContents.isDestroyed()) {
      target.webContents.send('window:maximized', target.isMaximized())
    }
  }
  target.on('maximize', notify)
  target.on('unmaximize', notify)
}
