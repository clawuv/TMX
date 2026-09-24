import React, { useMemo, useRef, useState } from 'react';
import { load as loadYaml } from 'js-yaml';
import {
  Link,
  ClipboardPaste,
  Sparkles,
  Play,
  Trash2,
  Loader2,
  FileText,
  Pin,
  Plus,
  X,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import type { ThemeConfig, UserPreferences } from '../types';
import { useT } from '../i18n/context';

// Module-level translator reference so parse helpers can emit localized errors.
let tr: (key: string, params?: Record<string, string | number>) => string = (k) => k

const IN_ELECTRON =
  typeof window !== 'undefined' && typeof window.ipcRenderer !== 'undefined';

const MAX_CONCURRENT = 4;

interface ApiEndpoint {
  id: string;
  method: string;
  path: string;
  tag: string;
  summary: string;
  /** Raw OpenAPI operation object, trimmed — fed to the LLM as context. */
  op: Record<string, unknown>;
}

interface TestCase {
  id: string;
  endpointId: string;
  name: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  query: Record<string, unknown>;
  body?: unknown;
  expectStatus: number;
  /** Manually added via the + button; method/path editable inline. */
  custom?: boolean;
}

interface TestResult {
  caseId: string;
  name: string;
  method: string;
  path: string;
  status: number;
  timeMs: number;
  pass: boolean;
  networkError?: string;
  bodySnippet: string;
}

const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'];

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10',
  POST: 'text-sky-400 border-sky-500/40 bg-sky-500/10',
  PUT: 'text-amber-400 border-amber-500/40 bg-amber-500/10',
  DELETE: 'text-rose-400 border-rose-500/40 bg-rose-500/10',
  PATCH: 'text-purple-400 border-purple-500/40 bg-purple-500/10',
};

/** Parse an OpenAPI 3.x / Swagger 2.0 document into a flat endpoint list. */
function parseSpec(text: string): { endpoints: ApiEndpoint[]; baseUrl: string; title: string } {
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(text);
  } catch {
    try {
      doc = loadYaml(text) as Record<string, unknown>;
    } catch {
      throw new Error(tr('test.badDoc'));
    }
  }
  if (!doc || typeof doc !== 'object') throw new Error(tr('test.badStructure'));

  let baseUrl = '';
  const servers = doc.servers as { url?: string }[] | undefined;
  if (Array.isArray(servers) && servers[0]?.url) {
    baseUrl = String(servers[0].url);
  } else if (typeof doc.host === 'string') {
    const scheme = Array.isArray(doc.schemes) && doc.schemes.length ? String(doc.schemes[0]) : 'http';
    baseUrl = `${scheme}://${doc.host}${typeof doc.basePath === 'string' ? doc.basePath : ''}`;
  }

  const endpoints: ApiEndpoint[] = [];
  const paths = (doc.paths ?? {}) as Record<string, Record<string, Record<string, unknown>>>;
  for (const [p, methods] of Object.entries(paths)) {
    if (!methods || typeof methods !== 'object') continue;
    for (const [m, op] of Object.entries(methods)) {
      if (!HTTP_METHODS.includes(m) || !op || typeof op !== 'object') continue;
      const o = op as Record<string, unknown>;
      endpoints.push({
        id: `${m}:${p}`,
        method: m.toUpperCase(),
        path: p,
        tag: Array.isArray(o.tags) && o.tags.length ? String(o.tags[0]) : 'default',
        summary: typeof o.summary === 'string' ? o.summary : typeof o.description === 'string' ? o.description.slice(0, 60) : '',
        op: o,
      });
    }
  }
  if (endpoints.length === 0) throw new Error(tr('test.noEndpoints'));
  const info = doc.info as { title?: string } | undefined;
  return { endpoints, baseUrl, title: info?.title ?? 'API' };
}

