import { useEffect } from 'react'
import { useT } from '../i18n/context'
import { isElectron, showContextMenu, type MenuItemSpec } from './desktop'

// Global fallback menu for plain DOM content: editable fields get the native
// cut/copy/paste roles, and a right-click landing inside the current text selection
// gets Copy. Components with richer semantics (tabs, host rows, SFTP entries, the
// terminal) stop propagation and open their own menu instead.
export function useNativeContextMenu(): void {
  const t = useT()

  useEffect(() => {
    if (!isElectron()) return

    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      const editable = target.closest('input, textarea, [contenteditable="true"]')

      let items: MenuItemSpec[] = []
      if (editable) {
        items = [
          { role: 'cut', label: t('common.cut') },
          { role: 'copy', label: t('common.copy') },
          { role: 'paste', label: t('common.paste') },
          { type: 'separator' },
          { role: 'selectAll', label: t('common.selectAll') },
        ]
      } else if (isPointInsideSelection(e.clientX, e.clientY)) {
        // Only when the click is actually on the selected text. Keying off
        // "something is selected" alone made a stray Copy menu pop up over blank
        // chrome (e.g. an empty area of a left drawer) after selecting in a terminal.
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

/** True when the point falls inside the bounding box of the current selection. */
function isPointInsideSelection(x: number, y: number): boolean {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false
  const rect = selection.getRangeAt(0).getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return false
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}
