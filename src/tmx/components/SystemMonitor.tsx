import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Cpu,
  MemoryStick,
  HardDrive,
  Network,
  Server,
  Clock,
  AlertTriangle,
  RefreshCw,
  Search,
} from 'lucide-react';
import type { MonitorProcess, MonitorSample, MonitorTarget, ThemeConfig, ConnectionHost } from '../types';
import { useT } from '../i18n/context';
import { showContextMenu } from '../utils/desktop';

interface SystemMonitorProps {
  theme: ThemeConfig;
  /** Identity of the monitored host, used for the banner and the web-mode sample. */
  host: ConnectionHost;
  /**
   * Real sampling target. Null outside Electron, where the dashboard keeps its
   * simulated data so the page can still be exercised in a plain browser.
   */
  target: MonitorTarget | null;
}

/** Everything the dashboard renders, whichever source produced it. */
interface MonitorView {
  os: string;
  kernel: string;
  uptimeSec: number;
  cpuPercent: number;
  cpuCount: number;
  cpuModel: string;
  cpuMhz: number;
  loadAvg: [number, number, number] | null;
  memTotal: number;
  memUsed: number;
  swapTotal: number;
  swapUsed: number;
  disk: { mount: string; total: number; used: number } | null;
  net: { name: string; rxRate: number; txRate: number; rxBytes: number; txBytes: number } | null;
  processes: MonitorProcess[];
  rttMs: number;
}

const POLL_MS = 2000;
const GB = 1024 ** 3;
const TB = 1024 ** 4;

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes >= TB) return `${(bytes / TB).toFixed(2)} TB`;
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${Math.round(bytes)} B`;
}

/** Throughput reads better in MB/s once it is past 1 MB/s, KB/s below that. */
function formatRate(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '0 KB/s';
  if (bytesPerSecond >= 1024 ** 2) return `${(bytesPerSecond / 1024 ** 2).toFixed(2)} MB/s`;
  return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
}

function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${days}d ${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m`;
}

function percent(used: number, total: number): number {
  if (!total || total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((used / total) * 1000) / 10));
}

/** Busiest real interface, falling back to whatever was reported. */
function pickIface(sample: MonitorSample) {
  const real = sample.net.filter((i) => !/^(lo|lo0|Loopback)/i.test(i.name));
  const pool = real.length ? real : sample.net;
  if (!pool.length) return null;
  return pool.reduce((best, i) =>
    i.rxBytes + i.txBytes > best.rxBytes + best.txBytes ? i : best,
  );
}

/** Root filesystem when present, otherwise the largest mount. */
function pickDisk(sample: MonitorSample) {
  const root = sample.disks.find((d) => d.mount === '/');
  if (root) return root;
  return sample.disks.reduce<(typeof sample.disks)[number] | null>(
    (best, d) => (!best || d.total > best.total ? d : best),
    null,
  );
}

function toView(sample: MonitorSample): MonitorView {
  const iface = pickIface(sample);
  return {
    os: sample.os,
    kernel: sample.kernel,
    uptimeSec: sample.uptimeSec,
    cpuPercent: sample.cpuPercent,
    cpuCount: sample.cpuCount,
    cpuModel: sample.cpuModel,
    cpuMhz: sample.cpuMhz,
    loadAvg: sample.loadAvg,
    memTotal: sample.memTotal,
    memUsed: sample.memUsed,
    swapTotal: sample.swapTotal,
    swapUsed: sample.swapUsed,
    disk: pickDisk(sample),
    net: iface
      ? {
          name: iface.name,
          rxRate: iface.rxRate,
          txRate: iface.txRate,
          rxBytes: iface.rxBytes,
          txBytes: iface.txBytes,
        }
      : null,
    processes: sample.processes,
    rttMs: sample.rttMs,
  };
}

/** Simulated dashboard for browser mode — seeded from the host, then jittered. */
const MOCK_PROCESSES: MonitorProcess[] = [
  { pid: 1420, user: 'deploy', cpu: 14.2, mem: 3.8, state: 'R', command: 'node /var/www/app/server.js' },
  { pid: 842, user: 'root', cpu: 8.4, mem: 1.1, state: 'S', command: 'nginx: worker process' },
  { pid: 2110, user: 'postgres', cpu: 4.1, mem: 6.2, state: 'S', command: 'postgres: checkpointer' },
  { pid: 914, user: 'root', cpu: 2.3, mem: 0.9, state: 'S', command: 'docker-proxy :80' },
  { pid: 105, user: 'root', cpu: 0.5, mem: 0.2, state: 'S', command: 'systemd-journald' },
  { pid: 3108, user: 'deploy', cpu: 0.2, mem: 0.5, state: 'S', command: 'redis-server *:6379' },
];

