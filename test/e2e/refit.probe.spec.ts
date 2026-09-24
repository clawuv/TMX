import path from 'node:path'
import os from 'node:os'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import {
  type ElectronApplication,
  type Page,
  expect,
  test,
  _electron as electron,
} from '@playwright/test'

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
  test.setTimeout(60000)
  await startXvfbOnLinux()
  testProfile = await mkdtemp(path.join(os.tmpdir(), 'tmx-e2e-refit-'))
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
})

test.afterAll(async () => {
  if (electronApp) {
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

/** Ratio of the (visible) xterm canvas width to its container width — 1.0 means fully fitted. */
const fittedRatio = () =>
  page.evaluate(() => {
    const screens = [...document.querySelectorAll('.xterm-screen')] as HTMLElement[]
    const screen = screens.find((s) => s.getBoundingClientRect().width > 0)
    const container = screen?.parentElement as HTMLElement | null
    if (!screen || !container) return -1
    return Math.round((screen.getBoundingClientRect().width / container.getBoundingClientRect().width) * 100) / 100
  })

test('terminal refits after drawer collapses', async () => {
  // Open a local terminal tab (Electron starts with no tabs).
  await page.getByRole('button', { name: /新建连接标签页|New tab/ }).click()
  await expect.poll(fittedRatio, { timeout: 15000 }).toBeGreaterThan(0)
  await page.waitForTimeout(800)

  const before = await fittedRatio()
  console.log('collapsed ratio:', before)

  // Expand the hosts drawer, let the layout settle.
  await page.getByRole('button', { name: /主机管理|Connections/ }).first().click()
  await page.waitForTimeout(800)
  const expanded = await fittedRatio()
  console.log('expanded ratio:', expanded)

  // Collapse it again and give the ResizeObserver a moment.
  await page.getByRole('button', { name: /主机管理|Connections/ }).first().click()
  await page.waitForTimeout(1200)
  const after = await fittedRatio()
  console.log('after-collapse ratio:', after)

  // The terminal must reclaim the full pane width after the drawer closes.
  expect(after).toBeGreaterThan(0.95)
})
