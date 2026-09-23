import { chromium } from 'playwright'

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
})
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
await page.goto('http://localhost:4173', { waitUntil: 'load' })
await page.waitForTimeout(1500)

const point = await page.evaluate(() => {
  const el = document.querySelector('div[class*="select-text"]')
  const s = window.getSelection()
  const range = document.createRange()
  range.selectNodeContents(el!)
  s!.removeAllRanges()
  s!.addRange(range)
  const r = range.getBoundingClientRect()
  const x = Math.round(r.left + 40)
  const y = Math.round(r.top + 20)
  const at = document.elementFromPoint(x, y) as HTMLElement | null
  return { x, y, rect: { l: r.left, t: r.top, r: r.right, b: r.bottom }, at: at?.className?.toString().slice(0, 60) }
})
console.log('target point:', JSON.stringify(point))

// Does a right-click preserve the selection?
await page.mouse.click(point.x, point.y, { button: 'right' })
await page.waitForTimeout(200)
const after = await page.evaluate(() => {
  const s = window.getSelection()
  if (!s || s.rangeCount === 0) return { rangeCount: 0 }
  const r = s.getRangeAt(0).getBoundingClientRect()
  return { rangeCount: s.rangeCount, collapsed: s.isCollapsed, text: s.toString().slice(0, 20), rect: { l: r.left, t: r.top, r: r.right, b: r.bottom } }
})
console.log('selection after right-click:', JSON.stringify(after))

await browser.close()
