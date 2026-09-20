import React from 'react';
import {
  Plus,
  X,
  Maximize2,
  SlidersHorizontal,
  Columns2,
  Trash2,
  Camera,
  CircleDot,
  Pin
  ,ChevronLeft,
  ChevronRight
} from 'lucide-react';
import type { TabItem, ThemeConfig } from '../types';
import { useT } from '../i18n/context';
import { showContextMenu, type MenuItemSpec } from '../utils/desktop';
import { WindowControls } from './WindowControls';
import { TitleBarTooltip } from './TitleBarTooltip';
import { TitleBarMoreMenu } from './TitleBarMoreMenu';

// macOS traffic lights overlap the header; Windows controls are rendered inline.
const IS_ELECTRON =
  typeof window !== 'undefined' && typeof window.ipcRenderer !== 'undefined';
const IS_MAC = IS_ELECTRON && /Mac/.test(navigator.userAgent);
const IS_WINDOWS = IS_ELECTRON && /Windows/.test(navigator.userAgent);

interface TitleBarProps {
  tabs: TabItem[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onCloseOtherTabs?: (id: string) => void;
  onNewTab: () => void;
  onOpenPaletteModal?: () => void;
  onOpenSettings?: () => void;
  theme: ThemeConfig;
  isSplit?: boolean;
  onToggleSplit?: () => void;
  isZenMode: boolean;
  onToggleZenMode: () => void;
  onClearTerminal?: () => void;
  onTakeSnapshot?: () => void;
  onToggleRecord?: () => void;
  isRecording?: boolean;
  activeSessionAlive?: boolean;
  hasOpenDrawer?: boolean;
  drawerPinned?: boolean;
  onToggleDrawerPin?: () => void;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onCloseOtherTabs,
  onNewTab,
  onOpenPaletteModal,
  onOpenSettings,
  theme,
  isSplit = false,
  onToggleSplit,
  isZenMode,
  onToggleZenMode,
  onClearTerminal,
  onTakeSnapshot,
  onToggleRecord,
  isRecording = false,
  activeSessionAlive = true,
  hasOpenDrawer = false,
  drawerPinned = false,
  onToggleDrawerPin,
}) => {
  const t = useT()
  const tabStripRef = React.useRef<HTMLDivElement>(null)
  const scrollTabs = (direction: -1 | 1) => {
    tabStripRef.current?.scrollBy({ left: direction * 180, behavior: 'smooth' })
  }
  // Theme-styled hover label (same look as the sidebar tooltips), shown under
  // the button since the toolbar sits at the top edge of the window.
  const HoverTip: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <TitleBarTooltip label={label} theme={theme}>{children}</TitleBarTooltip>
  );

  return (
    <header
      id="titlebar-integrated-header"
      className={`app-region-drag h-10 flex items-center px-3 border-b select-none transition-colors duration-200 z-30 shrink-0 gap-2.5 ${IS_MAC ? 'pl-[80px]' : ''}`}
      style={{
        backgroundColor: theme.bgSurface,
        borderColor: theme.borderSubtle,
      }}
    >
      {/* Left: App Brand (drag handle) */}
      <div className="flex items-center gap-3 shrink-0">
        {/* Brand Subtitle */}
        <div className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium text-slate-400">
          <img src="./brand/tmx-wordmark.svg" alt="TMX" className="w-[68px] h-6 shrink-0" draggable={false} />
          <span className="text-[10px] text-slate-500 font-mono">SSH</span>
        </div>

        {/* Subtle Vertical Divider */}
        <div
          className="h-4 w-px shrink-0"
          style={{ backgroundColor: theme.borderSubtle }}
        />
      </div>

      {/* Left-Aligned Tab Strip */}
      <div ref={tabStripRef} className="flex items-center gap-1 overflow-x-auto no-scrollbar flex-1 min-w-0 pr-2">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onSelectTab(tab.id);
                const items: MenuItemSpec[] = [
                  { id: 'copy-title', label: t('titleBar.copyTitle') },
                ];
                if (tabs.length > 1) {
                  items.push(
                    { type: 'separator' },
                    { id: 'close', label: t('titleBar.closeTab') },
                    { id: 'close-others', label: t('titleBar.closeOthers') },
                  );
                }
                showContextMenu(items, (id) => {
                  if (id === 'copy-title') navigator.clipboard.writeText(tab.title);
                  else if (id === 'close') onCloseTab(tab.id);
                  else if (id === 'close-others') onCloseOtherTabs?.(tab.id);
                });
              }}
              className={`app-region-no-drag group relative flex items-center gap-1 h-7 px-1.5 rounded-lg text-xs cursor-pointer transition-all duration-150 border shrink-0 ${isActive ? 'tab-item-active' : 'tab-item'}`}
              style={{
                color: isActive ? theme.textPrimary : theme.textSecondary,
                ...(isActive
                  ? {
                      backgroundColor: theme.bgActive,
                      borderColor: theme.borderHover,
                      boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
                    }
                  : ({
                      '--hover-bg': theme.bgActive,
                      '--hover-border': theme.borderHover,
                    } as React.CSSProperties)),
              }}
            >
              {/* Status dot: green = connected, pulsing amber = connecting, red = disconnected */}
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${tab.status === 'connecting' ? 'animate-pulse' : ''}`}
                style={{
                  backgroundColor:
                    tab.status === 'connected'
                      ? theme.accentSuccess
                      : tab.status === 'connecting'
                        ? '#FBBF24'
                        : '#FB7185',
                }}
                title={
                  tab.status === 'connected'
                    ? t('titleBar.connected')
                    : tab.status === 'connecting'
                      ? t('titleBar.connecting')
                      : t('titleBar.disconnected')
                }
              />

              {/* Tab Title */}
              <span className="truncate max-w-[88px] font-mono-term font-medium tracking-tight">
                {tab.title}
              </span>

              {/* Close Tab Button */}
              {tabs.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  className={`p-0.5 rounded hover:bg-white/10 transition-opacity ml-0.5 shrink-0 ${
                    isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  }`}
                  title={t('titleBar.closeTab')}
                >
                  <X className="w-3 h-3" />
                </button>
              )}

            </div>
          );
        })}

        {/* Add Tab Button */}
        <button
          onClick={onNewTab}
          title={t('titleBar.newTab')}
          className="app-region-no-drag hover-elevate p-1.5 rounded-lg text-slate-400 hover:text-slate-200 transition-colors border border-transparent shrink-0"
          style={{ '--hover-bg': theme.bgActive } as React.CSSProperties}
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Right Controls: Command Palette, Copilot & Zen State */}
      <div className="titlebar-tools flex items-center gap-1.5 shrink-0 ml-auto">
        <div className="titlebar-tab-scroll app-region-no-drag flex items-center gap-0.5">
          <button
            type="button"
            aria-label={t('titleBar.tabsPrevious')}
            title={t('titleBar.tabsPrevious')}
            onClick={() => scrollTabs(-1)}
            className="hover-elevate text-slate-400 hover:text-slate-200 transition-colors"
            style={{ '--hover-bg': theme.bgActive } as React.CSSProperties}
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            aria-label={t('titleBar.tabsNext')}
            title={t('titleBar.tabsNext')}
            onClick={() => scrollTabs(1)}
            className="hover-elevate text-slate-400 hover:text-slate-200 transition-colors"
            style={{ '--hover-bg': theme.bgActive } as React.CSSProperties}
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Divider between tab navigation and the more-actions menu */}
        <div className="h-4 w-px mx-0.5" style={{ backgroundColor: theme.borderSubtle }} />

        <TitleBarMoreMenu
          theme={theme}
          recording={isRecording}
          actions={[
            {
              id: "close-others",
              label: t("titleBar.menuCloseOthers"),
              icon: X,
              run: onCloseOtherTabs ? () => onCloseOtherTabs(activeTabId) : undefined,
              disabled: tabs.length <= 1,
            },
            ...(onToggleSplit ? [{ id: "split", label: isSplit ? t("titleBar.menuSplitRestore") : t("titleBar.menuSplit"), icon: Columns2, run: onToggleSplit, active: isSplit, shortcut: IS_MAC ? "⌘D" : "Ctrl+D" }] : []),
            { id: "clear", label: t("titleBar.menuClear"), icon: Trash2, run: onClearTerminal },
            { id: "snapshot", label: t("titleBar.menuSnapshot"), icon: Camera, run: onTakeSnapshot },
            ...(onToggleRecord && IS_ELECTRON ? [{
              id: "record", icon: CircleDot, run: onToggleRecord,
              label: isRecording ? t("titleBar.menuRecordStop") : activeSessionAlive ? t("titleBar.menuRecordStart") : t("titleBar.menuRecordUnavailable"),
              disabled: !activeSessionAlive && !isRecording, active: isRecording, recording: isRecording,
            }] : []),
            {
              id: "pin",
              label: drawerPinned
                ? t("titleBar.menuUnpin")
                : t("titleBar.menuPin"),
              icon: Pin,
              run: onToggleDrawerPin,
              active: drawerPinned,
            },
            {
              id: "zen",
              label: isZenMode ? t("titleBar.menuZenExit") : t("titleBar.menuZenEnter"),
              icon: Maximize2,
              run: onToggleZenMode,
              active: isZenMode,
              shortcut: "F11",
            },
          ]}
        />
      </div>

      {IS_WINDOWS && <WindowControls theme={theme} />}
    </header>
  );
};
