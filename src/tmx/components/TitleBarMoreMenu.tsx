import { useEffect, useId, useRef, useState } from 'react'
import type { ComponentType, CSSProperties } from 'react'
import { Check, Menu } from 'lucide-react'
import type { ThemeConfig } from '../types'
import { useT } from '../i18n/context'
import { TitleBarTooltip } from './TitleBarTooltip'

export interface TitleBarAction {
  id: string
  label: string
  icon: ComponentType<{ className?: string }>
  run?: () => void
  disabled?: boolean
  active?: boolean
  recording?: boolean
  /** Global accelerator hint shown right-aligned (e.g. "⌘D"); omit when unbound. */
  shortcut?: string
}

export function TitleBarMoreMenu({ theme, actions, recording }: {
  theme: ThemeConfig
  actions: TitleBarAction[]
  recording: boolean
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const blur = () => setOpen(false)
    document.addEventListener('pointerdown', dismiss)
    window.addEventListener('blur', blur)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('blur', blur)
    }
  }, [open])

  const close = () => { setOpen(false); trigger.current?.focus() }

  return (
    <div ref={root} className="app-region-no-drag relative"
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
      }}
      onKeyDown={event => {
        if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close() }
      }}>
      <TitleBarTooltip theme={theme} label={t('titleBar.more')} disabled={open}>
        <button ref={trigger} type="button" aria-label={t('titleBar.more')}
          aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
          onClick={() => setOpen(value => !value)}
          onKeyDown={event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault(); setOpen(true)
            }
          }}
          className="relative hover-elevate text-slate-400 hover:text-slate-200 transition-colors"
          style={{ '--hover-bg': theme.bgActive, ...(open ? { backgroundColor: theme.bgActive } : {}) } as CSSProperties}>
          <Menu className="w-3.5 h-3.5" />
          {recording && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-rose-400" />}
        </button>
      </TitleBarTooltip>
      {open && (
        <div ref={menu} id={id} role="menu" aria-label={t('titleBar.more')}
          className="titlebar-more-menu absolute right-0 top-full mt-2 p-1 rounded-lg border z-50 w-max min-w-[150px] max-w-[calc(100vw-24px)]"
          style={{ backgroundColor: theme.bgSurface, borderColor: theme.borderHover, color: theme.textPrimary,
            '--menu-hover': theme.bgActive } as CSSProperties}
          onKeyDown={event => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
            if (!buttons.length) return
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
              : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
            buttons[next]?.focus()
          }}>
          {actions.map(({ id: actionId, label, icon: Icon, run, disabled, active, recording: recordingAction, shortcut }) => (
            <button key={actionId} type="button" role={active === undefined ? 'menuitem' : 'menuitemcheckbox'}
              aria-checked={active} disabled={disabled || !run} tabIndex={-1}
              onClick={() => { close(); run?.() }}
              className="flex items-center gap-2.5 w-full text-left text-xs disabled:opacity-35"
              style={recordingAction ? { color: theme.accentError } : undefined}>
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span className="flex-1">{label}</span>
              {shortcut && <span className="shrink-0 font-mono text-[10px] opacity-45">{shortcut}</span>}
              {active && <Check className="w-3.5 h-3.5 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