function useMockView(host: ConnectionHost): MonitorView {
  const [cpu, setCpu] = useState(host.cpuLoad);
  const [mem, setMem] = useState(host.memLoad);
  const [rx, setRx] = useState(1.42);
  const [tx, setTx] = useState(0.38);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCpu((prev) => Math.max(8, Math.min(88, prev + Math.floor(Math.random() * 7 - 3))));
      setMem((prev) => Math.max(50, Math.min(85, prev + (Math.random() > 0.6 ? 1 : -1))));
      setRx((prev) => +(Math.max(0.4, prev + (Math.random() * 0.4 - 0.2))).toFixed(2));
      setTx((prev) => +(Math.max(0.1, prev + (Math.random() * 0.2 - 0.1))).toFixed(2));
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, []);

  const memTotal = 8 * GB;
  const diskTotal = 74.4 * GB;
  const diskUsed = 45.6 * GB;
  return {
    os: host.os,
    kernel: '',
    uptimeSec: 42 * 86400 + 7 * 3600 + 18 * 60,
    cpuPercent: cpu,
    cpuCount: 8,
    cpuModel: 'EPYC',
    cpuMhz: 2450,
    loadAvg: [0.42, 0.38, 0.31],
    memTotal,
    memUsed: (mem / 100) * memTotal,
    swapTotal: 0,
    swapUsed: 0,
    disk: { mount: '/', total: diskTotal, used: diskUsed },
    net: { name: 'eth0', rxRate: rx * 1024 ** 2, txRate: tx * 1024 ** 2, rxBytes: 4.8 * TB, txBytes: 1.2 * TB },
    processes: MOCK_PROCESSES,
    rttMs: host.pingMs,
  };
}

