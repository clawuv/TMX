import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { ShieldAlert } from 'lucide-react';
import type { ConnectionHost, TabItem, TabContentType, TerminalLine, ThemeConfig, QuickSnippet, UserPreferences, SettingTabId, MonitorTarget } from './types';
import { DEFAULT_PREFERENCES } from './types';
import { THEMES } from './data/themes';
import { INITIAL_HOSTS, INITIAL_TABS, INITIAL_SNIPPETS } from './data/mockData';
import { simulateCommandOutput } from './utils/commandSimulator';

import { TitleBar } from './components/TitleBar';
import type { SidebarNavId } from './components/Sidebar';
import { Sidebar } from './components/Sidebar';
import { TerminalCanvas } from './components/TerminalCanvas';
import { RealTerminal } from './components/RealTerminal';
import { SFTPDrawer } from './components/SFTPDrawer';
import { SystemMonitor } from './components/SystemMonitor';
import { CommandPalette } from './components/CommandPalette';
import { PaletteDesignModal } from './components/PaletteDesignModal';
import { HostDrawer } from './components/HostDrawer';
import { AICopilotDrawer } from './components/AICopilotDrawer';
import { SnippetsDrawer } from './components/SnippetsDrawer';
import { TestDrawer } from './components/TestDrawer';
import { SettingsModal } from './components/SettingsModal';
import { StatusBar } from './components/StatusBar';
import { I18nProvider, useI18n } from './i18n/context';
import { ResizableDock } from './components/ResizableDock';
import { onMenuAction, setWindowTitle, type MenuAction } from './utils/desktop';
import { initUpdateBridge, silentUpdateCheck } from './utils/updateState';
import { useNativeContextMenu } from './utils/useNativeContextMenu';

// Docked drawer width: percentage of window width (≈320px on a 1920 screen),
// clamped by ResizableDock. Persisted so the chosen size survives restarts.
const DEFAULT_DOCK_WIDTH_PCT = () => (240 / window.innerWidth) * 100;
// v3: narrower 240px default; bump so previously saved widths don't mask it
const DOCK_WIDTH_STORAGE_KEY = 'tmx_dock_width_pct_v3';
// Test drawer is a tool palette — same 240px default as the other drawers.
const DEFAULT_TEST_DOCK_WIDTH_PCT = () => (240 / window.innerWidth) * 100;
const TEST_DOCK_WIDTH_STORAGE_KEY = 'tmx_test_dock_width_pct_v2';

// Unified drawer visual layout for modern minimalist alignment.
// Width is owned by the ResizableDock wrapper (min 280px, user-draggable,
// scales with the window); drawers just fill it.
const DOCKED_LEFT_DRAWER_CLASS = "flex-1 min-w-0 h-full flex flex-col border-r select-none transition-colors duration-150 z-20";
const DOCKED_RIGHT_DRAWER_CLASS = "w-[320px] shrink-0 h-full flex flex-col border-l select-none transition-colors duration-150 z-20";

const IN_ELECTRON = typeof window !== 'undefined' && typeof window.ipcRenderer !== 'undefined';
const LOCAL_TERMINAL_LABEL = 'user@localhost';

// Groups removed in later versions, mapped onto their successors at load time.
const LEGACY_GROUP_MAP: Record<string, string> = { 'Cloud Edge': 'Production', Homelab: 'Test' };
const foldLegacyGroup = (h: ConnectionHost): ConnectionHost => ({
  ...h,
  group: LEGACY_GROUP_MAP[h.group] ?? h.group,
});

// Neutral stand-ins used only in the brief window before the first tab exists
// or when no host is selected — never sample/mock content.
const NO_HOST: ConnectionHost = {
  id: '__none__',
  name: '',
  host: '',
  user: '',
  port: 0,
  group: 'Production',
  tag: '',
  status: 'offline',
  pingMs: 0,
  cpuLoad: 0,
  memLoad: 0,
  diskLoad: 0,
  os: 'Ubuntu 24.04 LTS',
  fingerprint: '',
  authMethod: 'Password',
};
const PLACEHOLDER_TAB: TabItem = {
  id: '__none__',
  hostId: '__none__',
  title: '',
  hostName: '',
  userHost: '',
  contentType: 'terminal',
  status: 'disconnected',
};

interface TerminalSessionInfo {
  sessionId: string;
  kind: 'local' | 'ssh';
  /** Set when the underlying process/stream closed; the pane shows a reconnect overlay. */
  exited?: boolean;
}

