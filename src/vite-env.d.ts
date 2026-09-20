/// <reference types="vite/client" />

/** App version injected by vite `define` (from package.json). */
declare const __APP_VERSION__: string

// Shape exposed by `electron/preload/index.ts`
interface NovelIpcRenderer {
  /** Drag-dropped / picked File → absolute path on disk (Electron webUtils). */
  getPathForFile: (file: File) => string
  /** OS locale provided by the main process (empty string outside Electron). */
  getLocale: () => string
  /** Listen to a main-process channel; returns an unsubscribe function. Payload args come without the event. */
  on: (channel: string, listener: (...args: any[]) => void) => () => void
  off: (channel: string, listener: (...args: any[]) => void) => void
  send: (channel: string, ...args: any[]) => void
  invoke: (channel: string, ...args: any[]) => Promise<any>
}

interface Window {
  // expose in the `electron/preload/index.ts`
  ipcRenderer: NovelIpcRenderer
}

declare module 'zmodem.js' {
  const Zmodem: any
  export default Zmodem
}