/** Polls the main process; the previous request must finish before the next starts. */
function useLiveSample(target: MonitorTarget | null) {
  const [sample, setSample] = useState<MonitorSample | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [nonce, setNonce] = useState(0);
  const targetRef = useRef(target);
  targetRef.current = target;
  const targetKey = target ? JSON.stringify(target) : '';

  useEffect(() => {
    if (!targetKey) return;
    let cancelled = false;
    let timer = 0;

    const tick = async () => {
      const current = targetRef.current;
      if (!current || cancelled) return;
      try {
        const next = (await window.ipcRenderer.invoke('monitor:sample', current)) as MonitorSample;
        if (cancelled) return;
        setSample(next);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (cancelled) return;
        setLoaded(true);
        timer = window.setTimeout(tick, POLL_MS);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [targetKey, nonce]);

  // Hand the pooled SSH connection back as soon as the page is left.
  useEffect(() => {
    if (!targetKey) return;
    return () => {
      const current = targetRef.current;
      if (current?.kind === 'ssh') {
        void window.ipcRenderer.invoke('monitor:release', current).catch(() => {});
      }
    };
  }, [targetKey]);

  return { sample, error, loaded, retry: () => setNonce((n) => n + 1) };
}

/** `ps` state token → label key + badge tone. */
function stateOf(raw: string): { key: string; tone: 'ok' | 'warn' | 'muted' } {
  const code = raw.trim().charAt(0).toUpperCase();
  if (code === 'R') return { key: 'monitor.running', tone: 'ok' };
  if (code === 'S' || code === 'D' || code === 'I') return { key: 'monitor.sleeping', tone: 'ok' };
  if (code === 'T') return { key: 'monitor.stopped', tone: 'warn' };
  if (code === 'Z') return { key: 'monitor.zombie', tone: 'warn' };
  return { key: 'monitor.other', tone: 'muted' };
}

export const SystemMonitor: React.FC<SystemMonitorProps> = ({ theme, host, target }) => {
  const t = useT();
  const [filterQuery, setFilterQuery] = useState('');
  const mockView = useMockView(host);
  const { sample, error, loaded, retry } = useLiveSample(target);
  const view = useMemo(
    () => (target && sample ? toView(sample) : mockView),
    [target, sample, mockView],
  );
  const live = Boolean(target);

  const filteredProcesses = view.processes.filter(
    (p) =>
      p.command.toLowerCase().includes(filterQuery.toLowerCase()) ||
      p.user.toLowerCase().includes(filterQuery.toLowerCase()),
  );

  const memPercent = percent(view.memUsed, view.memTotal);
  const diskPercent = view.disk ? percent(view.disk.used, view.disk.total) : 0;
  const online = !live || (!error && Boolean(sample));
  const waiting = live && !loaded && !error;

  const badge = error
    ? { bg: 'rgba(248, 113, 113, 0.12)', border: theme.accentError, color: theme.accentError, dot: theme.accentError, label: t('monitor.offline') }
    : online
      ? { bg: 'rgba(52, 211, 153, 0.12)', border: theme.accentSuccess, color: theme.accentSuccess, dot: theme.accentSuccess, label: t('monitor.online') }
      : { bg: 'rgba(251, 191, 36, 0.12)', border: theme.accentWarning, color: theme.accentWarning, dot: theme.accentWarning, label: t('monitor.loading') };

  return (
    <div
      className="flex-1 h-full overflow-y-auto p-6 space-y-6 select-none transition-colors duration-150"
      style={{
        backgroundColor: theme.bgCanvas,
        color: theme.textPrimary,
      }}
    >
      {/* Top Banner Overview */}
      <div
        className="p-5 rounded-2xl border flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
        style={{
          backgroundColor: theme.bgSurface,
          borderColor: theme.borderSubtle,
        }}
      >
        <div className="flex items-center gap-4 min-w-0">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center border shrink-0"
            style={{
              backgroundColor: theme.bgActive,
              borderColor: theme.borderHover,
              color: theme.accentPrimary,
            }}
          >
            <Server className="w-6 h-6" />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-slate-100 font-mono truncate">
                {host.name} ({host.host})
              </h2>
              <span
                className="px-2 py-0.5 rounded-full text-[10px] font-medium border flex items-center gap-1 shrink-0"
                style={{ backgroundColor: badge.bg, borderColor: badge.border, color: badge.color }}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${online ? 'animate-pulse' : ''}`}
                  style={{ backgroundColor: badge.dot }}
                />
                {badge.label}
              </span>
              {live && (
                <button
                  type="button"
                  onClick={retry}
                  className="p-1 rounded-md border transition-colors hover:opacity-80 shrink-0"
                  style={{
                    backgroundColor: theme.bgInput,
                    borderColor: theme.borderSubtle,
                    color: theme.textSecondary,
                  }}
                  title={t('monitor.retry')}
                >
                  <RefreshCw className={`w-3 h-3 ${waiting ? 'animate-spin' : ''}`} />
                </button>
              )}
            </div>

            <p className="text-xs text-slate-400 mt-1 flex items-center gap-3 flex-wrap">
              <span>{t('monitor.os')}: {view.os || '—'}{view.kernel && view.kernel !== view.os ? ` · ${view.kernel}` : ''}</span>
              <span>•</span>
              <span>{t('monitor.latency')}: {view.rttMs}ms</span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3 text-slate-400" />
                {t('monitor.uptime')}: {formatUptime(view.uptimeSec)}
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div
            className="px-3 py-1.5 rounded-lg border text-xs font-mono"
            style={{
              backgroundColor: theme.bgInput,
              borderColor: theme.borderSubtle,
            }}
          >
            <div className="text-[10px] text-slate-400 leading-tight">{t('monitor.loadAvg')}</div>
            <div className="text-emerald-400 font-semibold whitespace-nowrap">
              {view.loadAvg
                ? view.loadAvg.map((n) => n.toFixed(2)).join(' / ')
                : t('monitor.notAvailable')}
            </div>
          </div>
        </div>
      </div>

      {/* Sampling failure: surface the reason instead of silently showing stale numbers */}
      {error && (
        <div
          className="flex items-start gap-3 p-4 rounded-xl border text-xs"
          style={{
            backgroundColor: 'rgba(248, 113, 113, 0.08)',
            borderColor: theme.accentError,
            color: theme.textPrimary,
          }}
        >
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: theme.accentError }} />
          <div className="min-w-0 flex-1">
            <div className="font-semibold" style={{ color: theme.accentError }}>
              {t('monitor.error')}
            </div>
            <div className="mt-1 break-words text-slate-300">{error}</div>
          </div>
          <button
            type="button"
            onClick={retry}
            className="shrink-0 px-3 py-1 rounded-lg border text-[11px] font-medium"
            style={{ borderColor: theme.accentError, color: theme.accentError }}
          >
            {t('monitor.retry')}
          </button>
        </div>
      )}

      {/* 4-Metric Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* CPU Metric */}
        <div
          className="p-4 rounded-xl border space-y-3"
          style={{
            backgroundColor: theme.bgSurface,
            borderColor: theme.borderSubtle,
          }}
        >
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="flex items-center gap-1.5 font-medium">
              <Cpu className="w-4 h-4 text-sky-400" />
              {t('monitor.cpu')}
            </span>
            <span className="font-mono font-semibold text-slate-200">{view.cpuPercent}%</span>
          </div>
          <div className="w-full bg-black/40 h-2 rounded-full overflow-hidden p-0.5">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.min(100, view.cpuPercent)}%`,
                backgroundColor: view.cpuPercent > 80 ? theme.accentError : theme.accentPrimary,
              }}
            />
          </div>
          <div className="flex justify-between gap-2 text-[11px] text-slate-500 font-mono">
            <span className="truncate" title={view.cpuModel}>
              {t('monitor.cores', { cores: view.cpuCount })}
              {view.cpuModel ? ` · ${view.cpuModel}` : ''}
            </span>
            {view.cpuMhz > 0 && <span className="shrink-0">{(view.cpuMhz / 1000).toFixed(2)} GHz</span>}
          </div>
        </div>

        {/* RAM Metric */}
        <div
          className="p-4 rounded-xl border space-y-3"
          style={{
            backgroundColor: theme.bgSurface,
            borderColor: theme.borderSubtle,
          }}
        >
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="flex items-center gap-1.5 font-medium">
              <MemoryStick className="w-4 h-4 text-amber-400" />
              {t('monitor.mem')}
            </span>
            <span className="font-mono font-semibold text-slate-200">{memPercent}%</span>
          </div>
          <div className="w-full bg-black/40 h-2 rounded-full overflow-hidden p-0.5">
            <div
              className="h-full rounded-full transition-all duration-500 bg-amber-400"
              style={{ width: `${memPercent}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-slate-500 font-mono">
            <span>{t('monitor.used')}: {formatBytes(view.memUsed)}</span>
            <span>{t('monitor.total')}: {formatBytes(view.memTotal)}</span>
          </div>
          {view.swapTotal > 0 && (
            <div className="flex justify-between text-[11px] text-slate-500 font-mono">
              <span>{t('monitor.swap')}: {formatBytes(view.swapUsed)}</span>
              <span>{formatBytes(view.swapTotal)}</span>
            </div>
          )}
        </div>

        {/* Disk Storage */}
        <div
          className="p-4 rounded-xl border space-y-3"
          style={{
            backgroundColor: theme.bgSurface,
            borderColor: theme.borderSubtle,
          }}
        >
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="flex items-center gap-1.5 font-medium">
              <HardDrive className="w-4 h-4 text-emerald-400" />
              {t('monitor.disk')}
            </span>
            <span className="font-mono font-semibold text-slate-200">{diskPercent}%</span>
          </div>
          <div className="w-full bg-black/40 h-2 rounded-full overflow-hidden p-0.5">
            <div
              className="h-full rounded-full transition-all duration-500 bg-emerald-400"
              style={{ width: `${diskPercent}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-slate-500 font-mono">
            <span>{t('monitor.used')}: {view.disk ? formatBytes(view.disk.used) : '—'}</span>
            <span>{t('monitor.total')}: {view.disk ? formatBytes(view.disk.total) : '—'}</span>
          </div>
        </div>

        {/* Network Throughput */}
        <div
          className="p-4 rounded-xl border space-y-3"
          style={{
            backgroundColor: theme.bgSurface,
            borderColor: theme.borderSubtle,
          }}
        >
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="flex items-center gap-1.5 font-medium">
              <Network className="w-4 h-4 text-purple-400" />
              {t('monitor.net')}
            </span>
            <span className="font-mono font-semibold text-slate-200 truncate max-w-[8rem]" title={view.net?.name}>
              {view.net?.name ?? '—'}
            </span>
          </div>
          <div className="flex items-center justify-between pt-1 font-mono text-xs">
            <div className="flex items-center gap-1 text-emerald-400">
              <span>↓ {formatRate(view.net?.rxRate ?? 0)}</span>
            </div>
            <div className="flex items-center gap-1 text-sky-400">
              <span>↑ {formatRate(view.net?.txRate ?? 0)}</span>
            </div>
          </div>
          <div className="flex justify-between text-[11px] text-slate-500 font-mono">
            <span>{t('monitor.totalIn')}: {formatBytes(view.net?.rxBytes ?? 0)}</span>
            <span>{t('monitor.totalOut')}: {formatBytes(view.net?.txBytes ?? 0)}</span>
          </div>
        </div>
      </div>

      {/* Real-time Process Table */}
      <div
        className="rounded-2xl border overflow-hidden"
        style={{
          backgroundColor: theme.bgSurface,
          borderColor: theme.borderSubtle,
        }}
      >
        <div
          className="flex items-center justify-between px-5 py-3 border-b"
          style={{
            backgroundColor: theme.bgBase,
            borderColor: theme.borderSubtle,
          }}
        >
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4" style={{ color: theme.accentPrimary }} />
            <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider font-mono">
              {t('monitor.processes')}
            </h3>
          </div>

          <div
            className="flex items-center gap-2 px-2 py-1 rounded-lg border text-xs"
            style={{
              backgroundColor: theme.bgInput,
              borderColor: theme.borderSubtle,
            }}
          >
            <Search className="w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder={t('monitor.filterPlaceholder')}
              className="bg-transparent border-none outline-none text-xs text-slate-200 w-36 placeholder-slate-500"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono-term">
            <thead>
              <tr
                className="border-b text-slate-400 text-[11px]"
                style={{ borderColor: theme.borderSubtle }}
              >
                <th className="px-5 py-2.5 font-medium">{t('monitor.pid')}</th>
                <th className="px-4 py-2.5 font-medium">{t('monitor.user')}</th>
                <th className="px-4 py-2.5 font-medium">{t('monitor.cpuPct')}</th>
                <th className="px-4 py-2.5 font-medium">{t('monitor.memPct')}</th>
                <th className="px-4 py-2.5 font-medium">{t('monitor.state')}</th>
                <th className="px-5 py-2.5 font-medium">{t('monitor.command')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filteredProcesses.map((proc) => {
                const state = stateOf(proc.state);
                const tone =
                  state.tone === 'warn'
                    ? { bg: 'rgba(251, 191, 36, 0.10)', color: theme.accentWarning, border: theme.accentWarning }
                    : { bg: 'rgba(52, 211, 153, 0.10)', color: theme.accentSuccess, border: theme.accentSuccess };
                return (
                  <tr key={proc.pid} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-2.5 text-slate-400">{proc.pid}</td>
                    <td className="px-4 py-2.5 text-sky-400">{proc.user || '—'}</td>
                    <td className="px-4 py-2.5 font-semibold text-slate-200">{proc.cpu}%</td>
                    <td className="px-4 py-2.5 text-slate-300">{proc.mem}%</td>
                    <td className="px-4 py-2.5">
                      {proc.state ? (
                        <span
                          className="px-1.5 py-0.5 rounded text-[10px] border"
                          style={{
                            backgroundColor: tone.bg,
                            color: tone.color,
                            borderColor: `${tone.border}33`,
                          }}
                        >
                          {t(state.key)}
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td
                      className="px-5 py-2.5 text-slate-200 truncate max-w-0 w-full"
                      title={proc.command}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        showContextMenu(
                          [{ id: 'copy', label: t('common.copy') }],
                          (id) => {
                            if (id === 'copy') void navigator.clipboard.writeText(proc.command);
                          },
                        );
                      }}
                    >
                      {proc.command}
                    </td>
                  </tr>
                );
              })}
              {filteredProcesses.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-slate-500">
                    {t('monitor.noProcesses')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
