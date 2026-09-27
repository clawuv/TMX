import path from 'node:path'
import os from 'node:os'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { _electron as electron } from '@playwright/test'

const root = process.cwd()
const profile = await mkdtemp(path.join(os.tmpdir(), 'tmx-verify-'))
const bootstrap = path.join(profile, 'bootstrap.cjs')
await writeFile(bootstrap, `
  const { app } = require('electron');
  app.setPath('userData', ${JSON.stringify(profile)});
  app.setAppPath(${JSON.stringify(root)});
  import(${JSON.stringify(pathToFileURL(path.join(root, 'dist-electron/main/index.js')).href)});
`)

const app = await electron.launch({
  args: [bootstrap, '--no-sandbox'],
  cwd: root,
  env: { ...process.env, NODE_ENV: 'development' },
})
const page = await app.firstWindow()
await page.waitForSelector('#titlebar-integrated-header', { timeout: 25000 })
await page.waitForTimeout(1500)

await page.screenshot({ path: path.join(root, 'tmx-shot-dark.png') })
console.log('dark screenshot saved')

// Open settings via the sidebar gear, jump to the appearance tab.
await page.click('button:has(svg.lucide-settings)')
await page.waitForTimeout(800)
const navBtns = page.locator('div.w-40 button')
const appearance = navBtns.filter({ hasText: /外观|Appearance/i }).first()
await appearance.click()
await page.waitForTimeout(600)

const mistCard = page.locator('text=/Cloud Mist|晨雾/').first()
await mistCard.click()
await page.waitForTimeout(800)

// Close the settings modal (last X in DOM).
await page.locator('svg.lucide-x').last().click()
await page.waitForTimeout(1200)

await page.screenshot({ path: path.join(root, 'tmx-shot-light.png') })
console.log('light screenshot saved')

await app.close()
await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
console.log('DONE')
