import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Sliders,
  Type,
  Sparkles,
  Keyboard,
  Check,
  Monitor,
  Eye,
  Globe,
  LayoutGrid,
  Cpu,
  ShieldCheck,
  Search,
  RotateCcw,
  Download,
  Upload,
  Command,
  Server,
  FolderTree,
  Bookmark,
  Activity,
  CheckCircle2,
  Bell,
  HelpCircle,
  Palette,
  Database,
  ShieldAlert,
  Plug,
  FlaskConical,
  Info
} from 'lucide-react';
import type { ThemeConfig, UserPreferences, SettingTabId, ConnectionHost } from '../types';
import { useT } from '../i18n/context';
import { resolveLang } from '../i18n/context';
import { nativeConfirm, nativeSaveFile } from '../utils/desktop';
import { AboutTab } from './AboutTab';
interface SettingsModalProps {
  isOpen: boolean;
  /** Tab selected when the modal opens; later navigation is free. */
  initialTab?: SettingTabId;
  onClose: () => void;
  theme: ThemeConfig;
  themes: ThemeConfig[];
  onSelectTheme: (theme: ThemeConfig) => void;
  preferences: UserPreferences;
  onUpdatePreference: <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => void;
  onResetPreferences: () => void;
  hosts: ConnectionHost[];
  onUpdateHostGroup: (id: string, group: ConnectionHost['group']) => void;
  onConnectHost: (host: ConnectionHost) => void | Promise<void>;
  onClearStoredCredentials: () => void | Promise<void>;
  onResetDatabase: () => void | Promise<void>;
}

interface DbStats {
  path: string;
  hostCount: number;
  snippetCount: number;
  credentialsStored: number;
  sizeBytes: number;
}

/** 数据与存储 tab — isolated so its db:get-stats effect only runs when open. */
const StorageTab: React.FC<{
  theme: ThemeConfig;
  onClearStoredCredentials: () => void | Promise<void>;
  onResetDatabase: () => void | Promise<void>;
}> = ({ theme, onClearStoredCredentials, onResetDatabase }) => {
  const t = useT()
  const [stats, setStats] = useState<DbStats | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    window.ipcRenderer.invoke('db:get-stats').then((s: DbStats) => setStats(s)).catch(() => {});
  };
  useEffect(refresh, []);

  const handleClear = async () => {
    if (!(await nativeConfirm({ message: t('settings.clearCredsConfirm'), danger: true }))) return;
    setBusy(true);
    try {
      await onClearStoredCredentials();
      refresh();
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    if (!(await nativeConfirm({ message: t('settings.dbResetConfirm'), danger: true }))) return;
    setBusy(true);
    try {
      await onResetDatabase();
      refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-150">
      <div>
        <p className="text-slate-400 text-[10px]">{t('settings.storageSub')}</p>
      </div>

      {/* DB overview */}
      <div className="space-y-1.5">
        <label className="font-medium text-slate-300 flex items-center gap-2 mb-1.5">
          <Database className="w-4 h-4 text-sky-400" />
          <span>{t('settings.dbOverview')}</span>
        </label>
        <div
          className="p-3 rounded-xl border space-y-1.5"
          style={{ backgroundColor: theme.bgInput, borderColor: theme.borderSubtle }}
        >
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-400">{t('settings.dbPath')}</span>
            <span className="font-mono text-slate-200 truncate ml-3" title={stats?.path}>
              {stats ? stats.path : t('settings.loading')}
            </span>
          </div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-400">{t('settings.hostCount')}</span>
            <span className="font-mono text-slate-200">{stats ? `${stats.hostCount}` : '—'}</span>
          </div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-400">{t('settings.snippetCount')}</span>
            <span className="font-mono text-slate-200">{stats ? `${stats.snippetCount}` : '—'}</span>
          </div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-400">{t('settings.credsStoredHosts')}</span>
            <span className="font-mono text-slate-200">{stats ? `${stats.credentialsStored}` : '—'}</span>
          </div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-400">{t('settings.dbSize')}</span>
            <span className="font-mono text-slate-200">
              {stats ? `${(stats.sizeBytes / 1024).toFixed(1)} KB` : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Plaintext credential warning */}
      <div className="space-y-1.5">
        <label className="font-medium text-slate-300 flex items-center gap-2 mb-1.5">
          <ShieldAlert className="w-4 h-4 text-amber-400" />
          <span>{t('settings.credsNotice')}</span>
        </label>
        <div
          className={`p-2.5 rounded-xl border border-l-[3px] border-amber-500/35 bg-amber-500/[0.08] text-[10px] leading-relaxed ${
            theme.light ? 'text-amber-800' : 'text-amber-200'
          }`}
        >
          {t('settings.credsNoticeBody')}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => void handleClear()}
            disabled={busy || !stats}
            className={`px-2.5 py-1.5 rounded-lg border border-amber-500/40 hover:border-amber-500 hover:bg-amber-500/20 text-[10px] font-semibold transition-colors disabled:opacity-40 ${
              theme.light ? 'text-amber-700 bg-amber-500/10' : 'text-amber-300 bg-amber-500/10'
            }`}
          >
            {t('settings.clearCreds')}
          </button>
          <button
            onClick={() => void handleReset()}
            disabled={busy || !stats}
            className={`px-2.5 py-1.5 rounded-lg border border-rose-500/40 hover:border-rose-500 hover:bg-rose-500/20 text-[10px] font-semibold transition-colors disabled:opacity-40 ${
              theme.light ? 'text-rose-700 bg-rose-500/10' : 'text-rose-300 bg-rose-500/10'
            }`}
          >
            {t('settings.dbReset')}
          </button>
        </div>
      </div>
    </div>
  );
};

interface McpInfo {
  enabled: boolean;
  requireConfirm: boolean;
  running: boolean;
  serverPath: string;
  bridgeConfigPath: string;
  socketPath: string;
}

