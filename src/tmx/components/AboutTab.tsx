import { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  RefreshCw,
  Square,
  XCircle,
} from 'lucide-react';
import type { ThemeConfig } from '../types';
import { useT } from '../i18n/context';
import { isElectron } from '../utils/desktop';
import {
  checkForUpdates,
  cancelUpdateDownload,
  installUpdate,
  startUpdateDownload,
  useUpdateState,
} from '../utils/updateState';

// Renders from the shared updater store (utils/updateState), so it stays in
// sync with the sidebar update badge and survives modal open/close cycles.
export function AboutTab({ theme }: { theme: ThemeConfig }) {
  const t = useT();
  const update = useUpdateState();
  const { phase, version, newVersion, progress, error, packagedOnly } = update;
  // The amber "packaged app only" note is dev-only noise; hide it after a while
  // so the panel does not nag on every visit. Kept as local UI state.
  const [showPackagedHint, setShowPackagedHint] = useState(false);

  useEffect(() => {
    setShowPackagedHint(packagedOnly);
  }, [packagedOnly]);

  const actionButton = 'flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-colors text-[10px] font-semibold text-slate-200 hover:bg-white/10 disabled:opacity-50';

  const statusRow = () => {
    switch (phase) {
      case 'checking':
        return (
          <div className="flex items-center gap-2 text-[11px] text-slate-300">
            <RefreshCw className="w-3.5 h-3.5 text-sky-400 animate-spin" />
            <span>{t('settings.checking')}</span>
          </div>
        );
      case 'up-to-date':
        return (
          <div className="flex items-center gap-2 text-[11px] text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>{t('settings.upToDate')}</span>
          </div>
        );
      case 'available':
        return (
          <div className="flex items-center gap-2 text-[11px] text-sky-300">
            <Download className="w-3.5 h-3.5" />
            <span>
              {t('settings.newVersionFound')} · v{newVersion}
            </span>
          </div>
        );
      case 'downloading':
        return (
          <div className="flex items-center gap-2 text-[11px] text-slate-300">
            <Download className="w-3.5 h-3.5 text-sky-400" />
            <span>
              {t('settings.downloading')} {progress ? `${progress.percent}%` : '…'}
            </span>
          </div>
        );
      case 'downloaded':
        return (
          <div className="flex items-center gap-2 text-[11px] text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>{t('settings.updateDownloaded')}</span>
          </div>
        );
      default:
        return <span className="text-[11px] text-slate-400">{t('settings.aboutTitle')}</span>;
    }
  };

  const actionButtonNode = () => {
    switch (phase) {
      case 'idle':
      case 'up-to-date':
        return (
          <button
            onClick={() => void checkForUpdates()}
            className={actionButton}
            style={{ backgroundColor: theme.bgInput, borderColor: theme.borderSubtle }}
          >
            <RefreshCw className="w-3 h-3 text-sky-400" />
            <span>{t('settings.checkUpdate')}</span>
          </button>
        );
      case 'checking':
        return (
          <button disabled className={actionButton}>
            <RefreshCw className="w-3 h-3 animate-spin" />
            <span>{t('settings.checking')}</span>
          </button>
        );
      case 'available':
        return (
          <button
            onClick={startUpdateDownload}
            className={actionButton}
            style={{ backgroundColor: theme.bgInput, borderColor: theme.borderSubtle }}
          >
            <Download className="w-3 h-3 text-sky-400" />
            <span>{t('settings.downloadUpdate')}</span>
          </button>
        );
      case 'downloading':
        return (
          <button
            onClick={cancelUpdateDownload}
            className={actionButton}
            style={{ backgroundColor: theme.bgInput, borderColor: theme.borderSubtle }}
          >
            <Square className="w-3 h-3 text-rose-400" />
            <span>{t('settings.cancelDownload')}</span>
          </button>
        );
      case 'downloaded':
        return (
          <button
            onClick={installUpdate}
            className={actionButton}
            style={{ backgroundColor: theme.bgInput, borderColor: 'rgb(52 211 153 / 0.4)' }}
          >
            <RefreshCw className="w-3 h-3 text-emerald-400" />
            <span>{t('settings.installAndRestart')}</span>
          </button>
        );
    }
  };

  return (
    <div className="space-y-3 animate-in fade-in duration-150">
      {/* 应用信息 */}
      <div className="flex items-center gap-3 px-2.5 py-2 rounded-xl border border-white/5 bg-black/20">
        <img src="./brand/tmx-app.svg" alt="" className="w-11 h-11 shrink-0" draggable={false} />
        <div>
          <div className="font-semibold text-sm text-slate-200">TMX</div>
          <div className="font-mono text-[10px] text-slate-400">
            {t('settings.currentVersion')} · v{version}
          </div>
        </div>
      </div>

      {/* 软件更新 */}
      <div className="space-y-1.5 pt-2 border-t border-white/5">
        {isElectron() ? (
          <div className="px-2.5 py-2 rounded-xl border border-white/5 bg-black/20 space-y-2">
            <div className="flex items-center justify-between gap-2">
              {statusRow()}
              {actionButtonNode()}
            </div>

            {phase === 'downloading' && (
              <div className="space-y-1">
                <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-sky-500 transition-all"
                    style={{ width: `${progress?.percent ?? 0}%` }}
                  />
                </div>
                {progress && (
                  <div className="text-right font-mono text-[9px] text-slate-500">
                    {(progress.bytesPerSecond / 1024).toFixed(0)} KB/s
                  </div>
                )}
              </div>
            )}

            {showPackagedHint && (
              <div className="flex items-start gap-1.5 text-[10px] text-amber-400/90">
                <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                <span>{t('settings.needPackaged')}</span>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-1.5 text-[10px] text-rose-400">
                <XCircle className="w-3 h-3 mt-0.5 shrink-0" />
                <span className="break-all">
                  {error === 'AppTranslocation' ? t('settings.updateTranslocation') : error}
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-start gap-1.5 px-2.5 py-2 rounded-xl border border-white/5 bg-black/20 text-[10px] text-slate-400">
            <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
            <span>{t('settings.needDesktop')}</span>
          </div>
        )}
      </div>
    </div>
  );
}
