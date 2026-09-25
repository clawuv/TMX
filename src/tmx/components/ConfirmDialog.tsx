import React, { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Info, X } from 'lucide-react'
import type { ThemeConfig } from '../types'
import { useT } from '../i18n/context'
import { settleConfirm, subscribeConfirm, type ConfirmRequest } from '../utils/confirm'

interface ConfirmDialogProps {
  theme: ThemeConfig
}

/**
 * Themed replacement for the OS message box. Mounted once at the app root; any
 * module can await a confirmation via `nativeConfirm` / `requestConfirm`.
 * Layout mirrors the SFTP "new entry" modal: flat panel, icon + title + close
 * header, plain-text cancel and a single filled action button.
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({ theme }) => {
  const t = useT()
  const [request, setRequest] = useState<ConfirmRequest | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => subscribeConfirm(setRequest), [])

  useEffect(() => {
    if (!request) return
    // Focus the dialog itself (not a button) so opening it doesn't paint a focus
    // ring on the action; Tab still reaches both buttons.
    panelRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        settleConfirm(false)
        return
      }
      // Enter activates whatever button has focus, so only handle it when focus is
      // still on the dialog itself.
      if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault()
        settleConfirm(true)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [request])

  if (!request) return null

  const notice = request.kind === 'notice'
  const danger = Boolean(request.danger) && !notice
  const Icon = notice ? Info : AlertTriangle
  const iconColor = danger ? theme.accentWarning : theme.accentPrimary

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/45"
      onClick={() => settleConfirm(false)}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={request.title ?? t('common.confirmTitle')}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-sm rounded-xl border p-4 text-slate-200 space-y-3 outline-none"
        style={{ backgroundColor: theme.bgSurface, borderColor: theme.borderHover }}
      >
        <div
          className="flex items-center gap-2 pb-2 border-b"
          style={{ borderColor: theme.borderSubtle }}
        >
          <Icon className="w-4 h-4 shrink-0" style={{ color: iconColor }} />
          <span className="font-semibold text-xs">
            {request.title ?? (notice ? t('common.notice') : t('common.confirmTitle'))}
          </span>
          <button
            type="button"
            onClick={() => settleConfirm(false)}
            aria-label={t('common.close')}
            title={t('common.close')}
            className="ml-auto p-1.5 -m-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs leading-relaxed text-slate-200 whitespace-pre-wrap break-words">
          {request.message}
        </p>
        {request.detail && (
          <p className="text-[11px] leading-relaxed text-slate-400 whitespace-pre-wrap break-words">
            {request.detail}
          </p>
        )}

        <div className="flex justify-end gap-2">
          {!notice && (
            <button
              type="button"
              onClick={() => settleConfirm(false)}
              className="px-3 py-1.5 rounded text-xs text-slate-400 hover:text-slate-200"
            >
              {request.cancelLabel ?? t('common.cancel')}
            </button>
          )}
          <button
            type="button"
            onClick={() => settleConfirm(true)}
            className="px-3 py-1.5 rounded text-xs font-medium text-slate-950 transition-opacity hover:opacity-90"
            style={{ backgroundColor: danger ? theme.accentError : theme.accentPrimary }}
          >
            {request.confirmLabel ?? t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
