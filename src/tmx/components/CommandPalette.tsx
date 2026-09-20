import React, { useState, useEffect, useRef } from 'react';
import { useT } from '../i18n/context';
import { 
  Search, 
  Server, 
  Terminal, 
  Palette, 
  Sparkles, 
  Columns2, 
  Trash2, 
  HardDrive, 
  Activity, 
  Bookmark, 
  ArrowRight,
  Command,
  Sliders
} from 'lucide-react';
import type { ThemeConfig, ConnectionHost, QuickSnippet } from '../types';
import { THEMES } from '../data/themes';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  hosts: ConnectionHost[];
  snippets: QuickSnippet[];
  theme: ThemeConfig;
  onSelectHost: (host: ConnectionHost) => void;
  onRunSnippet: (command: string) => void;
  onSelectTheme: (theme: ThemeConfig) => void;
  onToggleSplit: () => void;
  onOpenSFTP: () => void;
  onClearTerminal: () => void;
  onOpenPaletteModal: () => void;
  onOpenSettings?: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  hosts,
  snippets,
  theme,
  onSelectHost,
  onRunSnippet,
  onSelectTheme,
  onToggleSplit,
  onOpenSFTP,
  onClearTerminal,
  onOpenPaletteModal,
  onOpenSettings,
}) => {
  const t = useT()
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery('');
      setSelectedIndex(0);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const actions = [
    {
      id: 'open-settings',
      title: t('palette.openPreferences'),
      subtitle: t('palette.openPrefsSub'),
      category: t('palette.catSettings'),
      icon: Sliders,
      handler: onOpenSettings,
    },
    {
      id: 'palette-modal',
      title: t('palette.openTheme'),
      subtitle: 'Color Scheme Studio (Nordic Slate / Obsidian)',
      category: t('palette.catTheme'),
      icon: Palette,
      handler: onOpenPaletteModal,
    },
    {
      id: 'toggle-split',
      title: t('palette.openSplit'),
      subtitle: 'Split Terminal Pane (Horizontal / Vertical)',
      category: t('palette.catLayout'),
      icon: Columns2,
      handler: onToggleSplit,
    },
    {
      id: 'open-sftp',
      title: t('palette.openSftp'),
      subtitle: 'Browse remote directories and upload files',
      category: t('palette.catModule'),
      icon: HardDrive,
      handler: onOpenSFTP,
    },
    {
      id: 'clear-term',
      title: t('palette.clearScreen'),
      subtitle: 'Clear terminal screen buffer',
      category: t('palette.catQuick'),
      icon: Trash2,
      handler: onClearTerminal,
    },
    ...hosts.map((h) => ({
      id: `host-${h.id}`,
      title: t('palette.connectHost', { name: h.name }),
      subtitle: `${h.user}@${h.host}:${h.port} • ${h.group} (${h.pingMs}ms)`,
      category: t('palette.catSsh'),
      icon: Server,
      handler: () => onSelectHost(h),
    })),
    ...snippets.map((s) => ({
      id: `snippet-${s.id}`,
      title: t('palette.runCommand', { name: s.title }),
      subtitle: s.command,
      category: t('palette.catSnippet'),
      icon: Bookmark,
      handler: () => onRunSnippet(s.command),
    })),
    ...THEMES.map((th) => ({
      id: `theme-${th.id}`,
      title: t('palette.switchTheme', { name: th.nameCn }),
      subtitle: th.tagline,
      category: t('palette.catTheme'),
      icon: Palette,
      handler: () => onSelectTheme(th),
    })),
  ];

  const filteredActions = actions.filter(
    (a) =>
      a.title.toLowerCase().includes(query.toLowerCase()) ||
      a.subtitle.toLowerCase().includes(query.toLowerCase()) ||
      a.category.toLowerCase().includes(query.toLowerCase())
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % (filteredActions.length || 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredActions.length) % (filteredActions.length || 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredActions[selectedIndex]) {
        filteredActions[selectedIndex].handler?.();
        onClose();
      }
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4 select-none"
      onClick={onClose}
    >
      <div 
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-2xl border shadow-2xl overflow-hidden text-slate-200 animate-in zoom-in-95 duration-150"
        style={{
          backgroundColor: theme.bgSurface,
          borderColor: theme.borderHover,
        }}
      >
        {/* Search Bar */}
        <div
          className="flex items-center gap-3 px-3.5 py-2.5 border-b"
          style={{
            backgroundColor: theme.bgBase,
            borderColor: theme.borderSubtle,
          }}
        >
          <Search className="w-4 h-4 text-slate-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder={t('palette.placeholder')}
            className="w-full bg-transparent border-none outline-none text-sm text-slate-100 placeholder-slate-500 font-sans"
          />
          <button
            onClick={onClose}
            title={t('palette.closeEsc')}
            className="shrink-0 hidden sm:inline-flex px-1.5 py-0.5 text-[10px] font-mono bg-white/10 rounded border border-white/15 text-slate-400 hover:text-slate-200 hover:bg-white/15 transition-colors cursor-pointer whitespace-nowrap"
          >
            {t('palette.exit')}
          </button>
        </div>

        {/* Action List */}
        <div className="max-h-[60vh] overflow-y-auto p-1.5 space-y-0.5">
          {filteredActions.length === 0 ? (
            <div className="py-8 text-center text-slate-500 text-xs">
              {t('palette.noMatch')}
            </div>
          ) : (
            filteredActions.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              const Icon = item.icon;

              return (
                <div
                  key={item.id}
                  onClick={() => {
                    item.handler?.();
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className="flex items-center justify-between px-2.5 py-1 rounded-lg cursor-pointer transition-colors border"
                  style={{
                    backgroundColor: isSelected ? theme.bgActive : 'transparent',
                    borderColor: isSelected ? theme.borderHover : 'transparent',
                  }}
                >
                  <div className="flex items-center gap-2 truncate">
                    <div
                      className="w-5 h-5 rounded-md flex items-center justify-center shrink-0 border"
                      style={{
                        backgroundColor: isSelected ? theme.bgBase : theme.bgInput,
                        borderColor: theme.borderSubtle,
                        color: isSelected ? theme.accentPrimary : theme.textSecondary,
                      }}
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </div>

                    <div className="text-[11px] font-medium text-slate-200 truncate">
                      {item.title}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    <span
                      className="px-1.5 py-0.5 rounded text-[10px] leading-none font-sans border"
                      style={{
                        backgroundColor: theme.bgInput,
                        borderColor: theme.borderSubtle,
                        color: theme.textSecondary,
                      }}
                    >
                      {item.category}
                    </span>
                    {isSelected && (
                      <ArrowRight className="w-3 h-3" style={{ color: theme.accentPrimary }} />
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer info */}
        <div
          className="flex items-center justify-between px-3.5 py-1.5 border-t text-[11px] text-slate-500 font-mono"
          style={{
            backgroundColor: theme.bgBase,
            borderColor: theme.borderSubtle,
          }}
        >
          <span>{t('palette.navHint')}</span>
          <span>{t('palette.runHint')}</span>
        </div>
      </div>
    </div>
  );
};