/** Trim an operation object down to what the LLM needs (keeps prompt small). */
function compactOp(op: Record<string, unknown>): Record<string, unknown> {
  const params = Array.isArray(op.parameters)
    ? (op.parameters as Record<string, unknown>[]).map((p) => ({
        name: p.name,
        in: p.in,
        type: (p.schema as Record<string, unknown>)?.type ?? p.type,
        required: p.required ?? false,
        ...(p.example !== undefined ? { example: p.example } : {}),
        ...((p.schema as Record<string, unknown>)?.enum ? { enum: (p.schema as Record<string, unknown>).enum } : {}),
      }))
    : undefined;
  let body: unknown;
  const rb = op.requestBody as Record<string, unknown> | undefined;
  const content3 = rb?.content as Record<string, Record<string, unknown>> | undefined;
  const schema3 = content3?.['application/json']?.schema;
  if (schema3) body = schema3;
  if (op.consumes && Array.isArray(op.parameters)) {
    const bodyParam = (op.parameters as Record<string, unknown>[]).find((p) => p.in === 'body');
    if (bodyParam) body = bodyParam.schema ?? bodyParam;
  }
  return {
    ...(params ? { parameters: params } : {}),
    ...(body ? { requestBodySchema: body } : {}),
    ...(op.security ? { requiresAuth: true } : {}),
  };
}

/** Generate a naive JSON value from a schema node (depth-limited). */
function sampleFromSchema(schema: unknown, depth = 0): unknown {
  if (!schema || typeof schema !== 'object' || depth > 4) return null;
  const s = schema as Record<string, unknown>;
  if (s.example !== undefined) return s.example;
  if (s.default !== undefined) return s.default;
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];
  switch (s.type) {
    case 'integer':
    case 'number':
      return 1;
    case 'boolean':
      return true;
    case 'string':
      return s.format === 'date-time' ? new Date().toISOString() : 'test';
    case 'array':
      return [sampleFromSchema(s.items, depth + 1)];
    case 'object': {
      const out: Record<string, unknown> = {};
      const props = (s.properties ?? {}) as Record<string, unknown>;
      for (const [k, v] of Object.entries(props)) out[k] = sampleFromSchema(v, depth + 1);
      return out;
    }
    default: {
      // schema-less object: iterate properties if present
      const props = s.properties as Record<string, unknown> | undefined;
      if (props) {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(props)) out[k] = sampleFromSchema(v, depth + 1);
        return out;
      }
      return null;
    }
  }
}

function fillPathParams(path: string, op: Record<string, unknown>): string {
  const params = Array.isArray(op.parameters) ? (op.parameters as Record<string, unknown>[]) : [];
  return path.replace(/\{([^}]+)\}/g, (raw, name: string) => {
    const p = params.find((x) => x?.name === name);
    if (p?.example !== undefined) return String(p.example);
    const schema = p?.schema as Record<string, unknown> | undefined;
    if (schema?.example !== undefined) return String(schema.example);
    if (Array.isArray(schema?.enum) && schema.enum.length) return String(schema.enum[0]);
    if (schema?.type === 'integer' || schema?.type === 'number') return '1';
    return raw;
  });
}

function fallbackCase(e: ApiEndpoint, seq: number): TestCase {
  const path = fillPathParams(e.path, e.op);
  const query: Record<string, unknown> = {};
  for (const p of (Array.isArray(e.op.parameters) ? e.op.parameters : []) as Record<string, unknown>[]) {
    if (p.in === 'query' && p.required) {
      query[String(p.name)] =
        p.example !== undefined
          ? p.example
          : (p.schema as Record<string, unknown>)?.example !== undefined
            ? (p.schema as Record<string, unknown>).example
            : 'test';
    }
  }
  let body: unknown;
  const content = (e.op.requestBody as Record<string, unknown> | undefined)?.content as
    | Record<string, Record<string, unknown>>
    | undefined;
  const schema = content?.['application/json']?.schema;
  if (schema) body = sampleFromSchema(schema);
  if (!body && Array.isArray(e.op.parameters)) {
    const bodyParam = (e.op.parameters as Record<string, unknown>[]).find((p) => p.in === 'body');
    if (bodyParam?.schema) body = sampleFromSchema(bodyParam.schema);
  }
  return {
    id: `tc-${seq}`,
    endpointId: e.id,
    name: `${e.method} ${e.path}`,
    method: e.method,
    path,
    headers: {},
    query,
    body,
    expectStatus: 200,
  };
}

