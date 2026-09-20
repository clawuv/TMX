import type { ReactNode } from 'react'
import type { ThemeConfig } from '../types'

export function TitleBarTooltip({ label, theme, children, disabled = false }: {
  label: string
  theme: ThemeConfig
  children: ReactNode
  disabled?: boolean
}) {
  return (
    <div className="relative group flex">
      {children}
      {!disabled && <div
        aria-hidden="true"
        className="absolute top-full right-0 mt-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none transition-opacity duration-150 z-50 border"
        style={{ backgroundColor: theme.bgSurface, color: theme.textPrimary, borderColor: theme.borderHover,
          boxShadow: '0 2px 8px var(--chrome-shadow, rgba(0,0,0,0.18))' }}
      >
        {label}
      </div>}
    </div>
  )
}
