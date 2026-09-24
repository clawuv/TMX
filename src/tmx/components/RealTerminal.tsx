import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { X, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react'
import type { ThemeConfig } from '../types'
import { TerminalZmodem, type ZmodemTransfer } from '../utils/zmodem'
import { useI18n } from '../i18n/context'
import { showContextMenu, type MenuItemSpec } from '../utils/desktop'

interface RealTerminalProps {
  sessionId: string
  visible: boolean
  theme: ThemeConfig
  fontSize?: number
  fontFamily?: string
  lineHeight?: number
  cursorStyle?: 'block' | 'line' | 'underline'
  cursorBlink?: boolean
  scrollbackLimit?: number
  copyOnSelect?: boolean
  pasteOnRightClick?: boolean
  onSessionExit?: (sessionId: string) => void
  /** Written once into the terminal right after mount (e.g. local-shell welcome). */
  banner?: string
}

/** xterm accepts #rgb / #rrggbb / #rrggbbaa; themes carry rgba() strings, so convert. */
function toXtermColor(color: string, fallback: string): string {
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/.exec(color)
  if (m) {
    const alpha = m[4] ? Math.round(Number.parseFloat(m[4]) * 255).toString(16).padStart(2, '0') : 'ff'
    const hex = [m[1], m[2], m[3]]
      .map((v) => Number.parseInt(v, 10).toString(16).padStart(2, '0'))
      .join('')
    return `#${hex}${alpha}`
  }
  return color.startsWith('#') ? color : fallback
}

function terminalTheme(theme: ThemeConfig) {
  return {
    background: toXtermColor(theme.bgCanvas, '#191C24'),
    foreground: toXtermColor(theme.textPrimary, '#EDF2F7'),
    cursor: toXtermColor(theme.accentPrimary, '#38BDF8'),
    cursorAccent: toXtermColor(theme.bgCanvas, '#191C24'),
    selectionBackground: toXtermColor(theme.accentSoft, theme.bgActive),
    selectionForeground: toXtermColor(theme.textPrimary, '#EDF2F7'),
    black: toXtermColor(theme.ansi.black, '#252A34'),
    red: toXtermColor(theme.ansi.red, '#F87171'),
    green: toXtermColor(theme.ansi.green, '#34D399'),
    yellow: toXtermColor(theme.ansi.yellow, '#FBBF24'),
    blue: toXtermColor(theme.ansi.blue, '#60A5FA'),
    magenta: toXtermColor(theme.ansi.magenta, '#C084FC'),
    cyan: toXtermColor(theme.ansi.cyan, '#38BDF8'),
    white: toXtermColor(theme.ansi.white, '#E2E8F0'),
    brightBlack: toXtermColor(theme.ansi.brightBlack, '#475569'),
    brightRed: toXtermColor(theme.ansi.brightRed, '#EF4444'),
    brightGreen: toXtermColor(theme.ansi.brightGreen, '#10B981'),
    brightYellow: toXtermColor(theme.ansi.brightYellow, '#F59E0B'),
    brightBlue: toXtermColor(theme.ansi.brightBlue, '#3B82F6'),
    brightMagenta: toXtermColor(theme.ansi.brightMagenta, '#A855F7'),
    brightCyan: toXtermColor(theme.ansi.brightCyan, '#06B6D4'),
    brightWhite: toXtermColor(theme.ansi.brightWhite, '#F8FAFC'),
  }
}

/** xterm calls its block cursor styles "block"/"bar"/"underline"; "line" is our pref name for "bar". */
function toXtermCursorStyle(style: 'block' | 'line' | 'underline'): 'block' | 'bar' | 'underline' {
  return style === 'line' ? 'bar' : style
}

export function RealTerminal({
  sessionId,
  visible,
  theme,
  fontSize = 14,
  fontFamily = 'Fira Code',
  lineHeight = 1.2,
  cursorStyle = 'block',
  cursorBlink = true,
  scrollbackLimit = 5000,
  copyOnSelect = true,
  pasteOnRightClick = false,
  onSessionExit,
  banner,
}: RealTerminalProps) {
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const zmodemRef = useRef<TerminalZmodem | null>(null)
  const [transfers, setTransfers] = useState<ZmodemTransfer[]>([])
  const [zmToast, setZmToast] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(null)

  // Once every transfer reached a terminal state, let the overlay fade away on
  // its own instead of demanding a manual close.
  useEffect(() => {
    if (!transfers.length) return
    if (transfers.some((t) => t.status === 'active')) return
    const timer = window.setTimeout(() => setTransfers([]), 2500)
    return () => window.clearTimeout(timer)
  }, [transfers])
  // Mirror of `visible` for the resize observer below: the observer is registered
  // once per session, so reading the prop directly would capture a stale value
  // and silently skip resizes after tab switches.
  const visibleRef = useRef(visible)
  visibleRef.current = visible

  // Create the terminal once per session; the instance stays alive (scrollback,
  // vim, running jobs) while the pane is merely hidden on tab switches.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      fontSize,
      fontFamily: `${fontFamily}, 'Cascadia Mono', 'Fira Code', Consolas, monospace`,
      lineHeight,
      cursorStyle: toXtermCursorStyle(cursorStyle),
      cursorBlink,
      scrollback: scrollbackLimit,
      theme: terminalTheme(theme),
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)
    termRef.current = term
    fitRef.current = fit

    try {
      fit.fit()
    } catch {
      // container may be hidden (display:none) on first mount
    }
    if (banner) term.write(banner)
    window.ipcRenderer.send('terminal:resize', { id: sessionId, cols: term.cols, rows: term.rows })

    term.onData((data) => {
      if (zmodemRef.current?.active) return // keystrokes would corrupt the transfer
      window.ipcRenderer.send('terminal:input', { id: sessionId, data })
    })

    // Font/appearance option changes reflow xterm; keep the remote pty's
    // columns/rows in sync (duplicate sends are harmless — setWindow is idempotent).
    term.onResize(({ cols, rows }) => {
      window.ipcRenderer.send('terminal:resize', { id: sessionId, cols, rows })
    })

    // ZMODEM controller: protocol bytes never reach xterm, and terminal
    // bytes during a transfer are held back by the sentry itself.
    let toastTimer = 0
    zmodemRef.current = new TerminalZmodem(
      sessionId,
      (bytes) => window.ipcRenderer.send('terminal:input', { id: sessionId, data: bytes }),
      (bytes) => term.write(bytes),
      {
        onTransfer: (t) =>
          setTransfers((prev) => {
            const idx = prev.findIndex((x) => x.id === t.id)
            if (idx === -1) return [...prev, t]
            const next = [...prev]
            next[idx] = t
            return next
          }),
        onToast: (msg, kind) => {
          setZmToast({ msg, kind })
          window.clearTimeout(toastTimer)
          toastTimer = window.setTimeout(() => setZmToast(null), 4000)
        },
        tr: t,
      },
    )

    const unsubscribeData = window.ipcRenderer.on('terminal:data', (...args) => {
      const payload = args[0] as { id: string; data: Uint8Array }
      if (payload.id !== sessionId) return
      if (zmodemRef.current) zmodemRef.current.consume(payload.data)
      else term.write(payload.data)
    })
    const unsubscribeExit = window.ipcRenderer.on('terminal:exit', (...args) => {
      const payload = args[0] as { id: string; code: number }
      if (payload.id === sessionId) {
        term.write(`\r\n\x1b[90m${t('terminal.disconnected')}\x1b[0m\r\n`)
        onSessionExit?.(sessionId)
      }
    })

    const resize = () => {
      if (!visibleRef.current) return
      try {
        fit.fit()
        window.ipcRenderer.send('terminal:resize', { id: sessionId, cols: term.cols, rows: term.rows })
      } catch {
        // fit before layout settles can throw; next resize event retries
      }
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)

    return () => {
      observer.disconnect()
      unsubscribeData()
      unsubscribeExit()
      window.clearTimeout(toastTimer)
      zmodemRef.current?.abort()
      zmodemRef.current = null
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, banner])

  // Copy-on-select: mirror terminal selections into the system clipboard
  useEffect(() => {
    const term = termRef.current
    if (!term || !copyOnSelect) return
    const sub = term.onSelectionChange(() => {
      const sel = term.getSelection()
      if (sel) navigator.clipboard.writeText(sel).catch(() => {})
    })
    return () => sub.dispose()
  }, [copyOnSelect])

  // Live theme/appearance updates
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.theme = terminalTheme(theme)
    term.options.fontSize = fontSize
    term.options.fontFamily = `${fontFamily}, 'Cascadia Mono', 'Fira Code', Consolas, monospace`
    term.options.lineHeight = lineHeight
    term.options.cursorStyle = toXtermCursorStyle(cursorStyle)
    term.options.cursorBlink = cursorBlink
    term.options.scrollback = scrollbackLimit
    termRef.current?.focus()
  }, [theme, fontSize, fontFamily, lineHeight, cursorStyle, cursorBlink, scrollbackLimit])

  // Refit when the pane becomes visible again after a tab switch
  useEffect(() => {
    if (!visible) return
    const timer = window.setTimeout(() => {
      try {
        fitRef.current?.fit()
        const term = termRef.current
        if (term) {
          window.ipcRenderer.send('terminal:resize', { id: sessionId, cols: term.cols, rows: term.rows })
        }
        term?.focus()
      } catch {
        // container not measurable yet
      }
    }, 50)
    return () => window.clearTimeout(timer)
  }, [visible, sessionId])

  // xterm paints a whole number of text rows, which can leave a sub-row gap at the
  // bottom; painting the container in the canvas color keeps it visually seamless.
  // The outer padding gives the output breathing room on all sides; the inner div
  // is what xterm measures, so the fit addon accounts for the inset automatically.
  return (
    <div
      className="relative h-full w-full box-border"
      style={{ padding: '5px', backgroundColor: toXtermColor(theme.bgCanvas, '#191C24') }}
      onContextMenu={(e) => {
        // 右键粘贴开启时：直接把剪贴板内容写入 pty（PuTTY 风格），不弹菜单
        if (pasteOnRightClick) {
          e.preventDefault()
          navigator.clipboard
            .readText()
            .then((text) => {
              if (text) window.ipcRenderer.send('terminal:input', { id: sessionId, data: text })
            })
            .catch(() => {})
          return
        }
        e.preventDefault()
        e.stopPropagation()
        const term = termRef.current
        if (!term) return
        const items: MenuItemSpec[] = [
          { id: 'copy', label: t('common.copy'), enabled: term.hasSelection() },
          { id: 'paste', label: t('common.paste') },
          { type: 'separator' },
          { id: 'selectAll', label: t('common.selectAll') },
          { id: 'clear', label: t('titleBar.clear') },
        ]
        showContextMenu(items, (id) => {
          const live = termRef.current
          if (!live) return
          if (id === 'copy') {
            const sel = live.getSelection()
            if (sel) void navigator.clipboard.writeText(sel)
          } else if (id === 'paste') {
            void navigator.clipboard.readText().then((text) => {
              if (text) live.paste(text)
            })
          } else if (id === 'selectAll') {
            live.selectAll()
          } else if (id === 'clear') {
            live.clear()
          }
        })
      }}
    >
      <div ref={containerRef} className="h-full w-full" />

      {/* ZMODEM transfer overlay */}
      {transfers.length > 0 && (
        <div
          className="absolute right-3 bottom-3 left-3 z-30 rounded-xl border overflow-hidden"
          style={{ backgroundColor: theme.bgSurface, borderColor: theme.borderHover }}
        >
          <div
            className="flex items-center justify-between px-3 py-1.5 border-b text-[11px] font-medium"
            style={{ backgroundColor: theme.bgBase, borderColor: theme.borderSubtle, color: theme.textSecondary }}
          >
            <span>{t('terminal.zmodemTitle')}</span>
            <button
              onClick={() => setTransfers([])}
              className="text-slate-500 hover:text-slate-200"
              title={t('terminal.collapse')}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
          {transfers.slice(-4).map((tr) => {
            const pct = tr.size > 0 ? Math.min(100, Math.round((tr.loaded / tr.size) * 100)) : 0
            return (
              <div key={tr.id} className="flex items-center gap-2.5 px-3 py-2 text-xs">
                {tr.status === 'done' ? (
                  <ArrowDownToLine className="w-3.5 h-3.5 shrink-0" style={{ color: theme.accentSuccess }} />
                ) : (
                  <ArrowUpFromLine className="w-3.5 h-3.5 shrink-0 animate-pulse" style={{ color: theme.accentPrimary }} />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono-term" style={{ color: theme.textPrimary }}>
                      {tr.name}
                    </span>
                    <span className="shrink-0 text-[10px] font-mono" style={{ color: theme.textSecondary }}>
                      {tr.status === 'done'
                        ? t('terminal.zmodemDone')
                        : tr.status === 'error'
                          ? t('terminal.zmodemFailed', { error: tr.error ?? '' })
                          : `${pct}% · ${Math.round(tr.loaded / 1024)}/${Math.round(tr.size / 1024)} KB`}
                    </span>
                  </div>
                  <div className="mt-1 h-1 rounded-full overflow-hidden" style={{ backgroundColor: theme.bgActive }}>
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${pct}%`,
                        backgroundColor:
                          tr.status === 'error' ? theme.accentError : tr.status === 'done' ? theme.accentSuccess : theme.accentPrimary,
                      }}
                    />
                  </div>
                </div>
                {tr.status === 'active' && (
                  <button
                    onClick={() => zmodemRef.current?.abort()}
                    className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-500/20 shrink-0"
                    title={t('terminal.zmodemCancel')}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {zmToast && (
        <div
          className="absolute top-3 left-1/2 -translate-x-1/2 z-30 px-3 py-1.5 rounded-lg border text-[11px] max-w-[80%] truncate"
          style={{
            backgroundColor: theme.bgSurface,
            borderColor: zmToast.kind === 'err' ? theme.accentError : theme.borderHover,
            color: zmToast.kind === 'err' ? theme.accentError : theme.textPrimary,
          }}
        >
          {zmToast.msg}
        </div>
      )}
    </div>
  )
}
