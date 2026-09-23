// The global fallback must only offer Copy when the click lands on the selection —
// not on blank chrome elsewhere (e.g. an empty area of a left drawer).
import { chromium } from 'playwright'

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
})
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
await page.goto('http://localhost:4173', { waitUntil: 'load' })
await page.waitForTimeout(1500)

// Stub the IPC bridge after load so showContextMenu records what it would show.
await page.evaluate(() => {
  const w = window as unknown as { __ctxCalls: { ch: string; items?: { id?: string; role?: string }[] }[]; ipcRenderer: unknown }
  w.__ctxCalls = []
  w.ipcRenderer = {
    invoke: (ch: string, payload: { items?: unknown }) => {
      w.__ctxCalls.push({ ch, items: payload?.items as { id?: string; role?: string }[] })
      return Promise.resolve({ shown: true })
    },
    on: () => () => {},
    send: () => {},
    off: () => {},
    getLocale: () => 'zh-CN',
    getPathForFile: () => '',
  }
})

const calls = () => page.evaluate(() => (window as unknown as { __ctxCalls: { ch: string }[] }).__ctxCalls)

// Select the mock terminal's text, then report where the selection sits.
const sel = await page.evaluate(() => {
  const el = document.querySelector('div[class*="select-text"]')
  const s = window.getSelection()
  if (!el || !s) return { error: 'no selectable element' }
  const range = document.createRange()
  range.selectNodeContents(el)
  s.removeAllRanges()
  s.addRange(range)
  const r = range.getBoundingClientRect()
  return { text: s.toString().trim().slice(0, 30), x: Math.round(r.left + 40), y: Math.round(r.top + 20) }
})
console.log('selection:', JSON.stringify(sel))

const before = (await calls()).length
await page.locator('#global-sidebar-navigation').click({ button: 'right' })
await page.waitForTimeout(300)
const onBlank = (await calls()).length - before

const before2 = (await calls()).length
if (sel) await page.mouse.click(sel.x, sel.y, { button: 'right' })
await page.waitForTimeout(300)
const onSelection = (await calls()).length - before2

console.log('right-click on blank drawer area -> context-menu:show calls:', onBlank)
console.log('right-click on the selected text -> context-menu:show calls:', onSelection)

await browser.close()
const ok = onBlank === 0 && onSelection === 1
console.log(ok ? '\nPASS: blank chrome suppressed, selected text still offers Copy' : '\nFAIL')
process.exit(ok ? 0 : 1)
