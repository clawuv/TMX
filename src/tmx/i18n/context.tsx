import React, { createContext, useContext, useEffect, useMemo } from 'react'
import zhCN from './zh-CN'
import enUS from './en-US'

export type Lang = 'zh-CN' | 'en-US'

const DICTS = { 'zh-CN': zhCN, 'en-US': enUS } as const

/** Resolve the system language (used when the user has not chosen one). */
export function systemLang(): Lang {
  if (typeof navigator === 'undefined') return 'zh-CN'
  // In Electron the main process hands us the real OS locale; the browser
  // fallback uses navigator.language.
  const locale =
    (typeof window !== 'undefined' && window.ipcRenderer?.getLocale?.()) || navigator.language || ''
  return locale.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
}

export function resolveLang(pref: string | undefined | null): Lang {
  if (pref === 'zh-CN' || pref === 'en-US') return pref
  return systemLang()
}

type TranslateFn = (key: string, params?: Record<string, string | number>) => string

function lookup(dict: any, key: string): string | undefined {
  const value = key.split('.').reduce<any>((acc, part) => (acc == null ? undefined : acc[part]), dict)
  return typeof value === 'string' ? value : undefined
}

function makeT(lang: Lang): TranslateFn {
  const dict = DICTS[lang]
  const fallback = DICTS['zh-CN']
  return (key, params) => {
    let text = lookup(dict, key) ?? lookup(fallback, key) ?? key
    if (params) {
      for (const [name, value] of Object.entries(params)) {
        text = text.replaceAll(`{${name}}`, String(value))
      }
    }
    return text
  }
}

interface I18nContextValue {
  lang: Lang
  t: TranslateFn
}

const I18nContext = createContext<I18nContextValue>({ lang: 'zh-CN', t: makeT('zh-CN') })

interface I18nProviderProps {
  /** The user-selected language preference (raw, may be unset). */
  languagePref: string | undefined | null
  children: React.ReactNode
}

export const I18nProvider: React.FC<I18nProviderProps> = ({ languagePref, children }) => {
  const lang = useMemo(() => resolveLang(languagePref), [languagePref])
  const value = useMemo(() => ({ lang, t: makeT(lang) }), [lang])

  useEffect(() => {
    document.documentElement.lang = lang
    // The window title is owned by the active connection (see App.tsx), so we
    // only set the document language here.
  }, [lang])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

/** Access the active language and translator inside the provider. */
export function useI18n(): I18nContextValue {
  return useContext(I18nContext)
}

/** Convenience hook returning just the translate function. */
export function useT(): TranslateFn {
  return useContext(I18nContext).t
}
