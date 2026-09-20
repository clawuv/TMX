import React, { useState, useEffect } from 'react';
import { 
  Activity, 
  Cpu, 
  MemoryStick, 
  HardDrive, 
  Network, 
  Server, 
  Clock, 
  CheckCircle2, 
  AlertTriangle,
  RefreshCw,
  Search,
  Filter
} from 'lucide-react';
import type { ThemeConfig, ConnectionHost } from '../types';
import { useT } from '../i18n/context';
interface SystemMonitorProps {
  theme: ThemeConfig;
  host: ConnectionHost;
}

export const SystemMonitor: React.FC<SystemMonitorProps> = ({
  theme,
  host,
}) => {
  const t = useT()
  const [cpuUsage, setCpuUsage] = useState(host.cpuLoad);
  const [memUsage, setMemUsage] = useState(host.memLoad);
  const [netRx, setNetRx] = useState(1.42);
  const [netTx, setNetTx] = useState(0.38);
  const [uptime, setUptime] = useState('42d 07h 18m');
  const [filterQuery, setFilterQuery] = useState('');

  // Real-time jitter simulation for dynamic liveliness
  useEffect(() => {
    const timer = setInterval(() => {
      setCpuUsage((prev) => Math.max(8, Math.min(88, prev + Math.floor(Math.random() * 7 - 3))));
      setMemUsage((prev) => Math.max(50, Math.min(85, prev + (Math.random() > 0.6 ? 1 : -1))));
      setNetRx((prev) => +(Math.max(0.4, prev + (Math.random() * 0.4 - 0.2))).toFixed(2));
      setNetTx((prev) => +(Math.max(0.1, prev + (Math.random() * 0.2 - 0.1))).toFixed(2));
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  const processes = [
    { pid: 1420, user: 'deploy', cpu: 14.2, mem: 3.8, status: 'Running', name: 'node /var/www/app/server.js' },
    { pid: 842, user: 'root', cpu: 8.4, mem: 1.1, status: 'Running', name: 'nginx: worker process' },
    { pid: 2110, user: 'postgres', cpu: 4.1, mem: 6.2, status: 'Sleeping', name: 'postgres: checkpointer' },
    { pid: 914, user: 'root', cpu: 2.3, mem: 0.9, status: 'Running', name: 'docker-proxy :80' },
    { pid: 105, user: 'root', cpu: 0.5, mem: 0.2, status: 'Sleeping', name: 'systemd-journald' },
    { pid: 3108, user: 'deploy', cpu: 0.2, mem: 0.5, status: 'Sleeping', name: 'redis-server *:6379' },
  ];

  const filteredProcesses = processes.filter((p) =>
    p.name.toLowerCase().includes(filterQuery.toLowerCase()) || p.user.includes(filterQuery)
  );

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
        <div className="flex items-center gap-4">
          <div 
            className="w-12 h-12 rounded-xl flex items-center justify-center border shadow-inner shrink-0"
            style={{
              backgroundColor: theme.bgActive,
              borderColor: theme.borderHover,
              color: theme.accentPrimary,
            }}
          >
            <Server className="w-6 h-6" />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-slate-100 font-mono">
                {host.name} ({host.host})
              </h2>
              <span 
                className="px-2 py-0.5 rounded-full text-[10px] font-medium border flex items-center gap-1"
                style={{
                  backgroundColor: 'rgba(52, 211, 153, 0.12)',
                  borderColor: theme.accentSuccess,
                  color: theme.accentSuccess,
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {t('monitor.online')}
              </span>
            </div>

            <p className="text-xs text-slate-400 mt-1 flex items-center gap-3">
              <span>OS: {host.os}</span>
              <span>•</span>
              <span>{t('monitor.latency')}: {host.pingMs}ms</span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3 text-slate-400" />
                {t('monitor.uptime')}: {uptime}
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div 
            className="px-3 py-1.5 rounded-lg border text-xs font-mono"
            style={{
              backgroundColor: theme.bgInput,
              borderColor: theme.borderSubtle,
            }}
          >
            Load Avg: <span className="text-emerald-400 font-semibold">0.42, 0.38, 0.31</span>
          </div>
        </div>
      </div>

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
            <span className="font-mono font-semibold text-slate-200">{cpuUsage}%</span>
          </div>
          <div className="w-full bg-black/40 h-2 rounded-full overflow-hidden p-0.5">
            <div 
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${cpuUsage}%`,
                backgroundColor: cpuUsage > 80 ? theme.accentError : theme.accentPrimary,
              }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-slate-500 font-mono">
            <span>{t('monitor.cores', { cores: 8 })} EPYC</span>
            <span>2.45 GHz</span>
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
            <span className="font-mono font-semibold text-slate-200">{memUsage}%</span>
          </div>
          <div className="w-full bg-black/40 h-2 rounded-full overflow-hidden p-0.5">
            <div 
              className="h-full rounded-full transition-all duration-500 bg-amber-400"
              style={{ width: `${memUsage}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-slate-500 font-mono">
            <span>{t('monitor.used')}: 5.4 GB</span>
            <span>{t('monitor.total')}: 8.0 GB</span>
          </div>
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
            <span className="font-mono font-semibold text-slate-200">38%</span>
          </div>
          <div className="w-full bg-black/40 h-2 rounded-full overflow-hidden p-0.5">
            <div 
              className="h-full rounded-full transition-all duration-500 bg-emerald-400"
              style={{ width: `38%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-slate-500 font-mono">
            <span>{t('monitor.used')}: 45.6 GB</span>
            <span>{t('monitor.total')}: 74.4 GB</span>
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
            <span className="font-mono font-semibold text-slate-200">eth0</span>
          </div>
          <div className="flex items-center justify-between pt-1 font-mono text-xs">
            <div className="flex items-center gap-1 text-emerald-400">
              <span>↓ {netRx} MB/s</span>
            </div>
            <div className="flex items-center gap-1 text-sky-400">
              <span>↑ {netTx} MB/s</span>
            </div>
          </div>
          <div className="flex justify-between text-[11px] text-slate-500 font-mono">
            <span>{t('monitor.totalIn')}: 4.8 TB</span>
            <span>{t('monitor.totalOut')}: 1.2 TB</span>
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
                <th className="px-5 py-2.5 font-medium">PID</th>
                <th className="px-4 py-2.5 font-medium">USER</th>
                <th className="px-4 py-2.5 font-medium">CPU%</th>
                <th className="px-4 py-2.5 font-medium">MEM%</th>
                <th className="px-4 py-2.5 font-medium">{t('monitor.state')}</th>
                <th className="px-5 py-2.5 font-medium">COMMAND</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filteredProcesses.map((proc) => (
                <tr key={proc.pid} className="hover:bg-white/[0.02] transition-colors">
                  <td className="px-5 py-2.5 text-slate-400">{proc.pid}</td>
                  <td className="px-4 py-2.5 text-sky-400">{proc.user}</td>
                  <td className="px-4 py-2.5 font-semibold text-slate-200">{proc.cpu}%</td>
                  <td className="px-4 py-2.5 text-slate-300">{proc.mem}%</td>
                  <td className="px-4 py-2.5">
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      {proc.status}
                    </span>
                  </td>
                  <td className="px-5 py-2.5 text-slate-200 truncate max-w-md">
                    {proc.name}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
