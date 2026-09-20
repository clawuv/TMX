import { ipcMain, net } from 'electron'
import { mt } from './i18n'

// Outbound HTTP for the Test drawer: spec fetching, OpenAI-compatible LLM chat
// and the actual API-test requests. Electron's net.fetch runs in the main
// process — no CORS, no extra dependencies.

const fetch = net.fetch.bind(net)

const MAX_BODY_SNIPPET = 4 * 1024
const MAX_SPEC_BYTES = 10 * 1024 * 1024

function withTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return { signal: controller.signal, cancel: () => clearTimeout(timer) }
}

async function readBodySnippet(response: Response): Promise<{ body: string; contentType: string }> {
  const contentType = response.headers.get('content-type') ?? ''
  try {
    const raw = await response.text()
    return { body: raw.slice(0, MAX_BODY_SNIPPET), contentType }
  } catch {
    return { body: '', contentType }
  }
}

async function readSpec(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length') ?? 0)
  if (declaredLength > MAX_SPEC_BYTES) throw new Error(mt('fetchTooLarge'))
  const text = await response.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_SPEC_BYTES) throw new Error(mt('fetchTooLarge'))
  return text
}

export function registerApiTestIpc() {
  // Fetch a remote Swagger/OpenAPI document (avoids renderer CORS restrictions).
  ipcMain.handle('apitest:fetch-spec', async (_event, url: string) => {
    const { signal, cancel } = withTimeout(30_000)
    try {
      const response = await fetch(url, { signal, redirect: 'follow' })
      if (!response.ok) {
        throw new Error(mt('fetchHttpFailed', { status: response.status, statusText: response.statusText }))
      }
      const text = await readSpec(response)
      if (!text.trim()) throw new Error(mt('fetchEmpty'))
      return { text }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw new Error(mt('fetchTimeout'))
      throw new Error(err instanceof Error ? err.message : String(err))
    } finally {
      cancel()
    }
  })

  // One-shot non-streaming chat completion against an OpenAI-compatible endpoint.
  ipcMain.handle(
    'apitest:llm',
    async (
      _event,
      payload: { baseUrl: string; apiKey: string; model: string; system: string; user: string; temperature?: number },
    ) => {
      const base = (payload.baseUrl || '').replace(/\/+$/, '')
      if (!base) throw new Error(mt('aiNoBase'))
      if (!payload.apiKey) throw new Error(mt('aiNoKey'))
      const url = /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`
      const { signal, cancel } = withTimeout(120_000)
      try {
        const response = await fetch(url, {
          method: 'POST',
          signal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${payload.apiKey}`,
          },
          body: JSON.stringify({
            model: payload.model,
            temperature: payload.temperature ?? 0.2,
            messages: [
              { role: 'system', content: payload.system },
              { role: 'user', content: payload.user },
            ],
          }),
        })
        const text = await response.text()
        if (!response.ok) {
          const detail = text.slice(0, 300)
          if (response.status === 401) throw new Error(mt('aiAuthFailed'))
          if (response.status === 404) throw new Error(mt('aiNotFound', { url }))
          throw new Error(mt('aiRequestFailed', { status: response.status, detail }))
        }
        let parsed: { choices?: { message?: { content?: string } }[] }
        try {
          parsed = JSON.parse(text)
        } catch {
          throw new Error(mt('aiNotJson', { text: text.slice(0, 200) }))
        }
        const content = parsed.choices?.[0]?.message?.content
        if (!content) throw new Error(mt('aiEmpty'))
        return { content }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') throw new Error(mt('aiTimeout'))
        throw err instanceof Error ? err : new Error(String(err))
      } finally {
        cancel()
      }
    },
  )

  // Execute a single API-test request and capture status/timing/body snippet.
  ipcMain.handle(
    'apitest:http',
    async (_event, payload: { method: string; url: string; headers?: Record<string, string>; body?: unknown; timeout_ms?: number }) => {
      const timeoutMs = Math.min(Math.max(payload.timeout_ms ?? 15_000, 1_000), 60_000)
      const started = Date.now()
      const { signal, cancel } = withTimeout(timeoutMs)
      try {
        const init: RequestInit = {
          method: payload.method || 'GET',
          signal,
          redirect: 'manual',
          headers: payload.headers ?? {},
        }
        if (payload.body !== undefined && payload.body !== null && !['GET', 'HEAD'].includes(init.method as string)) {
          init.body = typeof payload.body === 'string' ? payload.body : JSON.stringify(payload.body)
          if (!payload.headers || !Object.keys(payload.headers).some((h) => h.toLowerCase() === 'content-type')) {
            ;(init.headers as Record<string, string>)['Content-Type'] = 'application/json'
          }
        }
        const response = await fetch(payload.url, init)
        const timeMs = Date.now() - started
        const { body, contentType } = await readBodySnippet(response)
        return {
          status: response.status,
          statusText: response.statusText,
          timeMs,
          contentType,
          body,
        }
      } catch (err) {
        const message =
          err instanceof Error && err.name === 'AbortError'
            ? mt('execTimeout', { ms: timeoutMs })
            : err instanceof Error
              ? err.message
              : String(err)
        // Network-level failure: status 0 lets the renderer mark it as an error row.
        return { status: 0, statusText: '', timeMs: Date.now() - started, contentType: '', body: '', error: message }
      } finally {
        cancel()
      }
    },
  )
}

// Imported at top; alias bound once above.
