// ZMODEM (rz/sz) integration for a live terminal session.
//
// All pty output flows through the Sentry: while no transfer is running it
// passes bytes straight to xterm; once a ZMODEM header is detected the bytes
// are routed into the protocol session instead. Protocol frames we produce go
// back to the pty as Uint8Array (binary-safe IPC), never as utf8 strings.
import Zmodem from 'zmodem.js'

export interface ZmodemTransfer {
  id: string
  name: string
  size: number
  loaded: number
  status: 'active' | 'done' | 'error' | 'cancelled'
  error?: string
}

export interface ZmodemCallbacks {
  /** Render progress for a (changing) transfer. */
  onTransfer: (transfer: ZmodemTransfer) => void
  /** Transient message (completion / errors). */
  onToast: (message: string, kind: 'ok' | 'err') => void
  /** Translator for user-facing transfer messages. */
  tr: (key: string, params?: Record<string, string | number>) => string
}

// zmodem.js has no type declarations; the surface we use is tiny.
type AnyZmodem = typeof Zmodem & any

let nextTransferId = 1

/** Some transfer chains leave shell-quoting artifacts around file names
 *  ('name' or "name"); strip only the wrapping quotes, keep inner ones. */
function stripWrappingQuotes(name: string): string {
  return name.replace(/^['"]+/, '').replace(/['"]+$/, '')
}

export class TerminalZmodem {
  private sentry: any
  private session: any = null
  private downloadDirPromise: Promise<string> | null = null

  constructor(
    private sessionId: string,
    private sendToPty: (bytes: Uint8Array) => void,
    private writeToTerm: (bytes: Uint8Array) => void,
    private callbacks: ZmodemCallbacks,
  ) {
    const Z = Zmodem as AnyZmodem
    this.sentry = new Z.Sentry({
      to_terminal: (octets: number[]) => {
        this.writeToTerm(new Uint8Array(octets))
      },
      on_detect: (detection: any) => {
        void this.handleDetect(detection)
      },
      on_retract: () => {
        // False-positive ZMODEM header — bytes already went to the terminal.
      },
      sender: (octets: number[]) => {
        this.sendToPty(new Uint8Array(octets))
      },
    })
  }

  /** Feed one chunk of pty output; routes terminal vs protocol bytes. */
  consume(bytes: Uint8Array): void {
    this.sentry.consume(bytes)
  }

  /** True while a transfer owns this session's byte stream. */
  get active(): boolean {
    return !!this.session
  }

  /** User-invoked abort from the progress overlay. */
  abort(): void {
    if (!this.session) return
    try {
      this.session.abort()
    } catch {
      // session may already be tearing down
    }
  }

  private notifyActive(active: boolean): void {
    window.ipcRenderer.send('terminal:zmodem-active', { id: this.sessionId, active })
  }

  private downloadDir(): Promise<string> {
    if (!this.downloadDirPromise) {
      this.downloadDirPromise = window.ipcRenderer
        .invoke('zmodem:default-download-dir')
        .catch(() => '')
    }
    return this.downloadDirPromise
  }

  private async handleDetect(detection: any): Promise<void> {
    let zsession: any
    try {
      zsession = detection.confirm()
    } catch {
      return // detection was retracted between detect and confirm
    }
    this.session = zsession
    this.notifyActive(true)

    try {
      if (zsession.type === 'receive') {
        await this.runReceive(zsession)
      } else {
        await this.runSend(zsession)
      }
    } catch (err) {
      this.callbacks.onToast(this.callbacks.tr('terminal.zmodemTransferFailed', { error: err instanceof Error ? err.message : String(err) }), 'err')
    } finally {
      this.session = null
      this.notifyActive(false)
    }
  }

  /** Remote ran `sz …` — receive offered files into the downloads dir. */
  private async runReceive(zsession: any): Promise<void> {
    zsession.on('offer', (xfer: any) => {
      const details = xfer.get_details()
      void (async () => {
        const cleanName = stripWrappingQuotes(details.name || '') || 'zmodem-file'
        const transfer: ZmodemTransfer = {
          id: `zm-${nextTransferId++}`,
          name: cleanName,
          size: details.size ?? 0,
          loaded: 0,
          status: 'active',
        }
        this.callbacks.onTransfer({ ...transfer })

        const dir = await this.downloadDir()
        const begin = (await window.ipcRenderer.invoke(
          'zmodem:begin-write',
          `${dir}/${cleanName}`,
        )) as { handle: number; path: string }

        let handle = begin.handle
        try {
          await xfer.accept({
            on_input: (payload: Uint8Array) => {
              transfer.loaded += payload.length
              void window.ipcRenderer.invoke('zmodem:write-chunk', handle, payload).catch(() => {})
              this.callbacks.onTransfer({ ...transfer })
            },
          })
          await window.ipcRenderer.invoke('zmodem:end-write', handle, false)
          transfer.status = 'done'
          this.callbacks.onTransfer({ ...transfer })
          this.callbacks.onToast(this.callbacks.tr('terminal.zmodemReceived', { path: begin.path }), 'ok')
        } catch (err) {
          await window.ipcRenderer.invoke('zmodem:end-write', handle, true).catch(() => {})
          transfer.status = 'error'
          transfer.error = err instanceof Error ? err.message : String(err)
          this.callbacks.onTransfer({ ...transfer })
          throw err
        }
      })()
    })
    await zsession.start()
  }

  /** Remote ran `rz` — pick one local file and stream it to the peer. */
  private async runSend(zsession: any): Promise<void> {
    const filePath = (await window.ipcRenderer.invoke('zmodem:pick-send-file')) as string | null
    if (!filePath) {
      zsession.abort()
      throw new Error(this.callbacks.tr('terminal.zmodemSendCancelled'))
    }

    const { size } = (await window.ipcRenderer.invoke('zmodem:read-file-meta', filePath)) as { size: number }
    const name = stripWrappingQuotes(filePath.split('/').pop() || 'file')
    const transfer: ZmodemTransfer = {
      id: `zm-${nextTransferId++}`,
      name,
      size,
      loaded: 0,
      status: 'active',
    }
    this.callbacks.onTransfer({ ...transfer })

    const xfer = await zsession.send_offer({
      name,
      size,
      mtime: new Date(),
      files_remaining: 1,
      bytes_remaining: size,
    })

    const CHUNK = 32 * 1024
    let offset = 0
    while (offset < size) {
      const chunk = (await window.ipcRenderer.invoke(
        'zmodem:read-file-chunk',
        filePath,
        offset,
        CHUNK,
      )) as Uint8Array
      if (!chunk || chunk.length === 0) break
      xfer.send(chunk)
      offset += chunk.length
      transfer.loaded = offset
      this.callbacks.onTransfer({ ...transfer })
    }
    await xfer.end(new Uint8Array(0))
    await zsession.close()
    transfer.status = 'done'
    this.callbacks.onTransfer({ ...transfer })
    this.callbacks.onToast(this.callbacks.tr('terminal.zmodemSent', { name }), 'ok')
  }
}
