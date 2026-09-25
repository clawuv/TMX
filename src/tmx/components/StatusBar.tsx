import React from 'react';
import { 
  Wifi, 
  Columns2,
  Lock,
} from 'lucide-react';
import type { ThemeConfig, ConnectionHost } from '../types';
import { useT } from '../i18n/context';
interface StatusBarProps {
  host: ConnectionHost;
  theme: ThemeConfig;
  /** Active tab is a local shell → show the local machine instead of a host. */
  local?: boolean;
  onOpenAICopilot?: () => void;
  onOpenCommandPalette?: () => void;
  isSplit: boolean;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  host,
  theme,
  local = false,
  isSplit,
}) => {
  const t = useT()
  const hasHost = Boolean(host.host)
  const showTarget = local || hasHost
  return (
    <footer
      id="desktop-status-bar"
      className="h-7 flex items-center justify-between px-3 text-[11px] font-mono select-none transition-colors duration-200 z-10 shrink-0"
      style={{
        backgroundColor: theme.bgSurface,
        borderColor: theme.borderSubtle,
        color: theme.textSecondary,
      }}
    >
      {/* Left: SSH Target, Protocol & Encryption */}
      <div className="flex items-center gap-3 shrink-0">
        {local ? (
          <div className="flex items-center gap-1.5 text-slate-200 font-medium">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: theme.accentSuccess }}
            />
            <span style={{ color: theme.accentPrimary }}>local</span>
            <span>{t('status.localHost')}</span>
          </div>
        ) : hasHost ? (
          <>
            <div className="flex items-center gap-1.5 text-slate-200 font-medium">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: theme.accentSuccess }}
              />
              <span style={{ color: theme.accentPrimary }}>ssh</span>
              <span>{host.user}@{host.host}:{host.port}</span>
            </div>

            <div className="hidden sm:flex items-center gap-1 text-slate-500">
              <Lock className="w-3 h-3 text-emerald-400" />
              <span>{host.authMethod}</span>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-1.5 text-slate-500">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: theme.textMuted }}
            />
            <span>{t('status.noHost')}</span>
          </div>
        )}
      </div>

      {/* Right: Ping Latency & Pane Layout */}
      <div className="flex items-center gap-3 shrink-0">
        {hasHost && !local && (
          <div className="hidden sm:flex items-center gap-1.5 text-slate-400">
            <Wifi className="w-3 h-3 text-emerald-400" />
            <span>{host.pingMs}ms</span>
          </div>
        )}

        <div className="hidden md:flex items-center gap-1 text-slate-500">
          <span>UTF-8</span>
        </div>

        {isSplit && (
          <div className="hidden sm:flex items-center gap-1 text-sky-400">
            <Columns2 className="w-3 h-3" />
            <span>{t('status.split')}</span>
          </div>
        )}
      </div>
    </footer>
  );
};
