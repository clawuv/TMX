import { app, BrowserWindow, shell, ipcMain, dialog, nativeTheme } from 'electron'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import { update } from './update'
import { activeSshSessionCount, registerTerminalIpc } from './terminal'
import { registerSftpIpc } from './sftp'
import { registerLocalFsIpc } from './localfs'
import { initDb, readPreferences, registerDbIpc } from './db'
import { registerMcpBridge, startMcpBridgeIfEnabled } from './mcp-bridge'
import { registerSessionLogIpc } from './session-log'
import { installAppMenu, type MenuActionId } from './app-menu'
import { registerNativeDialogIpc } from './native-dialogs'
import { registerContextMenuIpc } from './context-menu'
import { restoreWindowBounds, trackWindowState } from './window-state'
import { registerWindowControls, trackWindowControls } from './window-controls'
import { mt } from './i18n'
import { registerApiTestIpc } from './api-test'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Product name drives the taskbar entry and default menu labels.
app.setName('TMX')

// The built directory structure
//
// ├─┬ dist-electron
// │ ├─┬ main
// │ │ └── index.js    > Electron-Main
// │ └─┬ preload
// │   └── index.mjs   > Preload-Scripts
// ├─┬ dist
// │ └── index.html    > Electron-Renderer
//
process.env.APP_ROOT = path.join(__dirname, '../..')

export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

// Disable GPU Acceleration for Windows 7
if (process.platform === 'win32' && os.release().startsWith('6.1')) app.disableHardwareAcceleration()

// Set application name for Windows 10+ notifications
if (process.platform === 'win32') app.setAppUserModelId(app.getName())

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

let win: BrowserWindow | null = null
let forceClose = false
const preload = path.join(__dirname, '../preload/index.mjs')
const indexHtml = path.join(RENDERER_DIST, 'index.html')

function appIcon(): string {
  return path.join(process.env.VITE_PUBLIC ?? '', process.platform === 'win32' ? 'favicon.ico' : 'brand/tmx-app.png')
}

function readPref(key: string, fallback: boolean): boolean {
  try {
    const v = readPreferences()?.[key]
    return typeof v === 'boolean' ? v : fallback
  } catch {
    return fallback
  }
}

// Windows/Linux accelerators (no menu bar). Keys are Ctrl/Cmd + key.
const ACCELERATOR_MAP: Record<string, MenuActionId> = {
  t: 'new-tab',
  w: 'close-tab',
  k: 'command-palette',
  i: 'copilot',
  b: 'sftp',
  d: 'split',
  ',': 'settings',
}

/** Native-feeling shortcuts without a menu bar (Windows/Linux only). */
function registerMenuAccelerators(target: BrowserWindow): void {
  const wc = target.webContents
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const mod = input.control || input.meta

    // Keep the desktop header and controls at a consistent size.
    if (mod && ['+', '=', '-', '_', '0'].includes(input.key)) {
      event.preventDefault()
      return
    }

    if (process.platform === 'darwin') return // macOS uses the application menu

    if (input.key === 'F11') {
      event.preventDefault()
      wc.send('menu:action', { action: 'zen' })
      return
    }
    if (!mod || input.shift || input.alt) return
    const action = ACCELERATOR_MAP[input.key.toLowerCase()]
    if (action) {
      event.preventDefault()
      wc.send('menu:action', { action })
    }
  })
}

