import React from 'react';
import {
  Command,
  Server,
  FolderTree,
  TerminalSquare,
  Sparkles,
  Settings,
  Download,
  Info,
  Bookmark,
  FlaskConical
} from 'lucide-react';
import type { ThemeConfig } from '../types';
import { useT } from '../i18n/context';
import { useUpdateState } from '../utils/updateState';
export type SidebarNavId = 'palette' | 'hosts' | 'sftp' | 'snippets' | 'ai' | 'test' | 'monitor' | 'themes' | 'settings';

interface SidebarProps {
  activeNav: SidebarNavId | null;
  openPanels?: SidebarNavId[];
  onSelectNav: (nav: SidebarNavId) => void;
  theme: ThemeConfig;
  unreadAiSuggestions?: boolean;
  visibleNavItems?: {
    hosts: boolean;
    sftp: boolean;
    snippets: boolean;
    ai: boolean;
    test: boolean;
    monitor: boolean;
  };
  compact?: boolean;
  /** Opens Settings on the About tab; the update badge only renders when an update exists. */
  onOpenUpdates?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeNav,
  openPanels = [],
  onSelectNav,
  theme,
  unreadAiSuggestions = true,
  visibleNavItems,
  compact = false,
  onOpenUpdates,
}) => {
  const t = useT()
  const update = useUpdateState()
  const allTopNavItems: { id: SidebarNavId; label: string; icon: React.ComponentType<{ className?: string }>; badge?: boolean }[] = [
    { id: 'hosts', label: t('sidebar.hosts'), icon: Server },
    { id: 'sftp', label: t('sidebar.sftp'), icon: FolderTree },
    { id: 'snippets', label: t('sidebar.snippets'), icon: Bookmark },
    { id: 'ai', label: t('sidebar.ai'), icon: Sparkles, badge: unreadAiSuggestions },
    { id: 'test', label: t('test.title'), icon: FlaskConical },
  ];

  const topNavItems = allTopNavItems.filter((item) => {
    if (!visibleNavItems) return true;
    const key = item.id as keyof typeof visibleNavItems;
    return visibleNavItems[key] !== false;
  });

  const bottomNavItems: { id: SidebarNavId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'palette', label: t('sidebar.palette'), icon: Command },
    { id: 'settings', label: t('sidebar.settings'), icon: Settings },
  ];

  return (
    <aside
      id="global-sidebar-navigation"
      className="app-region-drag w-14 shrink-0 flex flex-col justify-between items-center py-3 border-r select-none z-10 transition-colors duration-200"
      // No context menu on the nav rail; stopPropagation also keeps the global
      // selection fallback from popping the native OS menu over it.
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      style={{
        backgroundColor: theme.bgSurface,
        borderColor: theme.borderSubtle,
      }}
    >
      {/* Top Core Navigation */}
      <div className="flex flex-col items-center gap-1.5 w-full">
        {topNavItems.map((item) => {
          // Only one nav icon may read as selected: an open drawer wins,
          // monitor lights up just for the content view with no drawer open.
          const isActive = activeNav === item.id;
          const showTooltip = !isActive && !openPanels.includes(item.id);
          const Icon = item.icon;

          return (
            <div key={item.id} className="relative group w-full flex items-center justify-center">
              <button
                onClick={() => onSelectNav(item.id)}
                className={`app-region-no-drag relative w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-150 ${isActive ? '' : 'sidebar-nav-item'}`}
                style={{
                  color: isActive ? theme.accentPrimary : theme.textSecondary,
                  ...(isActive
                    ? { backgroundColor: theme.bgActive }
                    : ({ '--hover-bg': theme.bgActive } as React.CSSProperties)),
                }}
                aria-label={item.label}
              >
                <Icon className="w-5 h-5 transition-transform duration-150 group-hover:scale-110" />

                {/* Optional Breathing Light Badge for AI / Notifications */}
                {item.badge && !isActive && (
                  <span
                    className="absolute top-2 right-2 w-2 h-2 rounded-full ring-2 ring-slate-900 animate-pulse"
                    style={{ backgroundColor: theme.accentPrimary }}
                  />
                )}
              </button>

              {/* Tooltip on hover */}
              {showTooltip && (
              <div 
                className="absolute left-14 ml-2 px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 z-50 border backdrop-mica"
                style={{
                  backgroundColor: theme.bgSurface,
                  color: theme.textPrimary,
                  borderColor: theme.borderHover,
                }}
              >
                {item.label}
              </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom Auxiliary Navigation: Update badge, Palette, Settings */}
      <div className="flex flex-col items-center gap-1.5 w-full pt-3">
        <div className="w-10 h-px mb-1" style={{ backgroundColor: theme.borderSubtle }} />

        {/* Update available badge — rendered only when a newer version exists */}
        {(update.phase === 'available' || update.phase === 'downloaded') && (
          <div className="relative group w-full flex items-center justify-center">
            <button
              onClick={() => onOpenUpdates?.()}
              className="app-region-no-drag relative w-10 h-10 rounded-xl flex items-center justify-center sidebar-nav-item transition-all duration-150"
              style={{
                color: theme.accentPrimary,
                ...({ '--hover-bg': theme.bgActive } as React.CSSProperties),
              }}
              aria-label={t('sidebar.updateAvailable')}
            >
              <Download className="w-5 h-5 transition-transform duration-150 group-hover:scale-110" />
              <span
                className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-slate-900 animate-pulse"
              />
            </button>
            <div
              className="absolute left-14 ml-2 px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 z-50 border backdrop-mica"
              style={{
                backgroundColor: theme.bgSurface,
                color: theme.textPrimary,
                borderColor: theme.borderHover,
              }}
            >
              {t('sidebar.updateAvailable')}{update.newVersion ? ` · v${update.newVersion}` : ''}
            </div>
          </div>
        )}

        {bottomNavItems.map((item) => {
          const isActive = activeNav === item.id;
          const showTooltip = !isActive && !openPanels.includes(item.id);
          const Icon = item.icon;

          return (
            <div key={item.id} className="relative group w-full flex items-center justify-center">
              <button
                onClick={() => onSelectNav(item.id)}
                className={`app-region-no-drag w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-150 ${isActive ? '' : 'sidebar-nav-item'}`}
                style={{
                  color: isActive ? theme.accentPrimary : theme.textSecondary,
                  ...(isActive
                    ? { backgroundColor: theme.bgActive }
                    : ({ '--hover-bg': theme.bgActive } as React.CSSProperties)),
                }}
                aria-label={item.label}
              >
                <Icon className="w-5 h-5 transition-transform duration-150 group-hover:scale-110" />
              </button>

              {showTooltip && <div
                className="absolute left-14 ml-2 px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 z-50 border backdrop-mica"
                style={{
                  backgroundColor: theme.bgSurface,
                  color: theme.textPrimary,
                  borderColor: theme.borderHover,
                }}
              >
                {item.label}
              </div>}
            </div>
          );
        })}
      </div>
    </aside>
  );
};
