import { EventEmitter } from 'node:events'
import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>() }))
vi.mock('electron', () => ({
  app: { isPackaged: true, getVersion: () => '0.9.0', getPath: () => '/Applications/TMX.app/Contents/MacOS/TMX' },
  ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => mocks.handlers.set(name, handler) },
}))
vi.mock('electron-updater', async () => {
  const { EventEmitter } = await import('node:events')
  return { default: {
    autoUpdater: Object.assign(new EventEmitter(), {
      downloadUpdate: vi.fn(() => Promise.resolve([])),
      quitAndInstall: vi.fn(),
    }),
    CancellationToken: class { cancel() {} },
  } }
})
import updater from 'electron-updater'
import { update } from '../electron/main/update'
const engine = updater.autoUpdater as unknown as EventEmitter & {
  downloadUpdate: ReturnType<typeof vi.fn>
  quitAndInstall: ReturnType<typeof vi.fn>
}
let send: ReturnType<typeof vi.fn>
beforeEach(() => {
  send = vi.fn()
  update({ isDestroyed: () => false, webContents: { send, isDestroyed: () => false } } as any)
})
it('reports asynchronous staging/signature errors after download completes', () => {
  mocks.handlers.get('start-download')!({ sender: { send } })
  engine.emit('update-downloaded', {})
  expect(send).toHaveBeenCalledWith('update-downloaded')
  engine.emit('error', new Error('Code signature validation failed'))
  expect(send).toHaveBeenCalledWith('update-error', { message: 'Code signature validation failed' })
})
it('reports an install error emitted after the IPC handler returns', () => {
  mocks.handlers.get('quit-and-install')!()
  engine.emit('error', new Error('Installation failed'))
  expect(send).toHaveBeenCalledWith('update-error', { message: 'Installation failed' })
})
it('handles a download rejection without an error event', async () => {
  engine.downloadUpdate.mockRejectedValueOnce(new Error('No update selected'))
  mocks.handlers.get('start-download')!({ sender: { send } })
  await Promise.resolve()
  expect(send).toHaveBeenCalledWith('update-error', { message: 'No update selected' })
})
