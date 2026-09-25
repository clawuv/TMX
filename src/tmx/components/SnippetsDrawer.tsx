import React, { useState } from 'react';
import {
  Play,
  Copy,
  Check,
  Plus,
  Search,
  Terminal,
  Trash2,
  Pin
} from 'lucide-react';
import type { QuickSnippet, ThemeConfig } from '../types';
import { useT } from '../i18n/context';
interface SnippetsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  snippets: QuickSnippet[];
  theme: ThemeConfig;
  onRunSnippet: (command: string) => void;
  onAddSnippet: (snippet: QuickSnippet) => void;
  onDeleteSnippet?: (id: string) => void;
  className?: string;
}

export const SnippetsDrawer: React.FC<SnippetsDrawerProps> = ({
  isOpen,
  onClose,
  snippets,
  theme,
  onRunSnippet,
  onAddSnippet,
  onDeleteSnippet,
  className,
}) => {
  const t = useT()
  const [search, setSearch] = useState('');
  const [selectedCat, setSelectedCat] = useState<string>('All');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  // New snippet form state
  const [formTitle, setFormTitle] = useState('');
  const [formCommand, setFormCommand] = useState('');
  const [formCategory, setFormCategory] = useState<QuickSnippet['category']>('Linux');
  const [formDesc, setFormDesc] = useState('');

  if (!isOpen) return null;

  const categories = ['All', 'Linux', 'Mac', 'Windows'];

  const filtered = snippets.filter((s) => {
    const matchesSearch = s.title.toLowerCase().includes(search.toLowerCase()) || s.command.includes(search);
    const matchesCat = selectedCat === 'All' || s.category === selectedCat;
    return matchesSearch && matchesCat;
  });

  const handleCopy = (command: string, id: string) => {
    navigator.clipboard.writeText(command);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleCreateSnippet = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim() || !formCommand.trim()) return;

    const newS: QuickSnippet = {
      id: `snip-${Date.now()}`,
      title: formTitle.trim(),
      command: formCommand.trim(),
      category: formCategory,
      description: formDesc.trim() || t('snippets.defaultDesc'),
    };

    onAddSnippet(newS);
    setFormTitle('');
    setFormCommand('');
    setFormDesc('');
    setIsAdding(false);
  };

  return (
    <div
      className={className || "w-[320px] shrink-0 h-full flex flex-col border-r select-none transition-colors duration-150 z-20"}
      style={{
        backgroundColor: theme.bgCanvas,
        borderColor: theme.borderSubtle,
      }}
    >
      {/* Header */}
      <div 
        className="flex items-center justify-between h-10 px-3 border-b shrink-0"
        style={{
          backgroundColor: theme.bgSurface,
          borderColor: theme.borderSubtle,
        }}
      >
        <div className="flex items-center gap-2">
          <span className="font-semibold text-xs text-slate-100">
            {t('snippets.title')}
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

      {/* Add Snippet Form */}
      {isAdding && (
        <form onSubmit={handleCreateSnippet} className="p-3 space-y-2 bg-black/20 text-xs">
          <div className="font-semibold text-slate-200">{t('snippets.formTitle')}</div>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder={t('snippets.namePlaceholder')}
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              className="flex-1 min-w-0 px-2.5 py-1.5 rounded bg-black/40 border border-white/10 text-slate-200 outline-none focus:border-sky-400"
              required
            />
            <select
              value={formCategory}
              onChange={(e) => setFormCategory(e.target.value as QuickSnippet['category'])}
              className="px-2 py-1.5 rounded bg-black/40 border border-white/10 text-slate-200 outline-none"
              title={t('snippets.category')}
            >
              <option value="Linux">Linux</option>
              <option value="Mac">Mac</option>
              <option value="Windows">Windows</option>
            </select>
          </div>
          <input
            type="text"
            placeholder={t('snippets.descPlaceholder')}
            value={formDesc}
            onChange={(e) => setFormDesc(e.target.value)}
            className="w-full px-2.5 py-1.5 rounded bg-black/40 border border-white/10 text-slate-200 outline-none focus:border-sky-400"
          />
          <textarea
            placeholder={t('snippets.cmdPlaceholder')}
            value={formCommand}
            onChange={(e) => setFormCommand(e.target.value)}
            rows={2}
            className="w-full px-2.5 py-1.5 rounded bg-black/40 border border-white/10 text-slate-200 outline-none font-mono text-[11px] focus:border-sky-400 resize-none"
            required
          />
          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              className="flex-1 py-1.5 rounded bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold"
            >
              {t('snippets.saveSnippet')}
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

      {/* Filter and Search */}
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
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('snippets.searchPlaceholder')}
            className="w-full bg-transparent border-none outline-none text-xs text-slate-200 placeholder-slate-500"
          />
        </div>

        <div className="flex items-center gap-0.5 overflow-x-auto no-scrollbar pt-1">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setSelectedCat(c)}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                selectedCat === c
                  ? 'bg-white/15 text-slate-100 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2 text-xs">
        {filtered.length === 0 && (
          <div className="py-10 text-center space-y-1.5">
            <div className="text-xs text-slate-400">
              {search || selectedCat !== 'All' ? t('snippets.noMatch') : t('snippets.empty')}
            </div>
            {snippets.length === 0 && !search && selectedCat === 'All' && (
              <div className="text-[11px] text-slate-500">{t('snippets.emptyHint')}</div>
            )}
          </div>
        )}
        {filtered.map((s) => (
          <div
            key={s.id}
            className="p-2.5 rounded-xl border space-y-1.5 group hover:border-white/20 hover:shadow-lg hover:shadow-black/30 transition-all"
            style={{ backgroundColor: theme.bgSurface, borderColor: theme.borderSubtle }}
          >
            <div className="flex items-center justify-between gap-2 h-5">
              <div className="flex items-center gap-1.5 truncate">
                <span className="font-medium text-slate-200 truncate">{s.title}</span>
              </div>
              <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                {onDeleteSnippet && (
                  <button
                    onClick={() => onDeleteSnippet(s.id)}
                    className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-white/10 transition-colors"
                    title={t('snippets.delete')}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
                <button
                  onClick={() => onRunSnippet(s.command)}
                  className="p-1 rounded hover:bg-white/10 transition-colors"
                  style={{ color: theme.accentPrimary }}
                  title={t('snippets.runSnippet')}
                >
                  <Play className="w-3 h-3 fill-current" />
                </button>
              </div>
            </div>

            <div 
              className="group/code relative p-2 rounded-lg font-mono-term text-[11px] break-all border"
              style={{
                backgroundColor: theme.bgCanvas,
                borderColor: theme.borderSubtle,
                color: theme.accentPrimary,
              }}
            >
              {s.command}
              <button
                onClick={() => handleCopy(s.command, s.id)}
                className="absolute right-1 top-1 p-1 rounded opacity-0 group-hover/code:opacity-100 transition-opacity text-slate-400 hover:text-slate-200 hover:bg-white/10"
                style={{ backgroundColor: theme.bgCanvas }}
                title={t('snippets.copySnippet')}
              >
                {copiedId === s.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>

            <p className="text-[10px] text-slate-500 truncate">
              {s.description}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};