/** MCP 服务 tab — external AI tools connect to TMX through a local stdio bridge. */
const McpTab: React.FC<{
  theme: ThemeConfig;
  preferences: UserPreferences;
  onUpdatePreference: <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => void;
}> = ({ theme, preferences, onUpdatePreference }) => {
  const t = useT()
  const [info, setInfo] = useState<McpInfo | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = () => {
    window.ipcRenderer.invoke('mcp:get-info').then((i: McpInfo) => setInfo(i)).catch(() => {});
  };
  useEffect(refresh, []);
  useEffect(refresh, [preferences.mcpEnabled]);

  const configJson = JSON.stringify(
    {
      mcpServers: {
        tmx: {
          type: 'stdio',
          command: 'node',
          args: [info?.serverPath ?? t('settings.mcpInstallDir')],
        },
      },
    },
    null,
    2,
  );

  const handleCopy = () => {
    navigator.clipboard.writeText(configJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-150">
      <div>
        <p className="text-slate-400 text-[10px]">
          {t('settings.mcpSub')}
        </p>
      </div>

      {/* Toggles */}
      <div className="space-y-1.5">
        <label className="flex items-center justify-between px-2.5 py-1.5 rounded-xl border border-white/5 bg-black/20 cursor-pointer">
          <div>
            <div className="text-slate-200 font-medium text-[11px]">{t('settings.mcpEnable')}</div>
            <div className="text-[10px] text-slate-400">{t('settings.mcpEnableSub')}</div>
          </div>
          <input
            type="checkbox"
            checked={preferences.mcpEnabled}
            onChange={(e) => onUpdatePreference('mcpEnabled', e.target.checked)}
            className="rounded text-sky-500 focus:ring-0 w-4 h-4"
          />
        </label>

        <label className="flex items-center justify-between px-2.5 py-1.5 rounded-xl border border-white/5 bg-black/20 cursor-pointer">
          <div>
            <div className="text-slate-200 font-medium text-[11px]">{t('settings.mcpRequireConfirm')}</div>
            <div className="text-[10px] text-slate-400">{t('settings.mcpConfirmSub')}</div>
          </div>
          <input
            type="checkbox"
            checked={preferences.mcpRequireConfirm}
            onChange={(e) => onUpdatePreference('mcpRequireConfirm', e.target.checked)}
            className="rounded text-sky-500 focus:ring-0 w-4 h-4"
          />
        </label>
      </div>

      {/* Status */}
      <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl border border-white/5 bg-black/20 text-[11px]">
        <span
          className={`w-1.5 h-1.5 rounded-full ${info?.running ? 'animate-pulse' : ''}`}
          style={{ backgroundColor: info?.running ? theme.accentSuccess : '#64748B' }}
        />
        <span className="text-slate-300">{info?.running ? t('settings.mcpRunning') : t('settings.mcpStopped')}</span>
        {info && <span className="text-slate-500 font-mono text-[9px] truncate ml-auto">{info.socketPath}</span>}
      </div>

      {/* Client registration snippet */}
      <div className="space-y-1.5">
        <label className="font-medium text-slate-300 flex items-center justify-between mb-1.5">
          <span>{t('settings.mcpConfig')}</span>
          <button
            onClick={handleCopy}
            className="px-2.5 py-1 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-[10px] font-medium text-slate-300 transition-colors"
          >
            {copied ? t('common.copied') : t('settings.mcpCopyConfig')}
          </button>
        </label>
        <pre
          className="p-3 rounded-xl border font-mono text-[10px] text-slate-300 overflow-x-auto leading-relaxed"
          style={{ backgroundColor: theme.bgCanvas, borderColor: theme.borderSubtle }}
        >
          {configJson}
        </pre>
        <div className="text-[10px] text-slate-500 leading-relaxed">
          {t('settings.mcpConfigHint')}
        </div>
      </div>

      {/* Tool inventory */}
      <div className="space-y-1.5">
        <label className="font-medium text-slate-300 text-[11px]">{t('settings.mcpTools')}</label>
        <div className="p-3 rounded-xl border border-white/5 bg-black/20 text-[10px] text-slate-400 leading-relaxed">
          list_hosts · exec_command · list_sessions · read_session_output · send_session_input ·
          {t('settings.mcpToolsList')}
        </div>
      </div>
    </div>
  );
};

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  initialTab,
  onClose,
  theme,
  themes,
  onSelectTheme,
  preferences,
  onUpdatePreference,
  onResetPreferences,
  hosts,
  onUpdateHostGroup,
  onConnectHost,
  onClearStoredCredentials,
  onResetDatabase,
}) => {
  const t = useT()
  const [activeTab, setActiveTab] = useState<SettingTabId>('appearance');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedNotification, setCopiedNotification] = useState<string | null>(null);

  // The modal stays mounted while closed; pick up the requested tab each open.
  useEffect(() => {
    if (isOpen && initialTab) setActiveTab(initialTab);
  }, [isOpen, initialTab]);

  if (!isOpen) return null;

  // Sidebar navigation tabs, grouped
  type NavTab = { id: SettingTabId; label: string; icon: React.ComponentType<{ className?: string }>; desc: string };
  const navGroups: { group: string; tabs: NavTab[] }[] = [
    {
      group: t('settings.groupGeneral'),
      tabs: [
        { id: 'language', label: t('settings.tabLanguage'), icon: Globe, desc: t('settings.languageTitle') },
        { id: 'appearance', label: t('settings.tabAppearance'), icon: Palette, desc: t('settings.appearanceTitle') },
      ],
    },
    {
      group: t('settings.groupWorkspace'),
      tabs: [
        { id: 'bookmarks', label: t('settings.tabBookmarks'), icon: Bookmark, desc: t('bookmarks.sub') },
        { id: 'shortcuts', label: t('settings.tabShortcuts'), icon: Keyboard, desc: t('settings.keymap') },
        { id: 'sidebar', label: t('settings.tabSidebar'), icon: LayoutGrid, desc: t('settings.navVisibility') },
      ],
    },
      {
        group: t('settings.groupSystem'),
        tabs: [
          { id: 'storage', label: t('settings.tabStorage'), icon: Database, desc: t('settings.storageSub') },
          { id: 'mcp', label: t('settings.tabMcp'), icon: Plug, desc: t('settings.mcpSub') },
          { id: 'advanced', label: t('settings.tabAdvanced'), icon: Cpu, desc: t('settings.advancedTitle') },
          { id: 'security', label: t('settings.tabSecurity'), icon: ShieldCheck, desc: t('settings.securityTitle') },
          { id: 'about', label: t('settings.tabAbout'), icon: Info, desc: t('settings.aboutSub') },
        ],
      },
  ];

  // Helper to handle export
  const handleExportConfig = async () => {
    const content = JSON.stringify(preferences, null, 2);
    const result = await nativeSaveFile({
      content,
      defaultPath: `tmx-preferences-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!result.ok) return;
    setCopiedNotification(t('settings.exported'));
    setTimeout(() => setCopiedNotification(null), 2500);
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 select-none"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div 
        className="w-full max-w-2xl h-[500px] max-h-[85vh] rounded-2xl border shadow-2xl overflow-hidden flex flex-col text-slate-200"
        style={{
          backgroundColor: theme.bgSurface,
          borderColor: theme.borderHover,
        }}
      >
        {/* Top Header */}
        <div 
          className="flex items-center justify-between px-2.5 py-1.5 shrink-0"
          style={{
            backgroundColor: theme.bgBase,
            borderColor: theme.borderSubtle,
          }}
        >
          <div className="flex items-center gap-2.5">
            <div 
              className="w-7 h-7 rounded-lg flex items-center justify-center border border-white/10"
              style={{ backgroundColor: theme.bgActive }}
            >
              <Sliders className="w-4 h-4" style={{ color: theme.accentPrimary }} />
            </div>
            <div>
              <h3 className="font-semibold text-sm text-slate-100 tracking-tight">
                {t('settings.title')}
              </h3>
            </div>
          </div>

          {/* Search bar + Close */}
          <div className="flex items-center gap-3">
            <div 
              className="relative flex items-center w-48 h-7 px-2.5 rounded-lg border text-[11px]"
              style={{
                backgroundColor: theme.bgInput,
                borderColor: theme.borderSubtle,
              }}
            >
              <Search className="w-3.5 h-3.5 text-slate-400 shrink-0 mr-2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('settings.searchPlaceholder')}
                className="w-full bg-transparent border-none outline-none text-slate-200 placeholder:text-slate-500 text-[11px]"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="text-slate-400 hover:text-slate-200">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/10 transition-colors"
              title={t('settings.close')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Master-Detail Two Column Layout */}
        <div className="flex flex-1 min-h-0 overflow-hidden" style={{ backgroundColor: theme.bgBase }}>
          {/* Left Category Sidebar */}
          <div
            className="w-40 shrink-0 flex flex-col p-2 select-none"
            style={{ backgroundColor: theme.bgBase }}
          >
            <div className="space-y-4">
              {navGroups.map(({ group, tabs }) => (
                <div key={group} className="space-y-1.5">
                  <div className="px-2.5 mb-2 text-[10px] font-medium uppercase tracking-wider text-slate-500/80 leading-none">
                    {group}
                  </div>
                  {tabs.map((tab) => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => {
                          setActiveTab(tab.id);
                          setSearchQuery('');
                        }}
                        title={tab.desc}
                        className={`w-full flex items-center gap-2 px-2.5 py-1 rounded-lg text-[11px] font-medium text-left transition-all ${
                          isActive
                            ? 'text-white shadow-sm font-semibold'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                        }`}
                        style={{
                          backgroundColor: isActive ? theme.bgActive : 'transparent',
                          color: isActive ? theme.accentPrimary : undefined,
                        }}
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        <span className="truncate">{tab.label}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* Right Main Settings Pane */}
          <div 
            className="flex-1 px-4 py-3 overflow-y-auto space-y-3 text-[11px] text-slate-200 rounded-l-2xl border-l"
            style={{ backgroundColor: theme.bgSurface, borderColor: theme.borderSubtle }}
          >
            {/* 1. 语言与地区 (Language) */}
            {activeTab === 'language' && (
              <div className="space-y-3 animate-in fade-in duration-150">
                {/* 界面语言 */}
                <div className="space-y-1.5">
                  <label className="font-medium text-slate-300 flex items-center gap-2 mb-1.5">
                    <Globe className="w-4 h-4 text-sky-400" />
                    <span>{t('settings.interfaceLanguage')}</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: 'zh-CN', label: t('settings.langZh'), sub: 'Chinese Simplified' },
                      { id: 'en-US', label: t('settings.langEn'), sub: 'English (US)' },
                    ].map((item) => (
                      <div
                        key={item.id}
                        onClick={() => onUpdatePreference('language', item.id as any)}
                        className={`px-2 py-1 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                          (preferences.language ? preferences.language === item.id : resolveLang(preferences.language) === item.id) 
                            ? 'border-sky-500 bg-sky-500/10 text-white' 
                            : 'border-white/10 hover:border-white/20 bg-black/20 text-slate-300'
                        }`}
                      >
                        <div>
                          <div className="font-semibold text-[10px]">{item.label}</div>
                        </div>
                        {(preferences.language ? preferences.language === item.id : resolveLang(preferences.language) === item.id) && (
                          <Check className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* 终端字符编码 */}
                <div className="space-y-1.5 pt-2 border-t border-white/5">
                  <label className="font-medium text-slate-300 flex items-center gap-2 mb-1.5">
                    <Type className="w-4 h-4 text-emerald-400" />
                    <span>{t('settings.encoding')}</span>
                  </label>
                  <div className="flex items-center gap-3">
                    {[
                      { id: 'UTF-8', name: `UTF-8 (${t('settings.encodingRec')})` },
                      { id: 'GBK', name: `GBK / GB2312 (${t('settings.encodingLegacy')})` },
                      { id: 'ISO-8859-1', name: `ISO-8859-1 (${t('settings.encodingWestern')})` },
                    ].map((enc) => (
                      <button
                        key={enc.id}
                        onClick={() => onUpdatePreference('terminalEncoding', enc.id as any)}
                        className={`px-2 py-1 rounded-lg border text-[10px] transition-colors flex-1 text-left ${
                          preferences.terminalEncoding === enc.id
                            ? 'bg-emerald-500/15 border-emerald-500 text-white font-medium'
                            : 'border-white/10 bg-black/20 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <div className="font-mono font-semibold">{enc.id}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 时间与日期格式 */}
                <div className="space-y-1.5 pt-2 border-t border-white/5">
                  <label className="font-medium text-slate-300 flex items-center gap-2 mb-1.5">
                    <Activity className="w-4 h-4 text-amber-400" />
                    <span>{t('settings.timeFormat')}</span>
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: '24h', label: t('settings.time24'), preview: '14:35:28' },
                      { id: '12h', label: t('settings.time12'), preview: '02:35:28 PM' },
                      { id: 'ISO', label: t('settings.timeIso'), preview: '2026-09-16 14:35' },
                    ].map((fmt) => (
                      <div
                        key={fmt.id}
                        onClick={() => onUpdatePreference('timeFormat', fmt.id as any)}
                        className={`px-2 py-1 rounded-xl border cursor-pointer transition-all ${
                          preferences.timeFormat === fmt.id
                            ? 'border-amber-500 bg-amber-500/10 text-white'
                            : 'border-white/10 hover:border-white/20 bg-black/20 text-slate-300'
                        }`}
                      >
                        <div className="font-medium text-[10px]">{fmt.label}</div>
                        <div className="font-mono text-[10px] text-amber-400/80 mt-1">{fmt.preview}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 2. 外观与终端 (Appearance) */}
            {activeTab === 'appearance' && (
              <div className="space-y-3 animate-in fade-in duration-150">
                {/* 快速切换预设配色 */}
                <div className="space-y-1.5">
                  <label className="font-medium text-slate-300 flex items-center justify-between mb-1.5">
                    <span className="flex items-center gap-2">
                      <Palette className="w-4 h-4 text-sky-400" />
                      <span>{t('settings.palette')}</span>
                    </span>
                    <span className="text-[10px] text-sky-400 font-medium">{t('settings.currentTheme', { name: `${theme.nameCn} (${theme.name})` })}</span>
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {themes.map((th) => (
                      <div
                        key={th.id}
                        onClick={() => onSelectTheme(th)}
                        className={`px-2 py-1 rounded-xl border cursor-pointer transition-all ${
                          theme.id === th.id
                            ? 'border-sky-400 bg-white/10 ring-1 ring-sky-400/30'
                            : 'border-white/10 hover:border-white/20 bg-black/20'
                        }`}
                      >
                          <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold text-[10px] text-slate-100">{th.nameCn}</span>
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: th.accentPrimary }} />
                        </div>
                        <div className="flex items-center gap-1">
                          <div className="w-3.5 h-3.5 rounded" style={{ backgroundColor: th.bgBase }} />
                          <div className="w-3.5 h-3.5 rounded" style={{ backgroundColor: th.bgSurface }} />
                          <div className="w-3.5 h-3.5 rounded" style={{ backgroundColor: th.accentPrimary }} />
                          <div className="w-3.5 h-3.5 rounded" style={{ backgroundColor: th.accentSuccess }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 终端等宽字体 */}
                <div className="space-y-1.5 pt-2 border-t border-white/5">
                  <label className="font-medium text-slate-300 flex items-center gap-2 mb-1.5">
                    <Type className="w-4 h-4 text-emerald-400" />
                    <span>{t('settings.terminalFont')}</span>
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {['Fira Code', 'JetBrains Mono', 'SF Mono', 'Menlo', 'Cascadia Code'].map((font) => (
                      <button
                        key={font}
                        onClick={() => onUpdatePreference('fontFamily', font)}
                        className={`px-2 py-1 rounded-lg border text-[10px] font-mono transition-colors text-left ${
                          preferences.fontFamily === font
                            ? 'bg-emerald-500/15 border-emerald-400 text-white font-bold'
                            : 'border-white/10 bg-black/20 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <div className="truncate">{font}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 字体大小与行高 */}
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-white/5">
                  {/* 字号 */}
                  <div className="space-y-1.5">
                    <label className="font-medium text-slate-300">{t('settings.fontSize')}</label>
                    <div className="flex items-center gap-1.5">
                      {[12, 13, 14, 15, 16, 18].map((sz) => (
                        <button
                          key={sz}
                          onClick={() => onUpdatePreference('fontSize', sz)}
                          className={`flex-1 py-1 rounded-md border font-mono text-[11px] transition-colors ${
                            preferences.fontSize === sz
                              ? 'bg-sky-500/20 text-white font-bold border-sky-400'
                              : 'border-white/10 bg-black/20 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {sz}px
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 行高 */}
                  <div className="space-y-1.5">
                    <label className="font-medium text-slate-300">{t('settings.lineHeight')}</label>
                    <div className="flex items-center gap-1.5">
                      {[
                        { val: 1.4, label: `1.4 ${t('settings.lhCompact')}` },
                        { val: 1.6, label: `1.6 ${t('settings.lhNormal')}` },
                        { val: 1.8, label: `1.8 ${t('settings.lhLoose')}` },
                      ].map((lh) => (
                        <button
                          key={lh.val}
                          onClick={() => onUpdatePreference('lineHeight', lh.val)}
                          className={`flex-1 py-1 rounded-md border text-[11px] transition-colors ${
                            preferences.lineHeight === lh.val
                              ? 'bg-sky-500/20 text-white font-bold border-sky-400'
                              : 'border-white/10 bg-black/20 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {lh.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 光标样式 */}
                <div className="space-y-1.5 pt-2 border-t border-white/5">
                  <label className="font-medium text-slate-300 flex items-center justify-between mb-1.5">
                    <span className="flex items-center gap-2">
                      <Monitor className="w-4 h-4 text-purple-400" />
                      <span>{t('settings.cursor')}</span>
                    </span>
                    <label className="flex items-center gap-2 text-[10px] cursor-pointer text-slate-400 hover:text-slate-200">
                      <input
                        type="checkbox"
                        checked={preferences.cursorBlink}
                        onChange={(e) => onUpdatePreference('cursorBlink', e.target.checked)}
                        className="rounded text-sky-500 focus:ring-0"
                      />
                      <span>{t('settings.cursorBlink')}</span>
                    </label>
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'block', label: t('settings.cursorBlock'), sub: '' },
                      { id: 'line', label: t('settings.cursorBeam'), sub: '' },
                      { id: 'underline', label: t('settings.cursorUnderline'), sub: '' },
                    ].map((cur) => (
                      <div
                        key={cur.id}
                        onClick={() => onUpdatePreference('cursorStyle', cur.id as any)}
                        className={`px-2 py-1 rounded-xl border cursor-pointer transition-all ${
                          preferences.cursorStyle === cur.id
                            ? 'border-purple-500 bg-purple-500/10 text-white font-semibold'
                            : 'border-white/10 bg-black/20 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <div className="text-[10px]">{cur.label}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 视觉降噪与底纹 */}
                <div className="space-y-1.5 pt-2 border-t border-white/5">
                  <label className="font-medium text-slate-300 flex items-center gap-2 mb-1.5">
                    <Eye className="w-4 h-4 text-amber-400" />
                    <span>{t('settings.visual')}</span>
                  </label>
                  <div className="space-y-1.5">
                    <label className="flex items-center justify-between px-2 py-1 rounded-xl border border-white/5 bg-black/20 cursor-pointer">
                      <div>
                        <div className="text-slate-200 font-medium">{t('settings.gridOn')}</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={preferences.showGrid}
                        onChange={(e) => onUpdatePreference('showGrid', e.target.checked)}
                        className="rounded text-sky-500 focus:ring-0 w-4 h-4"
                      />
                    </label>

                    <label className="flex items-center justify-between px-2 py-1 rounded-xl border border-white/5 bg-black/20 cursor-pointer">
                      <div>
                        <div className="text-slate-200 font-medium">{t('settings.watermarkOn')}</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={preferences.showWatermark}
                        onChange={(e) => onUpdatePreference('showWatermark', e.target.checked)}
                        className="rounded text-sky-500 focus:ring-0 w-4 h-4"
                      />
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* 3. 快捷命令与键位 (Shortcuts) */}
            {activeTab === 'shortcuts' && (
              <div className="space-y-3 animate-in fade-in duration-150">
                {/* 智能指令设置 */}
                <div className="space-y-1.5">
                  <label className="font-medium text-slate-300 flex items-center gap-2 mb-1.5">
                    <Sparkles className="w-4 h-4 text-purple-400" />
                    <span>{t('settings.cmdIntelligence')}</span>
                  </label>
                  <div className="space-y-1.5">
                    <label className="flex items-center justify-between px-2 py-1 rounded-xl border border-white/5 bg-black/20 cursor-pointer">
                      <div>
                        <div className="text-slate-200 font-medium">{t('settings.fuzzySearch')}</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={preferences.fuzzySearch}
                        onChange={(e) => onUpdatePreference('fuzzySearch', e.target.checked)}
                        className="rounded text-sky-500 focus:ring-0 w-4 h-4"
                      />
                    </label>

                    <label className="flex items-center justify-between px-2 py-1 rounded-xl border border-white/5 bg-black/20 cursor-pointer">
                      <div>
                        <div className="text-slate-200 font-medium">{t('settings.autoSuggest')}</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={preferences.autoSuggestHistory}
                        onChange={(e) => onUpdatePreference('autoSuggestHistory', e.target.checked)}
                        className="rounded text-sky-500 focus:ring-0 w-4 h-4"
                      />
                    </label>
                  </div>
                </div>

                {/* 全局快捷键映射清单 */}
                <div className="space-y-1.5 pt-2 border-t border-white/5">
                  <label className="font-medium text-slate-300 flex items-center gap-2 mb-1.5">
                    <Keyboard className="w-4 h-4 text-sky-400" />
                    <span>{t('settings.keymap')}</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2 font-mono">
                    {[
                      { name: t('settings.keyPalette'), key: '⌘ K / Ctrl+K' },
                      { name: t('settings.keyCopilot'), key: '⌘ I / Ctrl+I' },
                      { name: t('settings.keyNewTab'), key: '⌘ T / Ctrl+T' },
                      { name: t('settings.keyCloseTab'), key: '⌘ W / Ctrl+W' },
                      { name: t('settings.keySplit'), key: '⌘ D / Ctrl+D' },
                      { name: t('settings.keySftp'), key: '⌘ B / Ctrl+B' },
                      { name: t('settings.keyClear'), key: 'Ctrl+L' },
                      { name: t('settings.keyPrefs'), key: '⌘ , / Ctrl+,' },
                      { name: t('settings.keyZen'), key: 'F11 / ⌘M' },
                      { name: t('settings.keyHistory'), key: '↑ (Arrow Up)' },
                    ].map((sc) => (
                      <div 
                        key={sc.name}
                        className="flex items-center justify-between px-2 py-1 rounded-xl border border-white/5 bg-black/20 text-[10px]"
                      >
                        <span className="text-slate-300 font-sans truncate mr-2">{sc.name}</span>
                        <kbd className="px-2 py-0.5 rounded bg-white/10 text-sky-300 font-bold border border-white/10 text-[9px] shrink-0">
                          {sc.key}
                        </kbd>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 4. 左侧菜单显示开关 (Sidebar Menu Switches) */}
            {activeTab === 'sidebar' && (
              <div className="space-y-3 animate-in fade-in duration-150">
                {/* 模块显示/隐藏开关列表 */}
                <div className="space-y-1.5">
                  <label className="font-medium text-slate-300 flex items-center gap-2 mb-1.5">
                    <LayoutGrid className="w-4 h-4 text-sky-400" />
                    <span>{t('settings.navVisibility')}</span>
                  </label>
                  <div className="space-y-1.5">
                    {[
                      { 
                        key: 'hosts', 
                        label: t('sidebar.hosts'),
                        icon: Server, 
                        color: 'text-sky-400' 
                      },
                      { 
                        key: 'sftp', 
                        label: t('sidebar.sftp'),
                        icon: FolderTree, 
                        color: 'text-amber-400' 
                      },
                      { 
                        key: 'snippets', 
                        label: t('sidebar.snippets'),
                        icon: Bookmark, 
                        color: 'text-emerald-400' 
                      },
                      {
                        key: 'ai',
                        label: t('sidebar.ai'),
                        icon: Sparkles,
                        color: 'text-purple-400'
                      },
                      {
                        key: 'test',
                        label: t('test.title'),
                        icon: FlaskConical,
                        color: 'text-cyan-400'
                      },
                      {
                        key: 'monitor',
                        label: t('sidebar.monitor'),
                        icon: Activity,
                        color: 'text-rose-400'
                      },
                    ].map((item) => {
                      const Icon = item.icon;
                      const isVisible = preferences.sidebarVisibleItems[item.key as keyof typeof preferences.sidebarVisibleItems];

                      return (
                        <div
                          key={item.key}
                          onClick={() => {
                            onUpdatePreference('sidebarVisibleItems', {
                              ...preferences.sidebarVisibleItems,
                              [item.key]: !isVisible,
                            });
                          }}
                          className={`flex items-center justify-between px-2 py-1 rounded-xl border cursor-pointer transition-all ${
                            isVisible ? '' : 'border-dashed'
                          }`}
                          style={{
                            backgroundColor: isVisible ? theme.bgInput : 'transparent',
                            borderColor: isVisible ? theme.borderSubtle : theme.borderSubtle,
                            opacity: isVisible ? 1 : 0.62,
                          }}
                        >
                          <div className="flex items-center gap-2.5">
                            <div
                              className="p-1.5 rounded-lg shrink-0"
                              style={{ backgroundColor: theme.bgActive }}
                            >
                              <Icon className={`w-4 h-4 ${item.color}`} />
                            </div>
                            <div className="text-slate-200 font-semibold text-[11px] flex items-center gap-1.5">
                              <span>{item.label}</span>
                              {isVisible ? (
                                <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-emerald-500/15 text-emerald-500 font-medium leading-none py-0.5">{t('settings.visible')}</span>
                              ) : (
                                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-500/15 text-slate-400 leading-none">{t('settings.hidden')}</span>
                              )}
                            </div>
                          </div>

                          {/* Switch Toggle */}
                          <div
                            className="w-9 h-5 rounded-full p-0.5 transition-colors relative flex items-center shrink-0"
                            style={{ backgroundColor: isVisible ? theme.accentSuccess : theme.borderHover }}
                          >
                            <div
                              className="w-4 h-4 rounded-full shadow-sm transition-transform"
                              style={{
                                backgroundColor: '#FFFFFF',
                                transform: isVisible ? 'translateX(16px)' : 'translateX(0)',
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 侧边栏布局偏好 */}
                <div className="space-y-1.5 pt-2 border-t border-white/5">
                  <label className="font-medium text-slate-300 flex items-center gap-2 mb-1.5">
                    <Sliders className="w-4 h-4 text-purple-400" />
                    <span>{t('settings.compactMode')}</span>
                  </label>
                  <label className="flex items-center justify-between px-2 py-1 rounded-xl border border-white/5 bg-black/20 cursor-pointer">
                    <div>
                      <div className="text-slate-200 font-medium">{t('settings.compactMode')}</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={preferences.sidebarCompact}
                      onChange={(e) => onUpdatePreference('sidebarCompact', e.target.checked)}
                      className="rounded text-sky-500 focus:ring-0 w-4 h-4"
                    />
                  </label>
                </div>
              </div>
            )}

            {/* 5. 高级功能 (Advanced) */}
            {activeTab === 'advanced' && (
              <div className="space-y-3 animate-in fade-in duration-150">
                {/* AI 接口配置（OpenAI 兼容） */}
                <div className="space-y-1.5 pb-1">
                  <label className="font-medium text-slate-300 flex items-center gap-2 mb-1.5">
                    <Sparkles className="w-4 h-4 text-purple-400" />
                    <span>{t('settings.aiApiConfig')}</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={preferences.aiBaseUrl}
                      onChange={(e) => onUpdatePreference('aiBaseUrl', e.target.value)}
                      placeholder={t('settings.aiBaseUrl')}
                      className="col-span-2 px-2 py-1 rounded bg-black/40 border border-white/10 text-[11px] text-slate-200 outline-none focus:border-sky-400 font-mono"
                    />
                    <input
                      type="password"
                      value={preferences.aiApiKey}
                      onChange={(e) => onUpdatePreference('aiApiKey', e.target.value)}
                      placeholder={t('settings.aiApiKey')}
                      className="px-2 py-1 rounded bg-black/40 border border-white/10 text-[11px] text-slate-200 outline-none focus:border-sky-400"
                    />
                    <input
                      type="text"
                      value={preferences.aiApiModel}
                      onChange={(e) => onUpdatePreference('aiApiModel', e.target.value)}
                      placeholder={t('settings.aiModelName')}
                      className="px-2 py-1 rounded bg-black/40 border border-white/10 text-[11px] text-slate-200 outline-none focus:border-sky-400 font-mono"
                    />
                  </div>
                </div>

                <div className="pt-1 border-t border-white/5" />

                {/* SSH 保活心跳 */}
                <div className="space-y-1.5">
                  <label className="font-medium text-slate-300 flex items-center justify-between mb-1.5">
                    <span className="flex items-center gap-2">
                      <Cpu className="w-4 h-4 text-sky-400" />
                      <span>{t('settings.keepAlive')}</span>
                    </span>
                    <span className="font-mono text-sky-400 font-semibold">{preferences.sshKeepAlive}s</span>
                  </label>
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { val: 0, label: t('settings.keepAliveOff') },
                      { val: 15, label: `15 ${t('settings.secondsHigh')}` },
                      { val: 30, label: `30 ${t('settings.secondsRec')}` },
                      { val: 60, label: `60 ${t('settings.secondsEco')}` },
                    ].map((opt) => (
                      <button
                        key={opt.val}
                        onClick={() => onUpdatePreference('sshKeepAlive', opt.val)}
                        className={`py-1.5 px-2.5 rounded-lg border text-[10px] transition-colors ${
                          preferences.sshKeepAlive === opt.val
                            ? 'bg-sky-500/20 border-sky-400 text-white font-medium'
                            : 'border-white/10 bg-black/20 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 滚屏缓冲区 */}
                <div className="space-y-1.5 pt-2 border-t border-white/5">
                  <label className="font-medium text-slate-300 flex items-center justify-between mb-1.5">
                    <span className="flex items-center gap-2">
                      <Sliders className="w-4 h-4 text-emerald-400" />
                      <span>{t('settings.scrollback')}</span>
                    </span>
                    <span className="font-mono text-emerald-400 font-semibold">{preferences.scrollbackLimit.toLocaleString()} {t('settings.lines')}</span>
                  </label>
                  <div className="grid grid-cols-4 gap-2">
                    {[1000, 5000, 10000, 50000].map((lines) => (
                      <button
                        key={lines}
                        onClick={() => onUpdatePreference('scrollbackLimit', lines)}
                        className={`py-1.5 px-2.5 rounded-lg border text-[10px] font-mono transition-colors ${
                          preferences.scrollbackLimit === lines
                            ? 'bg-emerald-500/20 border-emerald-400 text-white font-bold'
                            : 'border-white/10 bg-black/20 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {lines.toLocaleString()} {t('settings.lines')}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 剪贴板与右键交互 */}
                <div className="space-y-1.5 pt-2 border-t border-white/5">
                  <label className="font-medium text-slate-300 flex items-center gap-2 mb-1.5">
                    <Keyboard className="w-4 h-4 text-amber-400" />
                    <span>{t('settings.interactions')}</span>
                  </label>
                  <div className="space-y-1.5">
                    <label className="flex items-center justify-between px-2 py-1 rounded-xl border border-white/5 bg-black/20 cursor-pointer">
                      <div>
                        <div className="text-slate-200 font-medium">{t('settings.copyOnSelect')}</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={preferences.copyOnSelect}
                        onChange={(e) => onUpdatePreference('copyOnSelect', e.target.checked)}
                        className="rounded text-sky-500 focus:ring-0 w-4 h-4"
                      />
                    </label>

                    <label className="flex items-center justify-between px-2 py-1 rounded-xl border border-white/5 bg-black/20 cursor-pointer">
                      <div>
                        <div className="text-slate-200 font-medium">{t('settings.pasteOnRightClick')}</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={preferences.pasteOnRightClick}
                        onChange={(e) => onUpdatePreference('pasteOnRightClick', e.target.checked)}
                        className="rounded text-sky-500 focus:ring-0 w-4 h-4"
                      />
                    </label>

                    <label className="flex items-center justify-between px-2 py-1 rounded-xl border border-white/5 bg-black/20 cursor-pointer">
                      <div>
                        <div className="text-slate-200 font-medium">{t('settings.autoReconnect')}</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={preferences.autoReconnect}
                        onChange={(e) => onUpdatePreference('autoReconnect', e.target.checked)}
                        className="rounded text-sky-500 focus:ring-0 w-4 h-4"
                      />
                    </label>
                  </div>
                </div>

                {/* AI 智能副驾引擎 */}
                <div className="space-y-1.5 pt-2 border-t border-white/5">
                  <label className="font-medium text-slate-300 flex items-center gap-2 mb-1.5">
                    <Sparkles className="w-4 h-4 text-purple-400" />
                    <span>{t('settings.aiModel')}</span>
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'gemini-2.0', name: 'Google Gemini 2.0 Flash', sub: t('settings.aiFast') },
                      { id: 'gemini-1.5', name: 'Google Gemini 1.5 Pro', sub: t('settings.aiComplex') },
                      { id: 'local-ollama', name: 'Local Ollama Engine', sub: t('settings.aiLocal') },
                    ].map((model) => (
                      <div
                        key={model.id}
                        onClick={() => onUpdatePreference('aiModel', model.name)}
                        className={`px-2 py-1 rounded-xl border cursor-pointer transition-all ${
                          preferences.aiModel.includes(model.id.split('-')[0]) || preferences.aiModel === model.name
                            ? 'border-purple-400 bg-purple-500/10 text-white'
                            : 'border-white/10 bg-black/20 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <div className="font-semibold text-[10px] text-slate-100">{model.name}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 6. 安全与备份 (Security) */}
            {activeTab === 'security' && (
              <div className="space-y-3 animate-in fade-in duration-150">
                {/* 会话关闭保护 */}
                <div className="space-y-1.5">
                  <label className="font-medium text-slate-300 flex items-center gap-2 mb-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span>{t('settings.operationGuard')}</span>
                  </label>
                  <label className="flex items-center justify-between px-2 py-1 rounded-xl border border-white/5 bg-black/20 cursor-pointer">
                    <div>
                      <div className="text-slate-200 font-medium">{t('settings.warnOnClose')}</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={preferences.warnOnCloseSession}
                      onChange={(e) => onUpdatePreference('warnOnCloseSession', e.target.checked)}
                      className="rounded text-sky-500 focus:ring-0 w-4 h-4"
                    />
                  </label>
                </div>

                {/* 密钥存储状态 */}
                <div className="space-y-1.5 pt-2 border-t border-white/5">
                  <label className="font-medium text-slate-300 flex items-center gap-2 mb-1.5">
                    <ShieldCheck className="w-4 h-4 text-sky-400" />
                    <span>{t('settings.keyStatus')}</span>
                  </label>
                  <div 
                    className="px-2.5 py-1.5 rounded-lg border flex items-center justify-between"
                    style={{
                      backgroundColor: theme.bgInput,
                      borderColor: theme.borderSubtle,
                    }}
                  >
                    <div>
                      <div className="font-semibold text-[11px] text-slate-200 flex items-center gap-2">
                        <span>{t('settings.keyName')}</span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-medium">{t('settings.keyProtected')}</span>
                      </div>
                      <div className="font-mono text-[10px] text-slate-400 mt-1">
                        Fingerprint: SHA256:8yN4k9+B2xXp...deploy@prod-cluster
                      </div>
                    </div>
                  </div>
                </div>

                {/* 配置导入与导出 */}
                <div className="space-y-1.5 pt-2 border-t border-white/5">
                  <label className="font-medium text-slate-300 flex items-center gap-2 mb-1.5">
                    <Download className="w-4 h-4 text-purple-400" />
                    <span>{t('settings.configBackup')}</span>
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={handleExportConfig}
                      className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-colors text-[10px] font-semibold text-slate-200 hover:bg-white/10"
                      style={{ backgroundColor: theme.bgInput, borderColor: theme.borderSubtle }}
                    >
                      <Download className="w-3.5 h-3.5 text-sky-400" />
                      <span>{t('settings.exportPrefs')}</span>
                    </button>

                    <button
                      onClick={() => {
                        onResetPreferences();
                        setCopiedNotification(t('settings.resetDone'));
                        setTimeout(() => setCopiedNotification(null), 2500);
                      }}
                      className={`flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-rose-500/40 hover:border-rose-500 hover:bg-rose-500/20 text-[10px] font-semibold transition-colors ${
                        theme.light ? 'text-rose-700 bg-rose-500/10' : 'text-rose-300 bg-rose-500/10'
                      }`}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>{t('settings.resetToDefaults')}</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
            {/* 7. 主机书签管理 (Bookmarks) */}
            {activeTab === 'about' && <AboutTab theme={theme} />}

            {activeTab === 'bookmarks' && (() => {
              const groupOptions = Array.from(
                new Set(['Production', 'Staging', 'Test', ...hosts.map((h) => h.group)]),
              ) as ConnectionHost['group'][];
              return (
                <div className="space-y-4 animate-in fade-in duration-150">
                  <div>
                    <p className="text-slate-400 text-[10px]">{t('bookmarks.sub')}</p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-medium text-slate-300 flex items-center gap-2 mb-1.5">
                      <Bookmark className="w-4 h-4 text-sky-400" />
                      <span>{t('bookmarks.all', { count: hosts.length })}</span>
                    </label>

                    {hosts.length === 0 ? (
                      <div className="p-6 rounded-xl border border-dashed border-white/10 bg-black/20 text-center space-y-1.5">
                        <div className="text-slate-400 text-[11px]">{t('bookmarks.empty')}</div>
                        <div className="text-slate-500 text-[10px]">{t('bookmarks.emptyHint')}</div>
                      </div>
                    ) : (
                      hosts.map((h) => (
                        <div
                          key={h.id}
                          className="flex items-center justify-between gap-2 p-2.5 rounded-xl border border-white/5 bg-black/20"
                        >
                          <div className="min-w-0">
                            <div className="text-[11px] text-slate-200 font-medium truncate">{h.name}</div>
                            <div className="text-[10px] text-slate-500 font-mono truncate mt-0.5">
                              {h.user}@{h.host}:{h.port}
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <select
                              value={h.group}
                              onChange={(e) => onUpdateHostGroup(h.id, e.target.value as ConnectionHost['group'])}
                              className="px-2 py-1 rounded bg-black/40 border border-white/10 text-slate-200 outline-none text-[10px]"
                              title={t('settings.switchGroup')}
                            >
                              {groupOptions.map((g) => (
                                <option key={g} value={g}>{g}</option>
                              ))}
                            </select>
                            <button
                              onClick={() => void onConnectHost(h)}
                              title={`${t('palette.connectHost', { name: h.name })}`}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-sky-300 hover:bg-white/10 transition-colors"
                            >
                              <Server className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })()}

            {/* 8. 数据与存储 (Storage) */}
            {activeTab === 'storage' && (
              <StorageTab
                theme={theme}
                onClearStoredCredentials={onClearStoredCredentials}
                onResetDatabase={onResetDatabase}
              />
            )}

            {/* 9. MCP 服务 (External AI tools via stdio) */}
            {activeTab === 'mcp' && (
              <McpTab theme={theme} preferences={preferences} onUpdatePreference={onUpdatePreference} />
            )}
          </div>
        </div>

        {/* Bottom Footer */}
        <div 
          className="flex items-center justify-between px-3 py-1.5 shrink-0 select-none"
          style={{
            backgroundColor: theme.bgBase,
            borderColor: theme.borderSubtle,
          }}
        >
          {/* Status feedback */}
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            {copiedNotification && (
              <span className="text-emerald-400 font-medium flex items-center gap-1.5 animate-in fade-in">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {copiedNotification}
              </span>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => {
                onResetPreferences();
                setCopiedNotification(t('settings.resetToast'));
                setTimeout(() => setCopiedNotification(null), 2000);
              }}
              className="px-3 py-1 rounded-md border border-white/10 hover:bg-white/5 text-slate-400 hover:text-slate-200 text-[11px] font-medium transition-colors"
            >
              {t('settings.resetDefaults')}
            </button>
            <button
              onClick={onClose}
              className="px-5 py-1 rounded-md text-[11px] font-semibold text-slate-950 transition-all hover:opacity-90 shadow-md"
              style={{ backgroundColor: theme.accentPrimary }}
            >
              {t('settings.finish')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
