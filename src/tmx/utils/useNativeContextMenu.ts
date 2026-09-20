import { useEffect } from 'react'
import { useT } from '../i18n/context'
import { isElectron, showContextMenu, type MenuItemSpec } from './desktop'

// Global fallback menu for plain DOM content: editable fields get the native
// cut/copy/paste roles, a text selection gets Copy. Components with richer
// semantics (tabs, host rows, SFTP entries, the terminal) stop propagation and
// open their own menu instead.
export function useNativeContextMenu(): void {
  const t = useT()

  useEffect(() => {
    if (!isElectron()) return

    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      const editable = target.closest('input, textarea, [contenteditable="true"]')
      const selection = window.getSelection()?.toString() ?? ''

      let items: MenuItemSpec[] = []
      if (editable) {
        items = [
          { role: 'cut', label: t('common.cut') },
          { role: 'copy', label: t('common.copy') },
          { role: 'paste', label: t('common.paste') },
          { type: 'separator' },
          { role: 'selectAll', label: t('common.selectAll') },
        ]
      } else if (selection) {
        items = [{ role: 'copy', label: t('common.copy') }]
      }

      if (items.length === 0) return
      e.preventDefault()
      showContextMenu(items)
    }

    document.addEventListener('contextmenu', handler)
    return () => document.removeEventListener('contextmenu', handler)
  }, [t])
}