function buildQuery(url: string, query: Record<string, unknown>): string {
  const entries = Object.entries(query ?? {});
  if (!entries.length) return url;
  const qs = entries
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  if (!qs) return url;
  return url.includes('?') ? `${url}&${qs}` : `${url}?${qs}`;
}

function extractJsonArray(text: string): unknown[] {
  let t = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) throw new Error(tr('test.noJsonInAi'));
  return JSON.parse(text.slice(start, end + 1)) as unknown[];
}

interface TestDrawerProps {
  theme: ThemeConfig;
  preferences: UserPreferences;
  mode?: 'docked' | 'full';
  onCloseDock?: () => void;
  pinned?: boolean;
  onTogglePin?: () => void;
  className?: string;
}

export const TestDrawer: React.FC<TestDrawerProps> = ({
  theme,
  preferences,
  onCloseDock,
  pinned,
  onTogglePin,
  className,
}) => {
  const t = useT()
  tr = t
  // ── Import ──
  const [specUrl, setSpecUrl] = useState('');
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [specTitle, setSpecTitle] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [endpoints, setEndpoints] = useState<ApiEndpoint[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  // ── Cases & runs ──
  const [cases, setCases] = useState<TestCase[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<TestResult[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [report, setReport] = useState('');
  const [reportBusy, setReportBusy] = useState(false);
  const [toast, setToast] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(null);
  const toastTimer = useRef<number | null>(null);

  const showToast = (msg: string, kind: 'ok' | 'err' = 'ok') => {
    setToast({ msg, kind });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3000);
  };

  const aiReady = Boolean(preferences.aiBaseUrl && preferences.aiApiKey && preferences.aiApiModel);

  const applySpec = (text: string) => {
    try {
      const parsed = parseSpec(text);
      setSpecTitle(parsed.title);
      setBaseUrl(parsed.baseUrl);
      setEndpoints(parsed.endpoints);
      setSelected(new Set(parsed.endpoints.map((e) => e.id)));
      setCases([]);
      setResults([]);
      setReport('');
      setImportError(null);
      showToast(t('test.importOk', { title: parsed.title, count: parsed.endpoints.length }));
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleFetchSpec = async () => {
    if (!specUrl.trim()) return;
    setImporting(true);
    setImportError(null);
    try {
      const result = (await window.ipcRenderer.invoke('apitest:fetch-spec', specUrl.trim())) as {
        text: string;
      };
      applySpec(result.text);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  // ── Endpoint filtering / grouping ──
  const filtered = useMemo(
    () =>
      endpoints.filter(
        (e) =>
          e.path.toLowerCase().includes(search.toLowerCase()) ||
          e.summary.toLowerCase().includes(search.toLowerCase()) ||
          e.tag.toLowerCase().includes(search.toLowerCase()),
      ),
    [endpoints, search],
  );
  const grouped = useMemo(() => {
    const map = new Map<string, ApiEndpoint[]>();
    for (const e of filtered) {
      const list = map.get(e.tag) ?? [];
      list.push(e);
      map.set(e.tag, list);
    }
    return [...map.entries()];
  }, [filtered]);

  const toggleEndpoint = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── Manual custom case (header + button) ──
  const addCustomCase = () => {
    setCases((prev) => [
      ...prev,
      {
        id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        endpointId: 'custom',
        name: '自定义用例',
        method: 'GET',
        path: '/',
        headers: {},
        query: {},
        expectStatus: 200,
        custom: true,
      },
    ]);
    setResults((prev) => prev);
  };

  // ── Case generation ──
  const buildCasesFromAi = async () => {
    const chosen = endpoints.filter((e) => selected.has(e.id));
    if (!chosen.length) {
      showToast(t('test.selectFirst'), 'err');
      return;
    }
    if (!aiReady) {
      showToast(t('test.aiNotConfigured'), 'err');
      return;
    }
    setAiBusy(true);
    try {
      const compact = chosen.map((e) => ({
        endpoint: `${e.method} ${e.path}`,
        summary: e.summary,
        spec: compactOp(e.op),
      }));
      const result = (await window.ipcRenderer.invoke('apitest:llm', {
        baseUrl: preferences.aiBaseUrl,
        apiKey: preferences.aiApiKey,
        model: preferences.aiApiModel,
        system:
          '你是资深 API 测试工程师。只输出严格的 JSON 数组，不要任何解释、注释或 Markdown 代码块围栏。',
        user: [
          `以下是 OpenAPI 接口定义（已精简），Base URL: ${baseUrl || '(未提供，path 保持原样)'}`,
          JSON.stringify(compact),
          '请为每个接口生成恰好 2 条测试用例：1 条正常请求、1 条异常边界（缺必填参数、非法值或错误类型）。',
          '输出 JSON 数组，每个元素的字段：',
          '{ "endpoint": "METHOD /path（对应输入里的接口）", "name": "用例名(简短中文)", "method": "HTTP方法", "path": "完整可请求路径(花括号参数用合理默认值填充, 不含Base URL)", "headers": {}, "query": {}, "body": 对象或null, "expectStatus": 数字 }',
        ].join('\n'),
      })) as { content: string };
      const raw = extractJsonArray(result.content);
      const byEndpoint = new Map(chosen.map((e) => [`${e.method} ${e.path}`, e]));
      const generated: TestCase[] = [];
      let seq = 0;
      for (const item of raw as Record<string, unknown>[]) {
        const key = `${item.method ?? ''} ${item.endpoint ?? item.path ?? ''}`.trim();
        let endpoint = byEndpoint.get(key);
        if (!endpoint) {
          const byPath = [...byEndpoint.entries()].find(([k]) => k.endsWith(` ${item.endpoint}`) || k.includes(String(item.path ?? '\u0000')));
          endpoint = byPath?.[1];
        }
        if (!endpoint) continue;
        generated.push({
          id: `tc-${seq++}`,
          endpointId: endpoint.id,
          name: String(item.name ?? `${item.method} ${item.path}`),
          method: String(item.method ?? endpoint.method).toUpperCase(),
          path: String(item.path ?? endpoint.path),
          headers: (item.headers as Record<string, string>) ?? {},
          query: (item.query as Record<string, unknown>) ?? {},
          body: item.body ?? undefined,
          expectStatus: Number(item.expectStatus ?? 200) || 200,
        });
      }
      if (!generated.length) throw new Error(t('test.aiNoMatch'));
      setCases(generated);
      setResults([]);
      setReport('');
      showToast(t('test.aiGenerated', { count: generated.length }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(t('test.aiFailedFallback', { msg }), 'err');
      setCases(chosen.map((e, i) => fallbackCase(e, i)));
      setResults([]);
    } finally {
      setAiBusy(false);
    }
  };

  const buildFallbackCases = () => {
    const chosen = endpoints.filter((e) => selected.has(e.id));
    if (!chosen.length) {
      showToast(t('test.selectFirst'), 'err');
      return;
    }
    setCases(chosen.map((e, i) => fallbackCase(e, i)));
    setResults([]);
    setReport('');
    showToast(t('test.defaultGenerated', { count: chosen.length }));
  };

  // ── Execution ──
  const execOne = async (c: TestCase): Promise<TestResult> => {
    const url = buildQuery((baseUrl.replace(/\/+$/, '') || '') + '/' + c.path.replace(/^\/+/, ''), c.query);
    try {
      const r = (await window.ipcRenderer.invoke('apitest:http', {
        method: c.method,
        url,
        headers: c.headers,
        body: c.body,
        timeout_ms: 15_000,
      })) as { status: number; timeMs: number; body: string; error?: string };
      return {
        caseId: c.id,
        name: c.name,
        method: c.method,
        path: c.path,
        status: r.status,
        timeMs: r.timeMs,
        pass: r.status !== 0 && r.status === c.expectStatus,
        networkError: r.error,
        bodySnippet: r.body,
      };
    } catch (err) {
      return {
        caseId: c.id,
        name: c.name,
        method: c.method,
        path: c.path,
        status: 0,
        timeMs: 0,
        pass: false,
        networkError: err instanceof Error ? err.message : String(err),
        bodySnippet: '',
      };
    }
  };

  const runAllCases = async () => {
    if (!cases.length) {
      showToast(t('test.generateCasesFirst'), 'err');
      return;
    }
    if (!baseUrl.trim()) {
      showToast(t('test.fillBaseUrl'), 'err');
      return;
    }
    setRunning(true);
    setResults([]);
    setProgress({ done: 0, total: cases.length });
    const queues: TestCase[][] = Array.from({ length: MAX_CONCURRENT }, () => []);
    cases.forEach((c, i) => queues[i % MAX_CONCURRENT].push(c));
    let done = 0;
    await Promise.all(
      queues.map(async (queue) => {
        while (queue.length) {
          const c = queue.shift()!;
          const r = await execOne(c);
          setResults((prev) => [...prev, r]);
          done++;
          setProgress({ done, total: cases.length });
        }
      }),
    );
    setRunning(false);
    showToast(t('test.batchDone'));
  };

  // ── AI report ──
  const buildReport = async () => {
    if (!results.length) {
      showToast(t('test.runCasesFirst'), 'err');
      return;
    }
    if (!aiReady) {
      showToast(t('test.aiNotConfiguredShort'), 'err');
      return;
    }
    setReportBusy(true);
    try {
      const summary = results.map((r) => ({
        用例: r.name,
        期望: cases.find((c) => c.id === r.caseId)?.expectStatus,
        实际: r.status,
        耗时ms: r.timeMs,
        结论: r.networkError ? `网络错误: ${r.networkError}` : r.pass ? '通过' : '不符合预期',
        ...(r.status !== 0 && !r.pass ? { 响应摘要: r.bodySnippet.slice(0, 300) } : {}),
      }));
      const passed = results.filter((r) => r.pass).length;
      const result = (await window.ipcRenderer.invoke('apitest:llm', {
        baseUrl: preferences.aiBaseUrl,
        apiKey: preferences.aiApiKey,
        model: preferences.aiApiModel,
        system: '你是测试报告撰写者。用简洁的中文 Markdown 输出接口批量测试报告，重点分析失败用例的可能原因。',
        user: `批量测试结果（${passed}/${results.length} 通过）：\n${JSON.stringify(summary)}`,
      })) as { content: string };
      setReport(result.content);
    } catch (err) {
      showToast(t('test.reportFailed', { error: err instanceof Error ? err.message : String(err) }), 'err');
    } finally {
      setReportBusy(false);
    }
  };

  const passedCount = results.filter((r) => r.pass).length;

  return (
    <div
      className={className || 'flex flex-col h-full w-full select-none transition-colors duration-150 relative rounded-md border'}
      style={{ backgroundColor: theme.bgCanvas, borderColor: theme.borderSubtle }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between h-10 px-3 border-b shrink-0"
        style={{ backgroundColor: theme.bgCanvas, borderColor: theme.borderSubtle }}
      >
        <div className="flex items-center gap-2">
          <span className="font-semibold text-xs text-slate-200">{t('test.title')}</span>
          <span
            className={`w-1.5 h-1.5 rounded-full ${aiReady ? '' : 'opacity-50'}`}
            style={{ backgroundColor: aiReady ? theme.accentSuccess : '#64748B' }}
            title={aiReady ? t('test.aiConfigured') : t('test.aiNotConfiguredTitle')}
          />
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={addCustomCase}
            title="新建手动测试用例"
            className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-white/10 transition-colors"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {!IN_ELECTRON && (
        <div className="p-4 text-xs text-slate-400">{t('test.desktopOnly')}</div>
      )}

      {IN_ELECTRON && (
        <div className="flex-1 overflow-y-auto p-2.5 space-y-3 text-xs">
          {/* ① Import */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <div
                className="flex items-center gap-1.5 px-2 py-1 rounded border flex-1 min-w-0"
                style={{ backgroundColor: theme.bgInput, borderColor: theme.borderSubtle }}
              >
                <Link className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                <input
                  type="text"
                  value={specUrl}
                  onChange={(e) => setSpecUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void handleFetchSpec()}
                  placeholder={t('test.urlPlaceholder')}
                  className="w-full bg-transparent border-none outline-none text-[11px] font-mono text-slate-200 placeholder-slate-500"
                />
              </div>
              <button
                onClick={() => void handleFetchSpec()}
                disabled={importing || !specUrl.trim()}
                className="px-2.5 py-1 rounded text-[11px] font-medium text-slate-950 disabled:opacity-40 shrink-0 transition-opacity hover:opacity-90"
                style={{ backgroundColor: theme.accentPrimary }}
              >
                {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t('test.fetch')}
              </button>
            </div>
            <button
              onClick={() => setPasteMode((v) => !v)}
              className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
            >
              <ClipboardPaste className="w-3 h-3" />
              {pasteMode ? t('test.collapsePaste') : t('test.orPasteJson')}
            </button>
            {pasteMode && (
              <div className="space-y-1">
                <textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  rows={4}
                  placeholder={t('test.pastePlaceholder')}
                  className="w-full px-2 py-1.5 rounded bg-black/40 border border-white/10 text-[11px] font-mono text-slate-200 outline-none focus:border-sky-400 resize-none"
                />
                <button
                  onClick={() => pasteText.trim() && applySpec(pasteText)}
                  disabled={!pasteText.trim()}
                  className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 text-[11px] text-slate-200 transition-colors disabled:opacity-40"
                >
                  {t('test.parsePasted')}
                </button>
              </div>
            )}
            {importError && (
              <div className="p-2 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-[11px] break-all">
                {importError}
              </div>
            )}
            {endpoints.length > 0 && (
              <div
                className="flex items-center gap-2 px-2 py-1 rounded text-[11px] border"
                style={{ backgroundColor: theme.bgInput, borderColor: theme.borderSubtle }}
              >
                <FileText className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="text-slate-300 truncate">{specTitle}</span>
                <span className="text-slate-500 shrink-0">{t('test.endpointsCount', { count: endpoints.length })}</span>
              </div>
            )}
          </div>

          {/* Empty hint before any spec is imported */}
          {endpoints.length === 0 && (
            <div className="py-10 text-center space-y-1.5">
              <div className="text-xs text-slate-400">{t('test.empty')}</div>
              <div className="text-[11px] text-slate-500">{t('test.emptyHint')}</div>
            </div>
          )}

          {/* ② Base URL */}
          {endpoints.length > 0 && (
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-slate-300">Base URL</label>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={t('test.baseUrlPlaceholder')}
                className="w-full px-2 py-1 rounded bg-black/40 border border-white/10 text-[11px] font-mono text-slate-200 outline-none focus:border-sky-400"
              />
            </div>
          )}

          {/* ③ Endpoint list */}
          {endpoints.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-medium text-slate-300">
                  {t('test.selectedCount', { selected: selected.size, total: endpoints.length })}
                </label>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setSelected(new Set(endpoints.map((e) => e.id)))}
                    className="text-[10px] text-sky-400 hover:text-sky-300"
                  >
                    {t('test.selectAll')}
                  </button>
                  <button
                    onClick={() => setSelected(new Set())}
                    className="text-[10px] text-slate-500 hover:text-slate-300"
                  >
                    {t('test.clearAll')}
                  </button>
                </div>
              </div>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('test.filterPlaceholder')}
                className="w-full px-2 py-1 rounded bg-black/40 border border-white/10 text-[11px] text-slate-200 outline-none focus:border-sky-400"
              />
              <div className="max-h-44 overflow-y-auto space-y-1 pr-0.5">
                {grouped.map(([tag, list]) => (
                  <div key={tag} className="space-y-1">
                    <div className="text-[10px] text-slate-500 font-medium pt-0.5">{tag}</div>
                    {list.map((e) => {
                      const checked = selected.has(e.id);
                      return (
                        <div
                          key={e.id}
                          onClick={() => toggleEndpoint(e.id)}
                          className={`flex items-center gap-1.5 px-1.5 py-1 rounded-lg border cursor-pointer transition-colors ${
                            checked ? 'bg-white/5 border-white/15' : 'border-transparent hover:bg-white/5'
                          }`}
                        >
                          <span
                            className={`px-1 py-0.5 rounded text-[9px] font-mono font-bold border shrink-0 ${METHOD_COLORS[e.method] ?? 'text-slate-400 border-white/20 bg-white/5'}`}
                          >
                            {e.method}
                          </span>
                          <span className="truncate text-[11px] font-mono text-slate-300 flex-1" title={e.summary}>
                            {e.path}
                          </span>
                          {checked && <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ④ Generate cases */}
          {endpoints.length > 0 && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => void buildCasesFromAi()}
                disabled={aiBusy || selected.size === 0}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-slate-950 disabled:opacity-40 transition-opacity hover:opacity-90"
                style={{ backgroundColor: theme.accentPrimary }}
              >
                {aiBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {t('test.aiGenerate')}
              </button>
              <button
                onClick={buildFallbackCases}
                disabled={selected.size === 0}
                className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-[11px] text-slate-200 transition-colors disabled:opacity-40"
              >
                {t('test.defaultCases')}
              </button>
              {cases.length > 0 && (
                <button
                  onClick={() => { setCases([]); setResults([]); setReport(''); }}
                  className="p-1 rounded text-slate-400 hover:text-rose-400 transition-colors"
                  title={t('test.clearCases')}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {/* ⑤ Cases */}
          {cases.length > 0 && (
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-slate-300">{t('test.casesCount', { count: cases.length })}</label>
              <div className="max-h-52 overflow-y-auto space-y-1 pr-0.5">
                {cases.map((c) => (
                  <div key={c.id} className="flex items-center gap-1.5 px-1.5 py-1 rounded-lg bg-black/20 border border-white/5">
                    {c.custom ? (
                      <>
                        <select
                          value={c.method}
                          onChange={(e) =>
                            setCases((prev) =>
                              prev.map((x) => (x.id === c.id ? { ...x, method: e.target.value } : x)),
                            )
                          }
                          className="px-0.5 py-0.5 rounded bg-black/40 border border-white/10 text-[9px] font-mono font-bold text-slate-300 outline-none focus:border-sky-400 shrink-0"
                        >
                          {['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'].map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={c.path}
                          onChange={(e) =>
                            setCases((prev) =>
                              prev.map((x) => (x.id === c.id ? { ...x, path: e.target.value } : x)),
                            )
                          }
                          placeholder="/path"
                          className="flex-1 min-w-0 px-1 py-0.5 rounded bg-black/40 border border-white/10 text-[11px] font-mono text-slate-300 outline-none focus:border-sky-400"
                        />
                      </>
                    ) : (
                      <>
                        <span
                          className={`px-1 py-0.5 rounded text-[9px] font-mono font-bold border shrink-0 ${METHOD_COLORS[c.method] ?? 'text-slate-400 border-white/20 bg-white/5'}`}
                        >
                          {c.method}
                        </span>
                        <span className="truncate text-[11px] font-mono text-slate-300 flex-1" title={c.name}>
                          {c.path}
                        </span>
                      </>
                    )}
                    <span className="text-[10px] text-slate-500 shrink-0">{t('test.expect')}</span>
                    <input
                      type="number"
                      value={c.expectStatus}
                      onChange={(e) =>
                        setCases((prev) =>
                          prev.map((x) => (x.id === c.id ? { ...x, expectStatus: Number(e.target.value) || 200 } : x)),
                        )
                      }
                      className="w-12 px-1 py-0.5 rounded bg-black/40 border border-white/10 text-[10px] font-mono text-slate-300 outline-none focus:border-sky-400 shrink-0"
                    />
                    <button
                      onClick={() => setCases((prev) => prev.filter((x) => x.id !== c.id))}
                      className="p-0.5 rounded text-slate-500 hover:text-rose-400 shrink-0"
                      title={t('test.deleteCase')}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ⑥ Run */}
          {cases.length > 0 && (
            <div className="space-y-1.5">
              <button
                onClick={() => void runAllCases()}
                disabled={running}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-semibold text-slate-950 disabled:opacity-50 transition-opacity hover:opacity-90"
                style={{ backgroundColor: theme.accentSuccess }}
              >
                {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                {running ? t('test.running', { done: progress.done, total: progress.total }) : t('test.batchRun', { count: cases.length })}
              </button>
              {running && (
                <div className="h-1 rounded bg-black/40 overflow-hidden">
                  <div
                    className="h-full transition-all"
                    style={{
                      width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
                      backgroundColor: theme.accentPrimary,
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {/* ⑦ Results */}
          {results.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-medium text-slate-300">
                  {t('test.resultPass', { passed: passedCount, total: results.length })}
                </label>
                <button
                  onClick={() => void buildReport()}
                  disabled={reportBusy}
                  className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-purple-500/15 border border-purple-500/30 text-purple-300 hover:bg-purple-500/25 transition-colors disabled:opacity-40"
                >
                  {reportBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  {t('test.aiReport')}
                </button>
              </div>
              <div className="max-h-64 overflow-y-auto space-y-1 pr-0.5">
                {results.map((r) => {
                  const isOpen = expanded === r.caseId;
                  return (
                    <div key={r.caseId} className="rounded-lg bg-black/20 border border-white/5 overflow-hidden">
                      <div
                        className="flex items-center gap-1.5 px-1.5 py-1 cursor-pointer hover:bg-white/5"
                        onClick={() => setExpanded(isOpen ? null : r.caseId)}
                      >
                        {r.networkError ? (
                          <AlertCircle className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        ) : r.pass ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        ) : (
                          <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                        )}
                        <span
                          className={`px-1 py-0.5 rounded text-[9px] font-mono font-bold border shrink-0 ${METHOD_COLORS[r.method] ?? 'text-slate-400 border-white/20 bg-white/5'}`}
                        >
                          {r.method}
                        </span>
                        <span className="truncate text-[11px] font-mono text-slate-300 flex-1">{r.path}</span>
                        <span className={`text-[10px] font-mono shrink-0 ${r.pass ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {r.networkError ? 'ERR' : r.status}
                        </span>
                        <span className="text-[10px] text-slate-500 shrink-0">{r.timeMs}ms</span>
                        {isOpen ? <ChevronUp className="w-3 h-3 text-slate-500 shrink-0" /> : <ChevronDown className="w-3 h-3 text-slate-500 shrink-0" />}
                      </div>
                      {isOpen && (
                        <div className="px-2 py-1.5 border-t border-white/5">
                          <div className="text-[10px] text-slate-500 mb-1">
                            {t('test.expectShort', { status: cases.find((c) => c.id === r.caseId)?.expectStatus ?? '—' })}{' '}
                            {r.networkError ?? r.status}
                          </div>
                          <pre className="text-[10px] font-mono text-slate-400 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                            {r.bodySnippet || t('test.noBody')}
                          </pre>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ⑧ AI report */}
          {report && (
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-slate-300 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-purple-400" />
                AI 测试报告
              </label>
              <pre
                className="p-2 rounded-lg border font-mono text-[10px] text-slate-300 whitespace-pre-wrap break-words max-h-56 overflow-y-auto leading-relaxed"
                style={{ backgroundColor: theme.bgCanvas, borderColor: theme.borderSubtle }}
              >
                {report}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`absolute bottom-2 left-2 right-2 p-2 rounded-lg text-[11px] flex items-center gap-1.5 animate-in fade-in border z-30 ${
            toast.kind === 'ok'
              ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
          }`}
          style={{ backgroundColor: toast.kind === 'ok' ? undefined : theme.bgSurface }}
        >
          {toast.kind === 'ok' ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 shrink-0" />}
          <span className="break-all">{toast.msg}</span>
        </div>
      )}
    </div>
  );
};
