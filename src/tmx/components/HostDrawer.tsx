import React, { useEffect, useRef, useState } from 'react';
import { 
  Activity,
  Plus, 
  Search, 
  Wifi,  
  Star, 
  ChevronRight, 
  KeyRound, 
  Trash2,
  Terminal,
  Pin
} from 'lucide-react';
import type { ConnectionHost, ThemeConfig } from '../types';
import { useT } from '../i18n/context';
import { showContextMenu, type MenuItemSpec } from '../utils/desktop';

const DEFAULT_HOST_GROUPS = ['Production', 'Staging', 'Test'];

interface HostDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  hosts: ConnectionHost[];
  activeHostId: string;
  onConnectHost: (host: ConnectionHost) => void | Promise<void>;
  onAddHost: (newHost: ConnectionHost) => void | Promise<void>;
  onToggleFavorite?: (hostId: string) => void;
  onMonitorHost?: (host: ConnectionHost) => void;
  onDeleteHost?: (hostId: string) => void;
  theme: ThemeConfig;
  className?: string;
}

export const HostDrawer: React.FC<HostDrawerProps> = ({
  isOpen,
  onClose,
  hosts,
  activeHostId,
  onConnectHost,
  onAddHost,
  onToggleFavorite,
  onMonitorHost,
  onDeleteHost,
  theme,
  className,
}) => {
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const [selectedGroup, setSelectedGroup] = useState<string>('All');

  // Focus the search field whenever the drawer mounts (it renders on open).
  useEffect(() => {
    searchRef.current?.focus();
  }, []);
  const [isAdding, setIsAdding] = useState(false);
  const t = useT()

  // New host form
  const [formName, setFormName] = useState('');
  const [formHost, setFormHost] = useState('');
  const [formUser, setFormUser] = useState('deploy');
  const [formPort, setFormPort] = useState(22);
  const [formGroup, setFormGroup] = useState<string>('Production');
  const [formPassword, setFormPassword] = useState('');
  const [formPrivateKeyPath, setFormPrivateKeyPath] = useState('');
  const [formPassphrase, setFormPassphrase] = useState('');
  const [connectError, setConnectError] = useState<string | null>(null);

  // Connection errors clear themselves so a stale banner never lingers.
  useEffect(() => {
    if (!connectError) return;
    const timer = window.setTimeout(() => setConnectError(null), 6000);
    return () => window.clearTimeout(timer);
  }, [connectError]);
  const [connectingHostId, setConnectingHostId] = useState<string | null>(null);

  if (!isOpen) return null;

  // Groups are dynamic: defaults + every group already present on saved hosts.
  const groups = ['All', ...Array.from(new Set([...DEFAULT_HOST_GROUPS, ...hosts.map((h) => h.group).filter(Boolean)]))];

  const filteredHosts = hosts
    .filter((h) => {
      const matchesSearch = h.name.toLowerCase().includes(search.toLowerCase()) || h.host.includes(search);
      const matchesGroup = selectedGroup === 'All' || h.group === selectedGroup;
      return matchesSearch && matchesGroup;
    })
    .sort((a, b) => {
      // The built-in local-machine entry always stays at the top.
      if (a.id === 'local') return -1;
      if (b.id === 'local') return 1;
      if (a.favorite && !b.favorite) return -1;
      if (!a.favorite && b.favorite) return 1;
      return a.name.localeCompare(b.name);
    });

  const handleSaveHost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName || !formHost) return;
    const newH: ConnectionHost = {
      id: `host-${Date.now()}`,
      name: formName,
      host: formHost,
      user: formUser,
      port: Number(formPort) || 22,
      group: formGroup.trim() || 'Production',
      tag: 'Custom SSH',
      status: 'online',
      pingMs: 24,
      cpuLoad: 16,
      memLoad: 42,
      diskLoad: 38,
      os: 'Ubuntu 24.04 LTS',
      fingerprint: 'SHA256:custom...',
      authMethod: formPrivateKeyPath ? 'Ed25519 Key' : 'Password',
      favorite: false,
      ...(formPassword ? { password: formPassword } : {}),
      ...(formPrivateKeyPath ? { privateKeyPath: formPrivateKeyPath } : {}),
      ...(formPassphrase ? { passphrase: formPassphrase } : {}),
    };
    try {
      // In Electron this performs the real SSH connect; a failure keeps the form
      // open and surfaces the reason in the error banner below.
      await onAddHost(newH);
      setIsAdding(false);
      setFormName('');
      setFormHost('');
      setFormPassword('');
      setFormPrivateKeyPath('');
      setFormPassphrase('');
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleConnect = async (host: ConnectionHost): Promise<boolean> => {
    setConnectError(null);
    setConnectingHostId(host.id);
    try {
      await onConnectHost(host);
      onClose();
      return true;
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setConnectingHostId(null);
    }
  };

  return (
    <div 
      className={className || "w-[320px] shrink-0 h-full flex flex-col border-r select-none transition-colors duration-150 z-20"}
      style={{
        backgroundColor: theme.bgSurface,
        borderColor: theme.borderSubtle,
      }}
    >
      {/* Header */}
      <div 
        className="flex items-center justify-between h-10 px-3 border-b shrink-0"
        style={{
          backgroundColor: theme.bgBase,
          borderColor: theme.borderSubtle,
        }}
      >
        <div className="flex items-center gap-2">
          <span className="font-semibold text-xs text-slate-100">
            {t('hosts.title')}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsAdding(!isAdding)}
            className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-white/10 transition-colors"
            title={t('hosts.add')}
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Add host inline form */}
      {isAdding && (
        <form onSubmit={handleSaveHost} className="p-3 space-y-2.5 bg-black/20 text-xs">
          <div className="font-semibold text-slate-200">{t('hosts.newTitle')}</div>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder={t('hosts.aliasPlaceholder')}
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              className="flex-1 min-w-0 px-2.5 py-1.5 rounded bg-black/40 border border-white/10 text-slate-200 outline-none focus:border-sky-400"
              required
            />
            <select
              value={formGroup}
              onChange={(e) => setFormGroup(e.target.value)}
              className="px-2 py-1.5 rounded bg-black/40 border border-white/10 text-slate-200 outline-none"
              title={t('hosts.group')}
            >
              {groups.filter((g) => g !== 'All').map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <input
              type="text"
              placeholder={t('hosts.ipPlaceholder')}
              value={formHost}
              onChange={(e) => setFormHost(e.target.value)}
              className="col-span-2 px-2.5 py-1.5 rounded bg-black/40 border border-white/10 text-slate-200 outline-none focus:border-sky-400"
              required
            />
            <input
              type="number"
              placeholder={t('hosts.portPlaceholder')}
              value={formPort}
              onChange={(e) => setFormPort(Number(e.target.value))}
              className="px-2.5 py-1.5 rounded bg-black/40 border border-white/10 text-slate-200 outline-none focus:border-sky-400"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              placeholder={t('hosts.userPlaceholder')}
              value={formUser}
              onChange={(e) => setFormUser(e.target.value)}
              className="px-2.5 py-1.5 rounded bg-black/40 border border-white/10 text-slate-200 outline-none focus:border-sky-400"
            />
            <input
              type="password"
              placeholder={t('hosts.passwordPlaceholder')}
              value={formPassword}
              onChange={(e) => setFormPassword(e.target.value)}
              className="px-2.5 py-1.5 rounded bg-black/40 border border-white/10 text-slate-200 outline-none focus:border-sky-400"
            />
          </div>
          <input
            type="text"
            placeholder={t('hosts.keyPathPlaceholder')}
            value={formPrivateKeyPath}
            onChange={(e) => setFormPrivateKeyPath(e.target.value)}
            className="w-full px-2.5 py-1.5 rounded bg-black/40 border border-white/10 text-slate-200 outline-none focus:border-sky-400"
          />
          {formPrivateKeyPath && (
            <input
              type="password"
              placeholder={t('hosts.passphrasePlaceholder')}
              value={formPassphrase}
              onChange={(e) => setFormPassphrase(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded bg-black/40 border border-white/10 text-slate-200 outline-none focus:border-sky-400"
            />
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              className="flex-1 py-1.5 rounded bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold"
            >
              {t('hosts.saveConnect')}
            </button>
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="px-3 py-1.5 rounded bg-white/10 text-slate-300 hover:bg-white/20"
            >
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}

      {/* Search & Groups */}
      <div className="p-3 border-b space-y-2 shrink-0" style={{ borderColor: theme.borderSubtle }}>
        <div 
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs"
          style={{
            backgroundColor: theme.bgInput,
            borderColor: theme.borderSubtle,
          }}
        >
          <Search className="w-3.5 h-3.5 text-slate-400" />
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setSearch('');
            }}
            placeholder={t('hosts.searchPlaceholder')}
            className="w-full bg-transparent border-none outline-none text-xs text-slate-200 placeholder-slate-500"
          />
        </div>

        {/* Group tabs */}
        <div className="flex items-center gap-0.5 overflow-x-auto no-scrollbar pt-1">
          {groups.map((grp) => (
            <button
              key={grp}
              onClick={() => setSelectedGroup(grp)}
              className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors ${
                selectedGroup === grp
                  ? 'bg-white/15 text-slate-100 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {grp}
            </button>
          ))}
        </div>
      </div>

      {/* Connection error banner */}
      {connectError && (
        <div
          className="mx-2 mt-2 px-2.5 py-1.5 rounded-lg text-[11px] border shrink-0"
          style={{
            backgroundColor: 'rgba(248, 113, 113, 0.08)',
            borderColor: 'rgba(248, 113, 113, 0.35)',
            color: theme.accentError,
          }}
        >
          {t('hosts.connectFailed', { error: connectError })}
        </div>
      )}

      {/* Host list — All view: favorites pinned, then categorized sections */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {filteredHosts.length === 0 && (
          <div className="py-10 text-center space-y-1.5">
            <div className="text-xs text-slate-400">
              {search
                ? t('hosts.noMatch')
                : hosts.length === 0
                  ? t('hosts.empty')
                  : t('hosts.emptyGroup', { group: selectedGroup })}
            </div>
            {!search && hosts.length === 0 && (
              <div className="text-[11px] text-slate-500">{t('hosts.emptyHint')}</div>
            )}
          </div>
        )}
        {(() => {
          const renderHost = (h: ConnectionHost) => {
            const isActive = h.id === activeHostId;
            // The built-in local-machine entry is virtual: connect only — no
            // edit/delete/favorite/monitor actions and no persisted row.
            const isVirtual = h.id === 'local';

            return (

            <div
              key={h.id}
              onClick={() => {
                void handleConnect(h);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const items: MenuItemSpec[] = [
                  { id: 'connect', label: t('hosts.connect') },
                ];
                if (onMonitorHost) items.push({ id: 'monitor', label: t('hosts.monitor') });
                if (!isVirtual) {
                  if (onToggleFavorite) items.push({ id: 'favorite', label: h.favorite ? t('hosts.unfavorite') : t('hosts.favorite') });
                  items.push({ id: 'copy-address', label: t('hosts.copyAddress') });
                  if (onDeleteHost) {
                    items.push({ type: 'separator' }, { id: 'delete', label: t('hosts.remove') });
                  }
                }
                showContextMenu(items, (id) => {
                  if (id === 'connect') void handleConnect(h);
                  else if (id === 'monitor') onMonitorHost?.(h);
                  else if (id === 'favorite') onToggleFavorite?.(h.id);
                  else if (id === 'copy-address') navigator.clipboard.writeText(`${h.user}@${h.host}:${h.port}`);
                  else if (id === 'delete') onDeleteHost?.(h.id);
                });
              }}
              className="p-2.5 rounded-xl border cursor-pointer transition-all duration-150 group"
              style={{
                backgroundColor: isActive ? theme.bgActive : 'transparent',
                borderColor: isActive ? theme.borderHover : theme.borderSubtle,
              }}
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2 truncate">
                  <div
                    className={`w-2 h-2 rounded-full ${connectingHostId === h.id ? 'animate-pulse' : ''}`}
                    style={{ backgroundColor: connectingHostId === h.id ? theme.accentWarning : theme.accentSuccess }}
                  />
                  <span className="font-semibold text-xs text-slate-100 font-mono truncate">
                    {h.name}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  {!isVirtual && onDeleteHost && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteHost(h.id);
                      }}
                      className="hidden group-hover:flex p-1 rounded hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-colors"
                      title={t('hosts.remove')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}

                  {onMonitorHost && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onMonitorHost(h);
                      }}
                      className="hidden group-hover:flex p-1 rounded hover:bg-white/10 text-slate-400 hover:text-sky-400 transition-colors"
                      title={t('hosts.monitor')}
                    >
                      <Activity className="w-3.5 h-3.5" />
                    </button>
                  )}

                  {onToggleFavorite && (
                    h.id === 'local' ? (
                      // The local machine is pinned as a favorite; the star is
                      // display-only and cannot be toggled off.
                      <span
                        className="p-1"
                        title={t('hosts.favorite')}
                      >
                        <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                      </span>
                    ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFavorite(h.id);
                      }}
                      className="p-1 rounded hover:bg-white/10 transition-colors"
                      title={h.favorite ? t('hosts.unfavorite') : t('hosts.favorite')}
                    >
                      <Star className={`w-3.5 h-3.5 transition-colors ${
                        h.favorite ? 'text-amber-400 fill-amber-400' : 'text-slate-500 hover:text-amber-400'
                      }`} />
                    </button>
                    )
                  )}
                </div>
              </div>

              <div className="text-[11px] text-slate-400 font-mono truncate">
                {isVirtual ? 'user@localhost' : `${h.user}@${h.host}:${h.port}`}
              </div>
            </div>
            );
          };

          if (selectedGroup !== 'All') {
            return <>{filteredHosts.map(renderHost)}</>;
          }

          const localEntry = filteredHosts.find((h) => h.id === 'local');
          const savedHosts = filteredHosts.filter((h) => h.id !== 'local');
          const favorites = savedHosts.filter((h) => h.favorite);
          const sectionGroups = groups
            .filter((g) => g !== 'All')
            .filter((g) => savedHosts.some((h) => !h.favorite && h.group === g));

          return (
            <>
              {localEntry && renderHost(localEntry)}
              {favorites.length > 0 && (
                <div className="px-2 pt-1 pb-0.5 text-[10px] font-medium tracking-wider text-amber-400/80">
                  {t('hosts.favorites', { count: favorites.length })}
                </div>
              )}
              {favorites.map(renderHost)}
              {sectionGroups.map((g) => {
                const members = savedHosts.filter((h) => !h.favorite && h.group === g);
                return (
                  <div key={g}>
                    <div className="px-2 pt-2 pb-0.5 text-[10px] font-medium tracking-wider text-slate-500">
                      {g} ({members.length})
                    </div>
                    {members.map(renderHost)}
                  </div>
                );
              })}
            </>
          );
        })()}
      </div>
    </div>
  );
};
