import path from 'node:path'
import os from 'node:os'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import {
  type ElectronApplication,
  type Page,
  type JSHandle,
  expect,
  test,
  _electron as electron,
} from '@playwright/test'
import type { BrowserWindow } from 'electron'

const root = path.resolve(import.meta.dirname, '..', '..')
let electronApp: ElectronApplication
let page: Page
let xvfbProcess: ChildProcess | undefined
let testProfile: string | undefined

function startXvfbOnLinux(): Promise<void> {
  if (process.platform !== 'linux' || process.env.DISPLAY) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    xvfbProcess = spawn('Xvfb', [':99', '-screen', '0', '1280x720x24', '-ac'], {
      stdio: 'ignore',
      detached: true,
    })

    xvfbProcess.once('error', reject)

    setTimeout(() => {
      process.env.DISPLAY = ':99'
      resolve()
    }, 500)
  })
}

test.beforeAll(async () => {
  test.setTimeout(30000)
  await startXvfbOnLinux()

  // Exercise the real main process without taking the running app's lock or
  // touching the user's hosts, sessions, or saved window bounds.
  testProfile = await mkdtemp(path.join(os.tmpdir(), 'tmx-e2e-'))
  const bootstrap = path.join(testProfile, 'bootstrap.cjs')
  await writeFile(bootstrap, `
    const { app } = require('electron');
    app.setPath('userData', ${JSON.stringify(testProfile)});
    app.setAppPath(${JSON.stringify(root)});
    import(${JSON.stringify(pathToFileURL(path.join(root, 'dist-electron/main/index.js')).href)});
  `)

  electronApp = await electron.launch({
    args: [bootstrap, '--no-sandbox'],
    cwd: root,
    env: { ...process.env, NODE_ENV: 'development' },
  })
  page = await electronApp.firstWindow()

  const mainWin: JSHandle<BrowserWindow> = await electronApp.browserWindow(page)
  await mainWin.evaluate(async (win) => {
    win.webContents.executeJavaScript('console.log("Execute JavaScript with e2e testing.")')
  })
})

test.afterAll(async () => {
  if (electronApp) {
    // Native teardown can hold the isolated Windows test process open on quit.
    // Terminate only the process tree created by this test's Electron launcher.
    const child = electronApp.process()
    if (process.platform === 'win32' && child.pid && child.exitCode === null) {
      await promisify(execFile)('taskkill', ['/PID', String(child.pid), '/T', '/F'])
    } else {
      await electronApp.close()
    }
  }

  if (xvfbProcess?.pid) {
    process.kill(-xvfbProcess.pid)
    xvfbProcess = undefined
  }
  if (testProfile) await rm(testProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

test.describe('[tmx] e2e tests', () => {
  test('startup window title reflects the app', async () => {
    await expect(page).toHaveTitle(/TMX/)
  })

  test('app shell renders title bar and status bar', async () => {
    await page.waitForSelector('#titlebar-integrated-header')
    await page.waitForSelector('#desktop-status-bar')
    expect(await page.$('#titlebar-integrated-header')).toBeTruthy()
    expect(await page.$('#desktop-status-bar')).toBeTruthy()
  })

  test('Windows caption controls follow native window state and resizing', async () => {
    test.skip(process.platform !== 'win32')
    const mainWin = await electronApp.browserWindow(page)
    const maximize = page.getByTestId('window-maximize')
    await expect(maximize).toBeVisible()
    for (let cycle = 0; cycle < 3; cycle++) {
      await maximize.click()
      await expect.poll(() => mainWin.evaluate(win => win.isMaximized())).toBe(true)
      await expect(maximize).toHaveAttribute('aria-label', /Restore|还原/)
      await maximize.click()
      await expect.poll(() => mainWin.evaluate(win => win.isMaximized())).toBe(false)
      await expect(maximize).toHaveAttribute('aria-label', /Maximize|最大化/)
    }
    await mainWin.evaluate(win => win.setSize(1040, 700))
    await expect.poll(() => mainWin.evaluate(win => win.getSize())).toEqual([1040, 700])
    await expect(page.getByTestId('window-close')).toBeInViewport()
    await page.getByTestId('window-minimize').click()
    await expect.poll(() => mainWin.evaluate(win => win.isMinimized())).toBe(true)
    await mainWin.evaluate(win => { win.restore(); win.focus() })
    await expect.poll(() => mainWin.evaluate(win => win.isMinimized())).toBe(false)
    // Prevent closing this test window and verify the button reaches the normal
    // close event, where the app's SSH confirmation also lives.
    await mainWin.evaluate(win => {
      win.once('close', event => {
        event.preventDefault()
        win.setTitle('caption-close-received')
      })
    })
    await page.getByTestId('window-close').click()
    await expect.poll(() => mainWin.evaluate(win => win.getTitle())).toBe('caption-close-received')
  })
})