async function createWindow() {
  // Local SQLite store (hosts/bookmarks/snippets/preferences) lives in userData
  initDb()
  // Start the MCP stdio bridge when the persisted preference allows it
  startMcpBridgeIfEnabled()

  const bounds = restoreWindowBounds()

  // Match the initial dark surface before Windows paints the non-client frame.
  if (process.platform === 'win32') nativeTheme.themeSource = 'dark'

  win = new BrowserWindow({
    title: 'TMX',
    icon: appIcon(),
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    // Show only once the first frame is painted — no white flash / web pop-in.
    show: false,
    // Solid background prevents flashes while resizing.
    backgroundColor: '#12141A',
    minWidth: 940,
    minHeight: 620,
    // On Windows, draw the caption buttons in the same surface as the header.
    // The native overlay can retain a bright seam during maximize/restore.
    // Keep the default thick frame for native edge resizing and shadows.
    ...(process.platform === 'win32' ? { frame: false } : {}),
    // Frameless Windows windows need WS_THICKFRAME to keep native edge resizing.
    ...(process.platform === 'win32' ? { thickFrame: true } : {}),
    titleBarStyle: 'hidden',
    titleBarOverlay: process.platform === 'win32' ? false : {
      color: '#15181F',
      symbolColor: '#94A3B8',
      height: 40,
    },
    // Center the macOS traffic lights in the 40px custom header
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 16, y: 14 } } : {}),
    webPreferences: {
      preload,
      // Hand the OS locale to the preload script without an async round-trip.
      additionalArguments: [`--tmx-locale=${app.getLocale()}`],
    },
  })

  // Remember size/position/maximized across launches.
  trackWindowState(win)

  trackWindowControls(win)

  // Desktop feel: no pinch zoom, and native accelerators without a menu bar.
  win.webContents.setVisualZoomLevelLimits(1, 1)
  win.webContents.setZoomFactor(1)
  win.webContents.on('zoom-changed', () => {
    win?.webContents.setZoomFactor(1)
  })
  registerMenuAccelerators(win)

  // Native quit confirmation when live SSH sessions would be dropped.
  win.on('close', (event) => {
    if (forceClose) return
    const count = activeSshSessionCount()
    if (count > 0 && readPref('warnOnCloseSession', true)) {
      event.preventDefault()
      void dialog
        .showMessageBox(win!, {
          type: 'warning',
          title: mt('dialogQuitTitle'),
          message: mt('dialogQuitMessage'),
          detail: mt('dialogQuitDetail', { count }),
          buttons: [mt('dialogQuitConfirm'), mt('dialogCancel')],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        })
        .then(({ response }) => {
          if (response === 0) {
            forceClose = true
            win?.close()
          }
        })
    }
  })

  win.once('ready-to-show', () => {
    win?.show()
    if (bounds.maximized) win?.maximize()
  })

  if (VITE_DEV_SERVER_URL) { // #298
    win.loadURL(VITE_DEV_SERVER_URL)
    // Open devTool if the app is not packaged
    win.webContents.openDevTools()
  } else {
    win.loadFile(indexHtml)
  }

  // Test actively push message to the Electron-Renderer
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', new Date().toLocaleString())
  })

  // Make all links open with the browser, not with the application
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) shell.openExternal(url)
    return { action: 'deny' }
  })

  // The renderer is our own bundle — refuse in-page navigation elsewhere so a
  // stray link/script can't swap the privileged context SFTP/SSH IPC trusts.
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })

  // Auto update. Installing quits the app — hand over a hook that flags
  // forceClose so the SSH-session close confirmation can't block the install.
  update(win, () => {
    forceClose = true
  })
}

app.whenReady().then(() => {
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(appIcon())
  // Real application menu (hidden bar on Windows/Linux) → native accelerators.
  installAppMenu()
  void createWindow()
})

app.on('window-all-closed', () => {
  win = null
  if (process.platform !== 'darwin') app.quit()
})

app.on('second-instance', () => {
  if (win) {
    // Focus on the main window if the user tried to open another
    if (win.isMinimized()) win.restore()
    if (!win.isVisible()) win.show()
    win.focus()
  }
})

app.on('activate', () => {
  const allWindows = BrowserWindow.getAllWindows()
  if (allWindows.length) {
    allWindows[0].focus()
  } else {
    createWindow()
  }
})

// New window example arg: new windows url
ipcMain.handle('open-win', (_, arg) => {
  const childWindow = new BrowserWindow({
    webPreferences: {
      preload,
      nodeIntegration: true,
      contextIsolation: false,
    },
  })

  if (VITE_DEV_SERVER_URL) {
    childWindow.loadURL(`${VITE_DEV_SERVER_URL}#${arg}`)
  } else {
    childWindow.loadFile(indexHtml, { hash: arg })
  }
})

// Keep the Windows backing surface and non-client theme in sync with the page.
ipcMain.handle('set-titlebar-overlay', (event, options: {
  color: string
  symbolColor: string
  backgroundColor: string
  light: boolean
}) => {
  if (process.platform !== 'win32') return
  const target = BrowserWindow.fromWebContents(event.sender) ?? win
  try {
    if (!target || target.isDestroyed()) return
    nativeTheme.themeSource = options.light ? 'light' : 'dark'
    target.setBackgroundColor(options.backgroundColor)
  } catch {
    // ignore invalid color formats from custom themes
  }
})

// Real terminal sessions (node-pty local shells + ssh2 remote shells)
registerWindowControls()
registerTerminalIpc(() => win)
// SFTP file browsing + upload/download transfers (own ssh2 connection pool)
registerSftpIpc(() => win)
// Local filesystem browsing for local shell tabs (SFTP panel in "local" mode)
registerLocalFsIpc()
// SQLite persistence for hosts/bookmarks/snippets/preferences
registerDbIpc()
// MCP server bridge: external AI tools connect via local stdio (see electron/mcp/server.mjs)
registerMcpBridge(() => win)
// Session output logging + zmodem file IO for rz/sz transfers
registerSessionLogIpc(() => win)
// Swagger import + AI batch API testing (spec fetch / LLM chat / test requests)
registerApiTestIpc()
// Native OS dialogs (confirm / message / save file) instead of browser modals
registerNativeDialogIpc(() => win)
// Renderer-driven native right-click menus
registerContextMenuIpc(() => win)
// OS locale for the renderer's language default (no async round-trip)
ipcMain.handle('app:get-locale', () => app.getLocale())
ipcMain.on('window:set-title', (event, title: string) => {
  BrowserWindow.fromWebContents(event.sender)?.setTitle(String(title ?? 'TMX'))
})
