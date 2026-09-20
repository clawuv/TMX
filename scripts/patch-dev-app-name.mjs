// Dev-mode Dock name fix: `app.setName()` cannot change the macOS Dock name in
// dev, because the Dock reads CFBundleName/CFBundleDisplayName from the stock
// Electron.app's Info.plist. Patch the plist after install, then re-sign the
// bundle (modifying the plist invalidates the seal — required on Apple Silicon).
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const APP_NAME = 'TMX'
const appPath = path.resolve('node_modules/electron/dist/Electron.app')
const plist = path.join(appPath, 'Contents', 'Info.plist')

if (process.platform !== 'darwin' || !existsSync(plist)) {
  process.exit(0)
}

const plistBuddy = '/usr/libexec/PlistBuddy'
const setKey = (key, value) => {
  try {
    execFileSync(plistBuddy, ['-c', `Set :${key} ${value}`, plist], { stdio: 'pipe' })
  } catch {
    execFileSync(plistBuddy, ['-c', `Add :${key} string ${value}`, plist], { stdio: 'pipe' })
  }
}

setKey('CFBundleName', APP_NAME)
setKey('CFBundleDisplayName', APP_NAME)
execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'pipe' })
console.log(`[patch-dev-app-name] dev Electron.app renamed to "${APP_NAME}" and re-signed`)
