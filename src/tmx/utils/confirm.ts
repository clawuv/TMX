// Imperative confirm/notice controller. The app's native OS message box reads as a
// web-page dialog in a desktop shell, so confirmations are drawn in-app instead.
// Kept free of React so any module can await a confirmation the same way it used
// to await `nativeConfirm`.

export interface ConfirmRequest {
  title?: string
  message: string
  detail?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  /** 'notice' renders a single acknowledge button instead of confirm/cancel. */
  kind?: 'confirm' | 'notice'
}

type Listener = (request: ConfirmRequest | null) => void

interface Pending {
  request: ConfirmRequest
  resolve: (ok: boolean) => void
}

let pending: Pending | null = null
const listeners = new Set<Listener>()

function emit(): void {
  for (const listener of listeners) listener(pending?.request ?? null)
}

export function subscribeConfirm(listener: Listener): () => void {
  listeners.add(listener)
  listener(pending?.request ?? null)
  return () => {
    listeners.delete(listener)
  }
}

/** True once a dialog host is mounted; callers fall back to the OS dialog otherwise. */
export function hasConfirmHost(): boolean {
  return listeners.size > 0
}

/** Answer the open dialog. No-op when nothing is pending. */
export function settleConfirm(ok: boolean): void {
  const current = pending
  if (!current) return
  pending = null
  emit()
  current.resolve(ok)
}

export function requestConfirm(request: ConfirmRequest): Promise<boolean> {
  // Only one dialog can be on screen; an unanswered earlier one resolves as cancelled.
  if (pending) settleConfirm(false)
  return new Promise<boolean>((resolve) => {
    pending = { request, resolve }
    emit()
  })
}
