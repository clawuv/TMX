import { useEffect, useState } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import { useT } from '../i18n/context'
import type { ThemeConfig } from '../types'
import { TitleBarTooltip } from './TitleBarTooltip'

export function WindowControls({ theme }: { theme: ThemeConfig }) {
  const t = useT()
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    let active = true
    let receivedEvent = false
    const unsubscribe = window.ipcRenderer.on('window:maximized', (value: boolean) => {
      receivedEvent = true
      setMaximized(value)
    })
    void window.ipcRenderer.invoke('window:is-maximized').then((value: boolean) => {
      if (active && !receivedEvent) setMaximized(value)
    }).catch(() => {})
    return () => { active = false; unsubscribe() }
  }, [])

  const send = (action: string) => window.ipcRenderer.send('window:control', action)
  const maximizeLabel = t(maximized ? 'titleBar.restoreWindow' : 'titleBar.maximizeWindow')

  return (
    <div className="app-region-no-drag flex items-center gap-1 shrink-0 -mr-1">
      <TitleBarTooltip label={t('titleBar.minimizeWindow')} theme={theme}>
      <button type="button" data-testid="window-minimize" className="window-caption-button text-slate-400 hover:text-slate-200 transition-colors"
        aria-label={t('titleBar.minimizeWindow')}
        onClick={() => send('minimize')}>
        <Minus className="w-3.5 h-3.5" />
      </button>
      </TitleBarTooltip>
      <TitleBarTooltip label={maximizeLabel} theme={theme}>
      <button type="button" data-testid="window-maximize" className="window-caption-button text-slate-400 hover:text-slate-200 transition-colors"
        aria-label={maximizeLabel} onClick={() => send('toggle-maximize')}>
        {maximized ? <Copy className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
      </button>
      </TitleBarTooltip>
      <TitleBarTooltip label={t('titleBar.closeWindow')} theme={theme}>
      <button type="button" data-testid="window-close" className="window-caption-button window-caption-close text-slate-400 transition-colors"
        aria-label={t('titleBar.closeWindow')}
        onClick={() => send('close')}>
        <X className="w-3.5 h-3.5" />
      </button>
      </TitleBarTooltip>
    </div>
  )
}
