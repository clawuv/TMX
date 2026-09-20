import { BrowserWindow, Menu, ipcMain } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'

// Renderer-driven native context menus. Components describe their menu (labels +
// action ids) and the main process pops a real OS menu at the cursor; clicks are
// routed back by id. This replaces the previous one-size-fits-all copy/paste
// menu that appeared even when right-clicking a tab, host row or file row.

export interface ContextMenuItem {
  id?: string
  label?: string
  type?: 'normal' | 'separator'
  /** Native menu role (cut/copy/paste/selectAll/…) — handled by Electron. */
  role?: string
  enabled?: boolean
  checked?: boolean
}

function buildTemplate(items: ContextMenuItem[], onPick: (item: ContextMenuItem) => void): MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = []
  for (const item of items) {
    if (item.type === 'separator') {
      // Never lead/trail with a separator or double them up.
      if (template.length === 0) continue
      if (template[template.length - 1].type === 'separator') continue
      template.push({ type: 'separator' })
      continue
    }
    if (!item.id && !item.role) continue
    if (item.role) {
      template.push({ role: item.role as MenuItemConstructorOptions['role'], label: item.label, enabled: item.enabled !== false })
      continue
    }
    template.push({
      label: item.label,
      enabled: item.enabled !== false,
      ...(item.checked !== undefined ? { type: 'checkbox' as const, checked: item.checked } : {}),
      click: () => onPick(item),
    })
  }
  while (template.length && template[template.length - 1].type === 'separator') template.pop()
  return template
}

export function registerContextMenuIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('context-menu:show', async (event, payload: { items?: ContextMenuItem[] }) => {
    const items = Array.isArray(payload?.items) ? payload.items : []
    const win = BrowserWindow.fromWebContents(event.sender) ?? getWindow() ?? undefined
    if (!win) return { shown: false }

    const template = buildTemplate(items, (item) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('context-menu:action', { id: item.id, checked: item.checked })
      }
    })
    if (template.length === 0) return { shown: false }

    return await new Promise<{ shown: boolean }>((resolve) => {
      const menu = Menu.buildFromTemplate(template)
      menu.popup({ window: win, callback: () => resolve({ shown: true }) })
    })
  })
}