export default function App() {
  // Theme state: persisted in localStorage, defaults to Nordic Slate (the recommended minimalist cool grey palette)
  const [currentTheme, setCurrentTheme] = useState<ThemeConfig>(() => {
    try {
      const savedId = localStorage.getItem('tmx_theme');
      const saved = THEMES.find((t) => t.id === savedId);
      if (saved) return saved;
    } catch {}
    return THEMES[0];
  });
  // SQLite ready gate: sync effects only push after the initial db:get-all
  // finished (and seeded/migrated), so we never clobber the store with defaults.
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem('tmx_theme', currentTheme.id);
    } catch {}
    if (IN_ELECTRON && dbReady) {
      void window.ipcRenderer.invoke('db:save-theme', currentTheme.id).catch(() => {});
    }
  }, [currentTheme, dbReady]);

  // Match both the page backing surface and native window to the active theme.
  useEffect(() => {
    document.documentElement.style.backgroundColor = currentTheme.bgBase;
    document.body.style.backgroundColor = currentTheme.bgBase;
    document.documentElement.style.colorScheme = currentTheme.light ? 'light' : 'dark';
    if (!IN_ELECTRON) return;
    window.ipcRenderer
      .invoke('set-titlebar-overlay', {
        color: currentTheme.bgSurface,
        symbolColor: currentTheme.textSecondary,
        backgroundColor: currentTheme.bgBase,
        light: Boolean(currentTheme.light),
      })
      .catch(() => {});
  }, [currentTheme]);

  // Tabs / hosts / snippets: empty on first launch in the packaged app — mock
  // sample data is only used by the browser preview (dev server / e2e).
  const [tabs, setTabs] = useState<TabItem[]>(IN_ELECTRON ? [] : INITIAL_TABS);
  const [activeTabId, setActiveTabId] = useState<string>(IN_ELECTRON ? '' : INITIAL_TABS[0]?.id ?? '');

  // Hosts state: hydrated from SQLite after bootstrap (falls back to defaults)
  const [hosts, setHosts] = useState<ConnectionHost[]>(IN_ELECTRON ? [] : INITIAL_HOSTS);
  const [snippets, setSnippets] = useState<QuickSnippet[]>(IN_ELECTRON ? [] : INITIAL_SNIPPETS);

  // Bootstrap from SQLite: hydrate, then seed empty tables / migrate localStorage.
  useEffect(() => {
    if (!IN_ELECTRON) return;
    (async () => {
      try {
        const data = (await window.ipcRenderer.invoke('db:get-all')) as {
          hosts: ConnectionHost[] | null;
          snippets: QuickSnippet[] | null;
          preferences: UserPreferences | null;
          themeId: string | null;
          snippetsSeeded?: boolean;
        };
        if (data.hosts && data.hosts.length > 0) {
          // 'Cloud Edge'/'Homelab' were removed as categories — fold into their successors
          setHosts(data.hosts.map(foldLegacyGroup));
        } else {
          // migrate hosts from the interim localStorage store, if any
          try {
            const saved = JSON.parse(localStorage.getItem('tmx_hosts') || '[]');
            if (Array.isArray(saved) && saved.length > 0) {
              setHosts(saved.map(foldLegacyGroup));
            }
          } catch {}
        }
        if (data.snippets && data.snippets.length > 0) {
          // Categories became OS-based (Linux/Mac/Windows); fold legacy
          // type-based categories (System/Network/Logs) into Linux on load.
          setSnippets(data.snippets.map((s) => ({
            ...s,
            category: s.category === 'Mac' || s.category === 'Windows' ? s.category : 'Linux',
          })));
        } else if (!data.snippetsSeeded) {
          // First launch only: seed the built-in sample snippets so the panel
          // is not empty. Afterwards an intentionally emptied list stays empty.
          setSnippets(INITIAL_SNIPPETS);
          void window.ipcRenderer.invoke('db:set-app-state', 'snippets_seeded', '1').catch(() => {});
        }
        let prefs = data.preferences;
        if (!prefs) {
          // one-time migration from the previous localStorage store
          try {
            const saved = localStorage.getItem('tmx_user_prefs');
            if (saved) prefs = { ...DEFAULT_PREFERENCES, ...JSON.parse(saved) };
          } catch {}
        }
        if (prefs) setPreferences({ ...DEFAULT_PREFERENCES, ...prefs });
        let themeId = data.themeId;
        if (!themeId) themeId = localStorage.getItem('tmx_theme');
        if (themeId) {
          const savedTheme = THEMES.find((t) => t.id === themeId);
          if (savedTheme) setCurrentTheme(savedTheme);
        }
      } catch (err) {
        console.error('[db] load failed:', err);
      } finally {
        setDbReady(true);
      }
    })();
  }, []);

  // Persist hosts/bookmarks whenever they change (also seeds an empty DB once ready)
  useEffect(() => {
    if (!IN_ELECTRON || !dbReady) return;
    void window.ipcRenderer.invoke('db:save-hosts', hosts).catch((err) =>
      console.error('[db] save hosts failed:', err),
    );
  }, [hosts, dbReady]);

  useEffect(() => {
    if (!IN_ELECTRON || !dbReady) return;
    void window.ipcRenderer.invoke('db:save-snippets', snippets).catch((err) =>
      console.error('[db] save snippets failed:', err),
    );
  }, [snippets, dbReady]);

  const { t } = useI18n()

  // ── Host bookmarks (favorites with explicit order) ──
  const handleToggleHostBookmark = (id: string) => {
    setHosts((prev) => {
      if (prev.find((h) => h.id === id)?.favorite) {
        return prev.map((h) => (h.id === id ? { ...h, favorite: false, sortIndex: undefined } : h));
      }
      const maxSort = prev.reduce((m, h) => Math.max(m, h.sortIndex ?? 0), 0);
      return prev.map((h) => (h.id === id ? { ...h, favorite: true, sortIndex: maxSort + 1 } : h));
    });
  };

  const handleUpdateHostGroup = (id: string, group: ConnectionHost['group']) => {
    setHosts((prev) => prev.map((h) => (h.id === id ? { ...h, group } : h)));
  };

  const handleClearStoredCredentials = async () => {
    await window.ipcRenderer.invoke('db:clear-credentials');
    setHosts((prev) => prev.map((h) => ({ ...h, password: undefined, passphrase: undefined })));
  };

  const handleResetDatabase = async () => {
    await window.ipcRenderer.invoke('db:reset');
    setHosts(IN_ELECTRON ? [] : INITIAL_HOSTS);
    setSnippets(IN_ELECTRON ? [] : INITIAL_SNIPPETS);
    setPreferences(DEFAULT_PREFERENCES);
  };

  // Active navigation drawer
  const [activeSidebarNav, setActiveSidebarNav] = useState<SidebarNavId | null>(null);

  // Modals & Panels
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isPaletteModalOpen, setIsPaletteModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingTabId>('appearance');
  const openSettings = (tab: SettingTabId = 'appearance') => {
    setSettingsInitialTab(tab);
    setIsSettingsOpen(true);
  };
  const [isSplitPane, setIsSplitPane] = useState(false);
  const [isZenMode, setIsZenMode] = useState(false);
  const [dockedSftpOpen, setDockedSftpOpen] = useState(false);
  // Pin semantics: drawers open unpinned (collapsible from the sidebar); clicking
  // the pin fixes a drawer so the sidebar icon and ⌘-shortcuts can no longer collapse it.
  const [drawerPinned, setDrawerPinned] = useState(false);

  // Which host the monitor view is bound to (set from the Hosts drawer cards)
  const [monitorHostId, setMonitorHostId] = useState<string | null>(null);

  // Session log recording: which sessionIds currently write output logs
  const [recordingSessions, setRecordingSessions] = useState<Record<string, string>>({});
  const [logToast, setLogToast] = useState<string | null>(null);

  useEffect(() => {
    if (!IN_ELECTRON) return;
    return window.ipcRenderer.on('terminal-log:state', (...args) => {
      const p = args[0] as { sessionId: string; recording: boolean; path: string | null };
      setRecordingSessions((prev) => {
        const next = { ...prev };
        if (p.recording && p.path) next[p.sessionId] = p.path;
        else delete next[p.sessionId];
        return next;
      });
      if (!p.recording && p.path) {
        setLogToast(t('app.logSaved', { path: p.path }));
        window.setTimeout(() => setLogToast(null), 4000);
      }
    });
  }, []);
  // Latest drawer state for the global keydown handler (avoids stale closures)
  const drawerStateRef = useRef({ activeSidebarNav, dockedSftpOpen, drawerPinned });
  drawerStateRef.current = { activeSidebarNav, dockedSftpOpen, drawerPinned };

  // Docked drawer width (see ResizableDock)
  const [dockWidthPct, setDockWidthPct] = useState<number>(() => {
    try {
      const saved = parseFloat(localStorage.getItem(DOCK_WIDTH_STORAGE_KEY) || '');
      if (!Number.isNaN(saved)) return saved;
    } catch {}
    return DEFAULT_DOCK_WIDTH_PCT();
  });
  useEffect(() => {
    try {
      localStorage.setItem(DOCK_WIDTH_STORAGE_KEY, String(dockWidthPct));
    } catch {}
  }, [dockWidthPct]);
  const resetDockWidth = () => setDockWidthPct(DEFAULT_DOCK_WIDTH_PCT());

  // Test drawer keeps its own narrower width, independent of the shared dock width
  const [testDockWidthPct, setTestDockWidthPct] = useState<number>(() => {
    try {
      const saved = parseFloat(localStorage.getItem(TEST_DOCK_WIDTH_STORAGE_KEY) || '');
      if (!Number.isNaN(saved)) return saved;
    } catch {}
    return DEFAULT_TEST_DOCK_WIDTH_PCT();
  });
  useEffect(() => {
    try {
      localStorage.setItem(TEST_DOCK_WIDTH_STORAGE_KEY, String(testDockWidthPct));
    } catch {}
  }, [testDockWidthPct]);
  const resetTestDockWidth = () => setTestDockWidthPct(DEFAULT_TEST_DOCK_WIDTH_PCT());

  // User Preferences
  const [preferences, setPreferences] = useState<UserPreferences>(() => {
    try {
      const saved = localStorage.getItem('tmx_user_prefs');
      if (saved) return { ...DEFAULT_PREFERENCES, ...JSON.parse(saved) };
    } catch {}
    return DEFAULT_PREFERENCES;
  });

  const handleUpdatePreference = <K extends keyof UserPreferences>(
    key: K, 
    value: UserPreferences[K]
  ) => {
    setPreferences((prev) => {
      const updated = { ...prev, [key]: value };
      try {
        localStorage.setItem('tmx_user_prefs', JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  const handleResetPreferences = () => {
    setPreferences(DEFAULT_PREFERENCES);
    try {
      localStorage.setItem('tmx_user_prefs', JSON.stringify(DEFAULT_PREFERENCES));
    } catch {}
  };

  // ── Real terminal sessions (node-pty / ssh2) ─────────────────────────────
  const [sessions, setSessions] = useState<Record<string, TerminalSessionInfo>>({});
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const bootstrappedRef = useRef(false);

  // Debounced preferences push to SQLite (single JSON row)
  useEffect(() => {
    if (!IN_ELECTRON || !dbReady) return;
    const timer = window.setTimeout(() => {
      void window.ipcRenderer.invoke('db:save-preferences', preferences).catch(() => {});
    }, 300);
    return () => window.clearTimeout(timer);
  }, [preferences, dbReady]);

  // ── MCP bridge: session registry + config sync + confirmation prompt ──
  const [mcpConfirm, setMcpConfirm] = useState<{ reqId: string; tool: string; summary: string } | null>(null);

  // Keep main's session metadata (shown by MCP list_sessions) in sync with tabs.
  useEffect(() => {
    if (!IN_ELECTRON) return;
    const list = Object.entries(sessions).map(([paneId, s]) => {
      const tab = tabs.find((t) => t.id === paneId);
      return {
        sessionId: s.sessionId,
        title: tab?.title ?? (paneId === 'secondary-split' ? t('app.splitPane') : paneId),
        host: tab?.userHost ?? '',
        kind: s.kind,
        active: paneId === activeTabId || (paneId === 'secondary-split' && isSplitPane),
      };
    });
    window.ipcRenderer.send('mcp:sync-sessions', list);
  }, [sessions, tabs, activeTabId, isSplitPane]);

  // Push bridge start/stop when the enable preference flips.
  useEffect(() => {
    if (!IN_ELECTRON || !dbReady) return;
    void window.ipcRenderer.invoke('mcp:apply-config', { enabled: preferences.mcpEnabled }).catch(() => {});
  }, [preferences.mcpEnabled, dbReady]);

  useEffect(() => {
    if (!IN_ELECTRON) return;
    const unsubscribe = window.ipcRenderer.on('mcp:confirm-request', (...args) => {
      setMcpConfirm(args[0] as { reqId: string; tool: string; summary: string });
    });
    return unsubscribe;
  }, []);

  const respondMcpConfirm = (allowed: boolean) => {
    if (!mcpConfirm) return;
    void window.ipcRenderer.invoke('mcp:confirm-response', { reqId: mcpConfirm.reqId, allowed });
    setMcpConfirm(null);
  };

  const createLocalSession = async (paneId: string) => {
    if (!IN_ELECTRON) return;
    try {
      const result = (await window.ipcRenderer.invoke(
        'terminal:create',
        { kind: 'local' },
        { cols: 80, rows: 24 },
      )) as { id: string };
      setSessions((prev) => ({ ...prev, [paneId]: { sessionId: result.id, kind: 'local' } }));
      return result.id;
    } catch (err) {
      console.error('[terminal] local session failed:', err);
      return undefined;
    }
  };

  const createSshSession = async (host: ConnectionHost) => {
    const result = (await window.ipcRenderer.invoke(
      'terminal:create',
      {
        kind: 'ssh',
        host: host.host,
        port: host.port,
        username: host.user,
        password: host.password,
        privateKeyPath: host.privateKeyPath,
        passphrase: host.passphrase,
        keepaliveInterval: preferences.sshKeepAlive,
      },
      { cols: 80, rows: 24 },
    )) as { id: string };
    return result.id;
  };

  const killSession = (sessionId: string) => {
    if (!IN_ELECTRON) return;
    void window.ipcRenderer.invoke('terminal:kill', sessionId);
  };

  // Remote/local process closed on its own: keep the pane mounted (its scrollback
  // holds the "[会话已断开]" message) but flag it dead and mark the tab. Dropping
  // the entry instead would unmount the pane and throw that scrollback away.
  const handleSessionExit = (sessionId: string) => {
    const entry = Object.entries(sessionsRef.current).find(([, s]) => s.sessionId === sessionId);
    if (!entry) return;
    const [paneId] = entry;
    setSessions((prev) =>
      prev[paneId] ? { ...prev, [paneId]: { ...prev[paneId], exited: true } } : prev,
    );
    setTabs((prev) => prev.map((t) => (t.id === paneId ? { ...t, status: 'disconnected' } : t)));
  };

  // Bootstrap: open a single local shell tab (no seeded/mock tabs).
  useEffect(() => {
    if (!IN_ELECTRON || bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    handleNewTab();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Type into the active pane's real session; falls back to the mock canvas
  const runInActiveTerminal = (command: string) => {
    const session = sessionsRef.current[activeTabId];
    if (IN_ELECTRON && session) {
      window.ipcRenderer.send('terminal:input', { id: session.sessionId, data: `${command}\r` });
      return;
    }
    handleExecuteCommand(command);
  };

  // Terminal Lines per tab
  const [terminalLines, setTerminalLines] = useState<Record<string, TerminalLine[]>>({
    'tab-1': [
      {
        id: 'init-1',
        type: 'system',
        content: '本地终端已就绪。'
      }
    ],
    'secondary-split': [
      {
        id: 'split-1',
        type: 'system',
        content: '分屏终端已就绪。'
      }
    ]
    });

  // Current active tab and host
  const [splitHost, setSplitHost] = useState<ConnectionHost | null>(null);
  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0] || PLACEHOLDER_TAB;
  const activeHost = hosts.find((h) => h.id === activeTab.hostId) || hosts[0] || NO_HOST;
  // A local shell tab browses the machine's own filesystem in the SFTP panel.
  const isLocalTab = activeTab.hostId === 'local';

  // ── Monitor target ────────────────────────────────────────────────────────
  // An explicit pick from the Hosts drawer wins; otherwise the monitor follows the
  // active tab, so a local shell reports this machine instead of a random host.
  const localHost = useMemo<ConnectionHost>(
    () => ({
      id: 'local',
      name: t('monitor.localHost'),
      host: 'localhost',
      user: '',
      port: 0,
      group: '',
      tag: '',
      status: 'online',
      pingMs: 0,
      cpuLoad: 0,
      memLoad: 0,
      diskLoad: 0,
      os: '',
      fingerprint: '',
      authMethod: 'Password',
      // The built-in local entry is always a favorite and cannot be unfavorited.
      favorite: true,
    }),
    [t],
  );

  const toSshTarget = useCallback(
    (h: ConnectionHost): MonitorTarget => ({
      kind: 'ssh',
      host: h.host,
      port: h.port,
      username: h.user,
      password: h.password,
      privateKeyPath: h.privateKeyPath,
      passphrase: h.passphrase,
      keepaliveInterval: preferences.sshKeepAlive,
    }),
    [preferences.sshKeepAlive],
  );

  const { monitorHost, monitorTarget } = useMemo(() => {
    // Browser mode has no sampler; SystemMonitor keeps its simulated dashboard.
    if (!IN_ELECTRON) return { monitorHost: activeHost, monitorTarget: null };
    // Explicitly pinned local machine (from the Hosts drawer entry).
    if (monitorHostId === 'local') return { monitorHost: localHost, monitorTarget: { kind: 'local' } as MonitorTarget };
    const pinned = monitorHostId ? hosts.find((h) => h.id === monitorHostId) : undefined;
    if (pinned) return { monitorHost: pinned, monitorTarget: toSshTarget(pinned) };
    if (isLocalTab) return { monitorHost: localHost, monitorTarget: { kind: 'local' } as MonitorTarget };
    return { monitorHost: activeHost, monitorTarget: toSshTarget(activeHost) };
  }, [hosts, monitorHostId, isLocalTab, activeHost, localHost, toSshTarget]);

  // Updater bridge: wire the IPC events once so the sidebar badge and the
  // About tab react to checks, then run one silent check shortly after
  // startup. The badge in the sidebar lights up when a newer release exists
  // (publish in electron-builder.json points at the clawuv/TMX release feed;
  // in dev the check is a guarded no-op because the app is not packaged).
  useEffect(() => {
    initUpdateBridge();
    silentUpdateCheck();
  }, []);

  // Global Keyboard shortcuts (browser fallback). In Electron these are native
  // application-menu accelerators handled via the `menu:action` channel below.
  useEffect(() => {
    if (IN_ELECTRON) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'i') {
        e.preventDefault();
        const { activeSidebarNav: nav, drawerPinned: pinned } = drawerStateRef.current;
        if (nav === 'ai') {
          if (!pinned) setActiveSidebarNav(null);
        } else {
          setActiveSidebarNav('ai');
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key === 't') {
        e.preventDefault();
        handleNewTab();
      } else if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        openSettings();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
        e.preventDefault();
        setIsSplitPane((prev) => !prev);
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        const { activeSidebarNav: nav, dockedSftpOpen: sftpOpen, drawerPinned: pinned } = drawerStateRef.current;
        if (nav === 'sftp' || sftpOpen) {
          if (!pinned) {
            setActiveSidebarNav(null);
            setDockedSftpOpen(false);
          }
        } else {
          setActiveSidebarNav('sftp');
          setDockedSftpOpen(true);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hosts, tabs]);

  // Tab operations
  const handleSelectTab = (id: string) => {
    setActiveTabId(id);
  };

  const handleCloseTab = (id: string) => {
    if (tabs.length <= 1) return;
    const session = sessions[id];
    if (session) {
      killSession(session.sessionId);
      setSessions((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
    const remaining = tabs.filter((t) => t.id !== id);
    setTabs(remaining);
    if (activeTabId === id) {
      setActiveTabId(remaining[0].id);
    }
  };

  const handleNewTab = (targetHost?: ConnectionHost) => {
    const newTabId = `tab-${Date.now()}`;
    // "+" without a host = a plain local shell tab with a stable desktop label.
    const isLocal = !targetHost;
    const host = targetHost || hosts[0];
    const newTab: TabItem = {
      id: newTabId,
      hostId: isLocal ? 'local' : host.id,
      title: isLocal ? LOCAL_TERMINAL_LABEL : `${host.user}@${host.name.split('-')[0]}`,
      hostName: isLocal ? 'local' : host.name,
      userHost: isLocal ? LOCAL_TERMINAL_LABEL : `${host.user}@${host.host}`,
      contentType: 'terminal',
      status: 'connected',
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTabId);

    setTerminalLines((prev) => ({
      ...prev,
      [newTabId]: [
        {
          id: `line-${Date.now()}`,
          type: 'system',
          content: isLocal ? '本地终端已就绪。' : `New session connected to ${host.name} (${host.host}:${host.port})`
        }
      ]
    }));

    void createLocalSession(newTabId);
  };

  const handleCloseOtherTabs = (id: string) => {
    const keep = tabs.find((t) => t.id === id);
    if (!keep) return;
    for (const tab of tabs) {
      if (tab.id !== id) {
        const session = sessions[tab.id];
        if (session) killSession(session.sessionId);
      }
    }
    setSessions((prev) => (prev[id] ? { [id]: prev[id] } : {}));
    setTabs([keep]);
    setActiveTabId(id);
  };

  // Native application-menu accelerators → same behaviour as the browser keydown.
  const menuActionRef = useRef<(action: MenuAction) => void>(() => {});
  menuActionRef.current = (action) => {
    const { activeSidebarNav: nav, dockedSftpOpen: sftpOpen, drawerPinned: pinned } = drawerStateRef.current;
    switch (action) {
      case 'new-tab': handleNewTab(); break;
      case 'close-tab': handleCloseTab(activeTabId); break;
      case 'settings': openSettings(); break;
      case 'command-palette': setIsCommandPaletteOpen((p) => !p); break;
      case 'copilot':
        if (nav === 'ai') { if (!pinned) setActiveSidebarNav(null); } else setActiveSidebarNav('ai');
        break;
      case 'sftp':
        if (nav === 'sftp' || sftpOpen) {
          if (!pinned) { setActiveSidebarNav(null); setDockedSftpOpen(false); }
        } else { setActiveSidebarNav('sftp'); setDockedSftpOpen(true); }
        break;
      case 'split': setIsSplitPane((p) => !p); break;
      case 'zen': setIsZenMode((p) => !p); break;
    }
  };
  useEffect(() => onMenuAction((action) => menuActionRef.current(action)), []);

  // Keep the OS window title in sync with the active connection (taskbar / alt-tab).
  useEffect(() => {
    const label = activeTab?.userHost || activeTab?.title || 'TMX';
    setWindowTitle(`${label} — TMX`);
  }, [activeTab?.userHost, activeTab?.title]);

  // Native right-click menu for plain DOM content (editable fields / selections).
  useNativeContextMenu();

  const handleChangeContentType = (type: TabContentType) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTabId ? { ...t, contentType: type } : t))
    );
  };

  // Execute terminal command
  const handleExecuteCommand = (cmd: string, paneId: string = activeTabId) => {
    if (cmd.toLowerCase() === 'clear') {
      setTerminalLines((prev) => ({
        ...prev,
        [paneId]: []
      }));
      return;
    }

    const echoLine: TerminalLine = {
      id: `cmd-${Date.now()}`,
      type: 'command',
      content: cmd,
      timestamp: new Date().toLocaleTimeString(),
    };

    const outputLines = simulateCommandOutput(cmd, activeHost, () => setIsPaletteModalOpen(true));

    setTerminalLines((prev) => ({
      ...prev,
      [paneId]: [...(prev[paneId] || []), echoLine, ...outputLines]
    }));
  };

  const handleClearTerminal = () => {
    const session = sessionsRef.current[activeTabId];
    if (IN_ELECTRON && session) {
      const isWindowsLocal = session.kind === 'local' && /Windows/.test(navigator.userAgent);
      window.ipcRenderer.send('terminal:input', { id: session.sessionId, data: isWindowsLocal ? 'cls\r' : 'clear\r' });
      return;
    }
    setTerminalLines((prev) => ({
      ...prev,
      [activeTabId]: []
    }));
  };

  // Monitor a specific host from the Hosts drawer; clicking the same host's
  // monitor button again returns the tab to the terminal view.
  const handleMonitorHost = (host: ConnectionHost) => {
    if (activeTab.contentType === 'monitor' && monitorHostId === host.id) {
      setMonitorHostId(null);
      handleChangeContentType('terminal');
      return;
    }
    setMonitorHostId(host.id);
    handleChangeContentType('monitor');
  };

  const handleSelectNav = (nav: SidebarNavId) => {
    if (nav === 'palette') {
      setIsCommandPaletteOpen(true);
      return;
    }
    if (nav === 'monitor') {
      // Monitor follows the active tab's own connection (a local shell monitors
      // this machine), so no drawer opens — the icon just lights up.
      setDockedSftpOpen(false);
      setActiveSidebarNav(null);
      if (activeTab.contentType === 'monitor') {
        handleChangeContentType('terminal');
      } else {
        setMonitorHostId(null);
        handleChangeContentType('monitor');
      }
      return;
    }
    if (nav === 'themes') {
      setIsPaletteModalOpen(true);
      return;
    }
    if (nav === 'settings') {
      openSettings();
      return;
    }
    if (nav === 'sftp') {
      const isOpen = activeSidebarNav === 'sftp' || dockedSftpOpen;
      if (isOpen) {
        // Pinned drawers only collapse after the pin is released
        if (!drawerPinned) {
          setDockedSftpOpen(false);
          setActiveSidebarNav(null);
        }
        return;
      }
      setActiveSidebarNav('sftp');
      setDockedSftpOpen(true);
      return;
    }
    // Toggle drawer (a pinned drawer refuses to collapse)
    setDockedSftpOpen(false);
    if (activeSidebarNav === nav) {
      if (!drawerPinned) setActiveSidebarNav(null);
      return;
    }
    setActiveSidebarNav(nav);
  };

  const handleConnectHost = async (host: ConnectionHost) => {
    // The built-in "local machine" entry opens a local shell tab (whose SFTP
    // panel browses this machine's filesystem) instead of an SSH dial-out.
    if (host.id === 'local') {
      handleNewTab();
      return;
    }
    if (!IN_ELECTRON) {
      handleNewTab(host);
      return;
    }
    const prevActiveId = activeTabId;
    const newTabId = `tab-${Date.now()}`;
    const newTab: TabItem = {
      id: newTabId,
      hostId: host.id,
      title: `${host.user}@${host.name.split('-')[0]}`,
      hostName: host.name,
      userHost: `${host.user}@${host.host}`,
      contentType: 'terminal',
      status: 'connecting',
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTabId);
    try {
      // Throws on auth/timeout failure — HostDrawer surfaces the message inline.
      const sessionId = await createSshSession(host);
      setSessions((prev) => ({ ...prev, [newTabId]: { sessionId, kind: 'ssh' } }));
      setTabs((prev) => prev.map((t) => (t.id === newTabId ? { ...t, status: 'connected' } : t)));
    } catch (err) {
      // Roll back the placeholder tab; the drawer error banner is the feedback.
      setTabs((prev) => prev.filter((t) => t.id !== newTabId));
      setActiveTabId(prevActiveId);
      throw err;
    }
  };

  const handleAddHost = async (newHost: ConnectionHost) => {
    setHosts((prev) => [newHost, ...prev]);
    if (IN_ELECTRON) {
      // "保存并连接": go straight to a real SSH session (local-shell fallback only outside Electron).
      await handleConnectHost(newHost);
      return;
    }
    handleNewTab(newHost);
  };

  // Reconnect a dead pane in place: same tab, same pane id — a fresh sessionId
  // makes RealTerminal dispose the old terminal and start a clean one.
  const handleReconnectPane = async (paneId: string) => {
    const dead = sessionsRef.current[paneId];
    if (!dead) return;
    if (dead.kind === 'local') {
      const sessionId = await createLocalSession(paneId);
      if (sessionId) {
        setTabs((prev) => prev.map((t) => (t.id === paneId ? { ...t, status: 'connected' } : t)));
      }
      return;
    }
    const tab = tabs.find((t) => t.id === paneId);
    const host = tab ? hosts.find((h) => h.id === tab.hostId) : undefined;
    if (!host) return;
    setTabs((prev) => prev.map((t) => (t.id === paneId ? { ...t, status: 'connecting' } : t)));
    try {
      const sessionId = await createSshSession(host);
      setSessions((prev) => ({ ...prev, [paneId]: { sessionId, kind: 'ssh' } }));
      setTabs((prev) => prev.map((t) => (t.id === paneId ? { ...t, status: 'connected' } : t)));
    } catch (err) {
      console.error('[terminal] reconnect failed:', err);
      setTabs((prev) => prev.map((t) => (t.id === paneId ? { ...t, status: 'disconnected' } : t)));
    }
  };

  const handleRunSnippet = (command: string) => {
    runInActiveTerminal(command);
  };

  const handleToggleSplit = () => {
    const next = !isSplitPane;
    setIsSplitPane(next);
    // Turning the split on always yields a live shell: a dead pane kept around
    // from a previous exit is replaced rather than shown again.
    const existing = sessionsRef.current['secondary-split'];
    if (next && IN_ELECTRON && (!existing || existing.exited)) {
      void createLocalSession('secondary-split');
    }
  };

  // Placeholder for a pane whose pty has not answered yet (startup, or the
  // window between opening a tab and its session being registered).
  const mockTerminalCanvas = (
    <TerminalCanvas
      lines={terminalLines[activeTabId] || []}
      onExecuteCommand={handleExecuteCommand}
      host={activeHost}
      theme={currentTheme}
      fontSize={preferences.fontSize}
      fontFamily={preferences.fontFamily}
      lineHeight={preferences.lineHeight}
      cursorStyle={preferences.cursorStyle}
      cursorBlink={preferences.cursorBlink}
      showGrid={preferences.showGrid}
      showWatermark={preferences.showWatermark}
      watermarkOpacity={preferences.watermarkOpacity}
      isSplit={isSplitPane}
      paneId={activeTabId}
      onOpenPaletteModal={() => setIsPaletteModalOpen(true)}
    />
  )

  return (
    <I18nProvider languagePref={preferences.language}>
    <div 
      className={`soft-chrome h-screen w-screen overflow-hidden flex flex-col antialiased transition-colors duration-200 ${currentTheme.light ? 'theme-light' : ''}`}
      style={{
        backgroundColor: currentTheme.bgBase,
        color: currentTheme.textPrimary,
        ['--focus-ring' as string]: currentTheme.accentPrimary,
      }}
    >
      {/* 1. Integrated Header (Merged TitleBar + Tab Bar) */}
      <TitleBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={handleSelectTab}
        onCloseTab={handleCloseTab}
        onCloseOtherTabs={handleCloseOtherTabs}
        onNewTab={() => handleNewTab()}
        onOpenPaletteModal={() => setIsPaletteModalOpen(true)}
        onOpenSettings={() => openSettings()}
        theme={currentTheme}
        isSplit={isSplitPane}
        onToggleSplit={handleToggleSplit}
        isZenMode={isZenMode}
        onToggleZenMode={() => setIsZenMode(!isZenMode)}
        onClearTerminal={handleClearTerminal}
        onTakeSnapshot={() => {
          runInActiveTerminal('fastfetch');
        }}
        onToggleRecord={() => {
          const session = sessions[activeTabId];
          if (!IN_ELECTRON || !session) return;
          if (recordingSessions[session.sessionId]) {
            void window.ipcRenderer.invoke('terminal-log:stop', session.sessionId).catch(() => {});
          } else {
            void window.ipcRenderer
              .invoke('terminal-log:start', session.sessionId, activeTab.title)
              .catch(() => {});
          }
        }}
        isRecording={!!(sessions[activeTabId] && recordingSessions[sessions[activeTabId].sessionId])}
        activeSessionAlive={!!(sessions[activeTabId] && !sessions[activeTabId].exited)}
        hasOpenDrawer={activeSidebarNav !== null || dockedSftpOpen}
        drawerPinned={drawerPinned}
        onToggleDrawerPin={() => setDrawerPinned((prev) => !prev)}
      />

      {/* 2. Main Workspace Layout */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Global Left Narrow Sidebar (Hidden in Zen mode) */}
        {!isZenMode && (
          <Sidebar
            activeNav={activeTab.contentType === 'monitor' && !activeSidebarNav ? 'monitor' : activeSidebarNav}
            openPanels={[
              ...(dockedSftpOpen ? ['sftp' as const] : []),
              ...(isSettingsOpen ? ['settings' as const] : []),
              ...(isPaletteModalOpen ? ['palette' as const] : []),
            ]}
            onSelectNav={handleSelectNav}
            onOpenUpdates={() => openSettings('about')}
            theme={currentTheme}
            visibleNavItems={preferences.sidebarVisibleItems}
            compact={preferences.sidebarCompact}
          />
        )}

        {/* AI Copilot Drawer — docked on the LEFT, right after the icon sidebar */}
        {activeSidebarNav === 'ai' && (
          <ResizableDock widthPct={dockWidthPct} onChange={setDockWidthPct} onReset={resetDockWidth} theme={currentTheme}>
            <AICopilotDrawer
              className={DOCKED_LEFT_DRAWER_CLASS}
              isOpen={true}
              onClose={() => setActiveSidebarNav(null)}
              theme={currentTheme}
              host={activeHost}
              onInsertCommand={(cmd) => runInActiveTerminal(cmd)}
              onExecuteCommand={(cmd) => runInActiveTerminal(cmd)}
            />
          </ResizableDock>
        )}

        {/* Left Side Docked Drawers: SFTP / Hosts / Snippets (unified resizable dock) */}
        {(activeSidebarNav === 'sftp' || dockedSftpOpen) && activeTab.contentType !== 'sftp' && (
          <ResizableDock widthPct={dockWidthPct} onChange={setDockWidthPct} onReset={resetDockWidth} theme={currentTheme}>
            <SFTPDrawer
              className={DOCKED_LEFT_DRAWER_CLASS}
              theme={currentTheme}
              host={activeHost}
              local={isLocalTab}
              mode="docked"
              onCloseDock={() => {
                setDockedSftpOpen(false);
                setActiveSidebarNav(null);
              }}
              onRunFileInTerminal={(file) => runInActiveTerminal(file)}
              keepaliveInterval={preferences.sshKeepAlive}
            />
          </ResizableDock>
        )}

        {activeSidebarNav === 'hosts' && (
          <ResizableDock widthPct={dockWidthPct} onChange={setDockWidthPct} onReset={resetDockWidth} theme={currentTheme}>
            <HostDrawer
            className={DOCKED_LEFT_DRAWER_CLASS}
            isOpen={true}
            onClose={() => setActiveSidebarNav(null)}
            hosts={[{ ...localHost, name: t('sftp.localHost') }, ...hosts]}
            activeHostId={activeTab.hostId}
            onConnectHost={handleConnectHost}
            onAddHost={handleAddHost}
            onToggleFavorite={handleToggleHostBookmark}
            onMonitorHost={handleMonitorHost}
            onDeleteHost={(id) => {
              setHosts((prev) => prev.filter((h) => h.id !== id));
            }}
            theme={currentTheme}
            />
          </ResizableDock>
        )}

        {activeSidebarNav === 'snippets' && (
          <ResizableDock widthPct={dockWidthPct} onChange={setDockWidthPct} onReset={resetDockWidth} theme={currentTheme}>
            <SnippetsDrawer
              className={DOCKED_LEFT_DRAWER_CLASS}
              isOpen={true}
              onClose={() => setActiveSidebarNav(null)}
              snippets={snippets}
              theme={currentTheme}
              onRunSnippet={handleRunSnippet}
              onAddSnippet={(s) => setSnippets((prev) => [s, ...prev])}
              onDeleteSnippet={(id) => setSnippets((prev) => prev.filter((s) => s.id !== id))}
            />
          </ResizableDock>
        )}

        {activeSidebarNav === 'test' && (
          <ResizableDock widthPct={testDockWidthPct} onChange={setTestDockWidthPct} onReset={resetTestDockWidth} theme={currentTheme}>
            <TestDrawer
              className={DOCKED_LEFT_DRAWER_CLASS}
              theme={currentTheme}
              preferences={preferences}
              pinned={drawerPinned}
              onTogglePin={() => setDrawerPinned((prev) => !prev)}
              onCloseDock={() => setActiveSidebarNav(null)}
            />
          </ResizableDock>
        )}

        {/* Center Main Stage */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">

          {/* Dynamic Content View */}
          <div className="flex-1 flex overflow-hidden relative">
            {/* View 1: Terminal Mode. Kept mounted while the SFTP/monitor views are
                shown — only hidden — so xterm scrollback and running jobs survive the
                switch. `contents` keeps this wrapper out of the flex layout while visible. */}
            <div className={activeTab.contentType === 'terminal' ? 'contents' : 'hidden'}>
              <div className="flex-1 flex h-full overflow-hidden">
                {IN_ELECTRON && Object.keys(sessions).length > 0 ? (
                  <>
                    {/* Real sessions: every pane stays mounted (scrollback/vim survive tab switches).
                        This branch must not key off the active pane alone: opening a tab makes
                        sessions[activeTabId] undefined for as long as the pty/SSH handshake takes,
                        which would unmount every xterm and destroy the other tabs' history. */}
                    {!sessions[activeTabId] && (
                      <div className="flex-1 flex h-full min-w-0">{mockTerminalCanvas}</div>
                    )}
                    {Object.entries(sessions).map(([paneId, session]) => {
                      const isActivePane = paneId === activeTabId;
                      const isSecondary = paneId === 'secondary-split' && isSplitPane;
                      // Panes behind the SFTP/monitor view must report invisible:
                      // fitting a display:none container would push bogus cols/rows
                      // to the pty and corrupt the remote screen.
                      const visible =
                        activeTab.contentType === 'terminal' && (isActivePane || isSecondary);
                      return (
                        <div
                          key={paneId}
                          className={`${visible ? 'flex-1' : 'hidden'} ${isSecondary ? 'border-l' : ''} relative h-full min-w-0 flex`}
                          style={{ borderColor: currentTheme.borderSubtle }}
                        >
                          <RealTerminal
                            sessionId={session.sessionId}
                            visible={visible}
                            banner={
                              session.kind === 'local'
                                ? '\x1b[90m[TMX] 本地终端 · 输入 exit 可退出，关闭标签页即结束会话\x1b[0m\r\n'
                                : undefined
                            }
                            theme={currentTheme}
                            fontSize={preferences.fontSize}
                            fontFamily={preferences.fontFamily}
                            lineHeight={preferences.lineHeight}
                            cursorStyle={preferences.cursorStyle}
                            cursorBlink={preferences.cursorBlink}
                            scrollbackLimit={preferences.scrollbackLimit}
                            copyOnSelect={preferences.copyOnSelect}
                            pasteOnRightClick={preferences.pasteOnRightClick}
                            onSessionExit={handleSessionExit}
                          />
                          {session.exited && (
                            <div
                              className="absolute inset-0 z-10 flex items-center justify-center"
                              style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}
                            >
                              <button
                                onClick={() => void handleReconnectPane(paneId)}
                                className="px-4 py-1.5 rounded-lg border text-xs font-semibold shadow-lg transition-opacity hover:opacity-90"
                                style={{
                                  backgroundColor: currentTheme.accentPrimary,
                                  borderColor: currentTheme.accentPrimary,
                                  color: currentTheme.bgBase,
                                }}
                              >
                                {t('terminal.reconnect')}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </>
                ) : (
                  <>
                    {/* Mock canvas fallback (browser mode / no real session at all) */}
                    {mockTerminalCanvas}

                    {/* Secondary Split Pane (if Split active) */}
                    {isSplitPane && (
                      <div
                        className="flex-1 flex h-full border-l overflow-hidden"
                        style={{ borderColor: currentTheme.borderSubtle }}
                      >
                        <TerminalCanvas
                          lines={terminalLines['secondary-split'] || []}
                          onExecuteCommand={(cmd) => handleExecuteCommand(cmd, 'secondary-split')}
                          host={splitHost || activeHost}
                          theme={currentTheme}
                          fontSize={preferences.fontSize}
                          fontFamily={preferences.fontFamily}
                          lineHeight={preferences.lineHeight}
                          cursorStyle={preferences.cursorStyle}
                          cursorBlink={preferences.cursorBlink}
                          showGrid={preferences.showGrid}
                          showWatermark={false}
                          watermarkOpacity={preferences.watermarkOpacity}
                          isSplit={true}
                          paneId="secondary-split"
                          onOpenPaletteModal={() => setIsPaletteModalOpen(true)}
                        />
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* View 2: Full SFTP File Manager Mode */}
            {activeTab.contentType === 'sftp' && (
              <SFTPDrawer
                theme={currentTheme}
                host={activeHost}
                local={isLocalTab}
                mode="full"
                keepaliveInterval={preferences.sshKeepAlive}
                onRunFileInTerminal={(file) => {
                  handleChangeContentType('terminal');
                  runInActiveTerminal(file);
                }}
              />
            )}

            {/* View 3: Real-time System Telemetry Monitor Mode */}
            {activeTab.contentType === 'monitor' && (
              <SystemMonitor
                theme={currentTheme}
                host={monitorHost}
                target={monitorTarget}
              />
            )}
          </div>
        </div>
      </div>

      {/* Session log saved toast */}
      {logToast && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[70] px-4 py-2 rounded-xl border shadow-2xl text-xs animate-in fade-in"
          style={{ backgroundColor: currentTheme.bgSurface, borderColor: currentTheme.borderHover, color: currentTheme.textPrimary }}>
          {logToast}
        </div>
      )}

      {/* 3. Bottom Minimalist Status Bar */}
      <StatusBar
        host={activeHost}
        theme={currentTheme}
        local={isLocalTab}
        onOpenAICopilot={() => setActiveSidebarNav('ai')}
        isSplit={isSplitPane}
      />

      {/* 4. Overlays & Dialogs */}
      {/* Command Palette (Raycast / Warp style Cmd+K) */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        hosts={hosts}
        snippets={snippets}
        theme={currentTheme}
        onSelectHost={handleConnectHost}
        onRunSnippet={handleRunSnippet}
        onSelectTheme={(th) => setCurrentTheme(th)}
        onToggleSplit={() => setIsSplitPane(!isSplitPane)}
        onOpenSFTP={() => handleChangeContentType('sftp')}
        onClearTerminal={handleClearTerminal}
        onOpenPaletteModal={() => setIsPaletteModalOpen(true)}
        onOpenSettings={() => openSettings()}
      />

      {/* Dedicated Color Scheme & Design Spec Studio Modal */}
      <PaletteDesignModal
        isOpen={isPaletteModalOpen}
        onClose={() => setIsPaletteModalOpen(false)}
        currentTheme={currentTheme}
        onSelectTheme={(th) => setCurrentTheme(th)}
      />

      {/* MCP tool confirmation prompt (shown when mcpRequireConfirm is on) */}
      {mcpConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden"
            style={{ backgroundColor: currentTheme.bgSurface, borderColor: currentTheme.borderHover }}
          >
            <div
              className="flex items-center gap-2.5 px-5 py-3 border-b"
              style={{ backgroundColor: currentTheme.bgBase, borderColor: currentTheme.borderSubtle }}
            >
              <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="text-sm font-semibold text-slate-100">{t('app.mcpConfirmTitle')}</span>
              <span className="ml-auto text-[10px] font-mono px-2 py-0.5 rounded bg-white/5 text-slate-400 border border-white/10">
                {mcpConfirm.tool}
              </span>
            </div>
            <div className="px-5 py-4">
              <div className="text-[11px] text-slate-400 mb-2">{t('app.mcpConfirmAsk')}</div>
              <pre
                className="p-3 rounded-xl border font-mono text-[11px] text-slate-200 whitespace-pre-wrap break-all max-h-48 overflow-y-auto"
                style={{ backgroundColor: currentTheme.bgCanvas, borderColor: currentTheme.borderSubtle }}
              >
                {mcpConfirm.summary}
              </pre>
              <div className="text-[10px] text-slate-500 mt-2">{t('app.mcpConfirmTimeout')}</div>
            </div>
            <div
              className="flex items-center justify-end gap-2 px-5 py-3 border-t"
              style={{ backgroundColor: currentTheme.bgBase, borderColor: currentTheme.borderSubtle }}
            >
              <button
                onClick={() => respondMcpConfirm(false)}
                className="px-4 py-1.5 rounded-lg text-xs font-medium text-slate-300 bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
              >
                {t('app.mcpDeny')}
              </button>
              <button
                onClick={() => respondMcpConfirm(true)}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold text-slate-950 shadow-md hover:opacity-90 transition-opacity"
                style={{ backgroundColor: currentTheme.accentPrimary }}
              >
                {t('app.mcpAllow')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings & Preferences Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        initialTab={settingsInitialTab}
        onClose={() => setIsSettingsOpen(false)}
        theme={currentTheme}
        themes={THEMES}
        onSelectTheme={(th) => setCurrentTheme(th)}
        preferences={preferences}
        onUpdatePreference={handleUpdatePreference}
        onResetPreferences={handleResetPreferences}
        hosts={hosts}
        onUpdateHostGroup={handleUpdateHostGroup}
        onConnectHost={handleConnectHost}
        onClearStoredCredentials={handleClearStoredCredentials}
        onResetDatabase={handleResetDatabase}
      />
    </div>
    </I18nProvider>
  );
}
