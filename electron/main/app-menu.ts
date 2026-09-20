import { BrowserWindow, Menu } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { mt } from './i18n'

// macOS application menu, built so the OS menu bar mirrors the app's shortcuts.
// Windows/Linux deliberately get no menu bar (see installAppMenu): a native menu
// strip above the web content can flash/reserve space on resize. Those platforms
// use main-process before-input-event accelerators instead.

export type MenuActionId =
  | 'new-tab'
  | 'close-tab'
  | 'settings'
  | 'command-palette'
  | 'copilot'
  | 'sftp'
  | 'split'
  | 'zen'

function emit(action: MenuActionId): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  win?.webContents.send('menu:action', { action })
}

export function installAppMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }

  const template: MenuItemConstructorOptions[] = []

  template.push({ role: 'appMenu' })

  template.push({
    label: mt('menuFile'),
    submenu: [
      { label: mt('menuNewTab'), accelerator: 'CmdOrCtrl+T', click: () => emit('new-tab') },
      { label: mt('menuCloseTab'), accelerator: 'CmdOrCtrl+W', click: () => emit('close-tab') },
      { type: 'separator' },
      { label: mt('menuSettings'), accelerator: 'CmdOrCtrl+,', click: () => emit('settings') },
    ],
  })

  template.push({ role: 'editMenu' })

  template.push({
    label: mt('menuView'),
    submenu: [
      { label: mt('menuCommandPalette'), accelerator: 'CmdOrCtrl+K', click: () => emit('command-palette') },
      { label: mt('menuCopilot'), accelerator: 'CmdOrCtrl+I', click: () => emit('copilot') },
      { label: mt('menuSftp'), accelerator: 'CmdOrCtrl+B', click: () => emit('sftp') },
      { type: 'separator' },
      { label: mt('menuSplit'), accelerator: 'CmdOrCtrl+D', click: () => emit('split') },
      { label: mt('menuZen'), accelerator: 'F11', click: () => emit('zen') },
    ],
  })

  template.push({
    label: mt('menuWindow'),
    submenu: [
      { role: 'minimize', label: mt('menuMinimize') },
      { role: 'zoom' },
    ],
  })

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
