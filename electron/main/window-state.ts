import { BrowserWindow, screen } from 'electron'
import { readAppState, writeAppState } from './db'

// Native apps remember where you left them. We persist the window rectangle in
// the same SQLite app_state table used for the theme, then clamp it back onto a
// currently-attached display so a saved position from a disconnected monitor
// never strands the window off-screen.

export interface WindowBounds {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

const STATE_KEY = 'windowBounds'
const DEFAULT_WIDTH = 1280
const DEFAULT_HEIGHT = 800
const MIN_WIDTH = 940
const MIN_HEIGHT = 620

export function restoreWindowBounds(): WindowBounds {
  let saved: Partial<WindowBounds> | null = null
  try {
    const raw = readAppState(STATE_KEY)
    if (raw) saved = JSON.parse(raw) as Partial<WindowBounds>
  } catch {
    // corrupt/absent state — fall through to defaults
  }

  if (typeof saved?.width !== 'number' || typeof saved?.height !== 'number') {
    return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, maximized: false }
  }

  const hasPos = typeof saved.x === 'number' && typeof saved.y === 'number'
  const area = hasPos
    ? screen.getDisplayMatching({
        x: saved.x as number,
        y: saved.y as number,
        width: saved.width,
        height: saved.height,
      }).workArea
    : screen.getPrimaryDisplay().workArea

  const width = Math.min(Math.max(saved.width, MIN_WIDTH), area.width)
  const height = Math.min(Math.max(saved.height, MIN_HEIGHT), area.height)

  let x = hasPos ? (saved.x as number) : undefined
  let y = hasPos ? (saved.y as number) : undefined
  const offScreen =
    x !== undefined &&
    y !== undefined &&
    (x < area.x - 40 ||
      y < area.y - 40 ||
      x + width > area.x + area.width + 40 ||
      y + height > area.y + area.height + 40)
  if (offScreen) {
    x = area.x + Math.round((area.width - width) / 2)
    y = area.y + Math.round((area.height - height) / 2)
  }

  return { ...(x !== undefined ? { x } : {}), ...(y !== undefined ? { y } : {}), width, height, maximized: saved.maximized === true }
}

/** Persist geometry on move/resize (debounced) and toggles; flush on close. */
export function trackWindowState(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null

  const persist = () => {
    if (win.isDestroyed()) return
    try {
      const maximized = win.isMaximized()
      const bounds = maximized && typeof win.getNormalBounds === 'function' ? win.getNormalBounds() : win.getBounds()
      writeAppState(STATE_KEY, JSON.stringify({ ...bounds, maximized }))
    } catch {
      // window torn down mid-write
    }
  }

  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(persist, 300)
  }

  win.on('resize', schedule)
  win.on('move', schedule)
  win.on('maximize', schedule)
  win.on('unmaximize', schedule)
  win.on('close', () => {
    if (timer) clearTimeout(timer)
    persist()
  })
}
