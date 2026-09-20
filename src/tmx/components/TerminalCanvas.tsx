import React, { useState, useRef, useEffect } from 'react';
import type { TerminalLine, ThemeConfig, ConnectionHost } from '../types';
import { useT } from '../i18n/context';
import { 
  Sparkles, 
  Terminal as TerminalIcon, 
  Shield, 
  CheckCircle2, 
  Copy, 
  Search, 
  X, 
  ArrowUp, 
  ArrowDown,
  Columns2,
  Trash2,
  Camera,
  ClipboardPaste
} from 'lucide-react';

interface TerminalCanvasProps {
  lines: TerminalLine[];
  onExecuteCommand: (command: string) => void;
  host: ConnectionHost;
  theme: ThemeConfig;
  fontSize?: number;
  fontFamily?: string;
  lineHeight?: number;
  cursorStyle?: 'block' | 'line' | 'underline';
  cursorBlink?: boolean;
  showGrid?: boolean;
  showWatermark?: boolean;
  watermarkOpacity?: number;
  isSplit?: boolean;
  paneId?: string;
  onOpenPaletteModal?: () => void;
  onToggleSplit?: () => void;
  onTakeSnapshot?: () => void;
  onOpenCopilot?: () => void;
}

const COMMON_COMMANDS = [
  'fastfetch',
  'neofetch',
  'docker ps',
  'docker stats',
  'htop',
  'git status',
  'git log --oneline -5',
  'ls -la',
  'cat package.json',
  'cat nginx.conf',
  'cat deploy.sh',
  'uptime',
  'df -h',
  'ping 1.1.1.1',
  'palette',
  'clear',
  'ai '
];

export const TerminalCanvas: React.FC<TerminalCanvasProps> = ({
  lines,
  onExecuteCommand,
  host,
  theme,
  fontSize = 14,
  fontFamily = 'Fira Code',
  lineHeight = 1.6,
  cursorStyle = 'block',
  cursorBlink = true,
  showGrid = true,
  showWatermark = true,
  watermarkOpacity = 12,
  isSplit = false,
  paneId = 'primary',
  onOpenPaletteModal,
  onToggleSplit,
  onTakeSnapshot,
  onOpenCopilot,
}) => {
  const t = useT()
  const [inputVal, setInputVal] = useState('');
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [commandHistory, setCommandHistory] = useState<string[]>([
    'fastfetch',
    'docker ps',
    'git status',
  ]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [contextMenu, setContextMenu] = useState<{ visible: boolean; x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  // Auto scroll to bottom on new lines
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  // Close context menu on window click
  useEffect(() => {
    const handleWindowClick = () => setContextMenu(null);
    window.addEventListener('click', handleWindowClick);
    return () => window.removeEventListener('click', handleWindowClick);
  }, []);

  // Keep input focused when clicking the terminal canvas
  const handleCanvasClick = (e: React.MouseEvent) => {
    // If clicking inside search bar or context menu, don't steal focus
    if ((e.target as HTMLElement).closest('.terminal-search-bar')) return;
    inputRef.current?.focus();
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({
      visible: true,
      x: Math.min(e.clientX, window.innerWidth - 220),
      y: Math.min(e.clientY, window.innerHeight - 260),
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const trimmed = inputVal.trim();
      if (trimmed) {
        setCommandHistory((prev) => [...prev, trimmed]);
        onExecuteCommand(trimmed);
      } else {
        onExecuteCommand('');
      }
      setInputVal('');
      setHistoryIndex(null);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length === 0) return;
      const nextIndex = historyIndex === null ? commandHistory.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(nextIndex);
      setInputVal(commandHistory[nextIndex]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex === null) return;
      const nextIndex = historyIndex + 1;
      if (nextIndex >= commandHistory.length) {
        setHistoryIndex(null);
        setInputVal('');
      } else {
        setHistoryIndex(nextIndex);
        setInputVal(commandHistory[nextIndex]);
      }
    } else if (e.key === 'Tab') {
      // Tab Autocompletion
      e.preventDefault();
      const trimmed = inputVal.trim();
      if (trimmed) {
        const match = COMMON_COMMANDS.find((cmd) => cmd.toLowerCase().startsWith(trimmed.toLowerCase()));
        if (match) {
          setInputVal(match);
        }
      }
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      onExecuteCommand('clear');
    } else if (e.key === 'f' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      setIsSearchOpen(true);
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  };

  const handleCopyLine = (content: string, id: string) => {
    navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  // Filter or highlight matching lines
  const matchCount = searchTerm.trim() 
    ? lines.filter(l => l.content.toLowerCase().includes(searchTerm.toLowerCase())).length 
    : 0;

  return (
    <div
      onClick={handleCanvasClick}
      onContextMenu={handleContextMenu}
      className="relative flex-1 h-full overflow-y-auto p-5 select-text cursor-text transition-colors duration-150"
      style={{
        backgroundColor: theme.bgCanvas,
        color: theme.textPrimary,
        fontFamily: `${fontFamily}, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`,
        fontSize: `${fontSize}px`,
        lineHeight: lineHeight,
      }}
    >
      {/* Background Subtle Grid Texture */}
      {showGrid && (
        <div 
          className="absolute inset-0 pointer-events-none opacity-[0.035]"
          style={{
            backgroundImage: `radial-gradient(rgba(255, 255, 255, 0.6) 1px, transparent 1px)`,
            backgroundSize: '24px 24px',
          }}
        />
      )}

      {/* Floating In-Terminal Search Bar (⌘F / Ctrl+F) */}
      {isSearchOpen && (
        <div 
          className="terminal-search-bar absolute top-4 right-6 z-30 flex items-center gap-2 px-3 py-1.5 rounded-xl border shadow-xl backdrop-blur-md animate-in fade-in slide-in-from-top-2"
          style={{
            backgroundColor: theme.bgSurface,
            borderColor: theme.borderHover,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <Search className="w-3.5 h-3.5 text-slate-400" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setIsSearchOpen(false);
                setSearchTerm('');
              }
            }}
            placeholder={t('terminal.searchPlaceholder')}
            className="w-48 bg-transparent text-xs text-slate-100 placeholder-slate-500 border-none outline-none font-sans"
          />
          {searchTerm.trim() && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-slate-400">
              {t('terminal.matches', { count: matchCount })}
            </span>
          )}
          <button
            onClick={() => {
              setIsSearchOpen(false);
              setSearchTerm('');
            }}
            className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Custom Context Menu on Right Click */}
      {contextMenu?.visible && (
        <div 
          className="fixed z-50 py-1.5 rounded-xl border shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 text-xs select-none w-48"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
            backgroundColor: theme.bgSurface,
            borderColor: theme.borderHover,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              const sel = window.getSelection()?.toString();
              if (sel) navigator.clipboard.writeText(sel);
              setContextMenu(null);
            }}
            className="w-full flex items-center justify-between px-3 py-1.5 text-left text-slate-200 hover:bg-white/10 transition-colors"
          >
            <span className="flex items-center gap-2">
              <Copy className="w-3.5 h-3.5 text-slate-400" />
              <span>{t('common.copy')}</span>
            </span>
            <kbd className="text-[9px] font-mono text-slate-500">⌘C</kbd>
          </button>

          <button
            onClick={async () => {
              try {
                const text = await navigator.clipboard.readText();
                if (text) setInputVal((prev) => prev + text);
              } catch {}
              setContextMenu(null);
            }}
            className="w-full flex items-center justify-between px-3 py-1.5 text-left text-slate-200 hover:bg-white/10 transition-colors"
          >
            <span className="flex items-center gap-2">
              <ClipboardPaste className="w-3.5 h-3.5 text-slate-400" />
              <span>{t('terminal.contextMenuPaste')}</span>
            </span>
            <kbd className="text-[9px] font-mono text-slate-500">⌘V</kbd>
          </button>

          <div className="h-[1px] bg-white/10 my-1" />

          <button
            onClick={() => {
              onExecuteCommand('clear');
              setContextMenu(null);
            }}
            className="w-full flex items-center justify-between px-3 py-1.5 text-left text-slate-200 hover:bg-white/10 transition-colors"
          >
            <span className="flex items-center gap-2">
              <Trash2 className="w-3.5 h-3.5 text-slate-400" />
              <span>{t('titleBar.clear')}</span>
            </span>
            <kbd className="text-[9px] font-mono text-slate-500">Ctrl+L</kbd>
          </button>

          {onTakeSnapshot && (
            <button
              onClick={() => {
                onTakeSnapshot();
                setContextMenu(null);
              }}
              className="w-full flex items-center justify-between px-3 py-1.5 text-left text-slate-200 hover:bg-white/10 transition-colors"
            >
              <span className="flex items-center gap-2">
                <Camera className="w-3.5 h-3.5 text-slate-400" />
                <span>{t('titleBar.snapshot')}</span>
              </span>
            </button>
          )}

          {onToggleSplit && (
            <button
              onClick={() => {
                onToggleSplit();
                setContextMenu(null);
              }}
              className="w-full flex items-center justify-between px-3 py-1.5 text-left text-slate-200 hover:bg-white/10 transition-colors"
            >
              <span className="flex items-center gap-2">
                <Columns2 className="w-3.5 h-3.5 text-slate-400" />
                <span>{isSplit ? t('titleBar.splitRestore') : t('titleBar.split')}</span>
              </span>
              <kbd className="text-[9px] font-mono text-slate-500">⌘D</kbd>
            </button>
          )}

          {onOpenCopilot && (
            <>
              <div className="h-[1px] bg-white/10 my-1" />
              <button
                onClick={() => {
                  onOpenCopilot();
                  setContextMenu(null);
                }}
                className="w-full flex items-center justify-between px-3 py-1.5 text-left transition-colors hover:bg-white/10"
                style={{ color: theme.accentPrimary }}
              >
                <span className="flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{t('sidebar.ai')}</span>
                </span>
                <kbd className="text-[9px] font-mono text-slate-500">⌘I</kbd>
              </button>
            </>
          )}
        </div>
      )}

      {/* Terminal Content Lines */}
      <div className="relative z-10 space-y-1">
        {lines.map((line) => {
          const isMatched = searchTerm.trim() && line.content.toLowerCase().includes(searchTerm.toLowerCase());

          if (line.type === 'command') {
            return (
              <div 
                key={line.id} 
                onDoubleClick={() => setInputVal(line.content)}
                className={`group flex items-start gap-2 py-0.5 rounded px-2 -mx-2 transition-colors hover:bg-white/[0.03] ${
                  isMatched ? 'bg-amber-500/20 ring-1 ring-amber-500/40' : ''
                }`}
              >
                <div className="flex items-center gap-1.5 shrink-0 select-none">
                  <span className="font-semibold" style={{ color: theme.accentPrimary }}>
                    {host.user}@{host.name}
                  </span>
                  <span style={{ color: theme.textMuted }}>:</span>
                  <span className="text-emerald-400 font-medium">~/app</span>
                  <span style={{ color: theme.textMuted }}>$</span>
                </div>
                <div className="flex-1 text-slate-100 font-medium break-all">
                  {line.content}
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCopyLine(line.content, line.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-white/10 text-slate-400 text-xs transition-opacity"
                  title={t('common.copy')}
                >
                  {copiedId === line.id ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            );
          }

          if (line.type === 'error') {
            return (
              <div 
                key={line.id} 
                className={`py-0.5 px-2 text-rose-400 whitespace-pre-wrap leading-relaxed rounded ${
                  isMatched ? 'bg-amber-500/20 ring-1 ring-amber-500/40' : ''
                }`}
              >
                {line.content}
              </div>
            );
          }

          if (line.type === 'system') {
            return (
              <div 
                key={line.id} 
                className={`py-1 px-2 whitespace-pre-wrap text-slate-400 text-xs leading-relaxed border-l-2 my-1 ${
                  isMatched ? 'bg-amber-500/20 ring-1 ring-amber-500/40' : ''
                }`} 
                style={{ borderColor: theme.accentPrimary }}
              >
                {line.content}
              </div>
            );
          }

          if (line.type === 'ai') {
            return (
              <div 
                key={line.id} 
                className={`my-2 p-3 rounded-lg border text-xs leading-relaxed ${
                  isMatched ? 'ring-2 ring-amber-500/50' : ''
                }`}
                style={{
                  backgroundColor: theme.accentSoft,
                  borderColor: theme.borderHover,
                  color: theme.textPrimary,
                }}
              >
                <div className="flex items-center gap-1.5 font-semibold mb-1" style={{ color: theme.accentPrimary }}>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{t('ai.title')}</span>
                </div>
                <div className="whitespace-pre-wrap font-sans text-slate-200">
                  {line.content}
                </div>
              </div>
            );
          }

          // Default standard output line
          return (
            <div 
              key={line.id} 
              className={`py-0.2 px-2 whitespace-pre-wrap break-words leading-relaxed text-slate-300 group relative rounded ${
                isMatched ? 'bg-amber-500/25 text-amber-200 font-semibold' : ''
              }`}
            >
              {line.content}
            </div>
          );
        })}

        {/* Current Active Input Prompt Line (with faint highlight row) */}
        <div 
          className="flex items-center gap-2 py-1 px-2 -mx-2 rounded transition-colors"
          style={{
            backgroundColor: 'rgba(255, 255, 255, 0.025)',
          }}
        >
          {/* Prompt PS1 */}
          <div className="flex items-center gap-1.5 shrink-0 select-none">
            <span className="font-semibold" style={{ color: theme.accentPrimary }}>
              {host.user}@{host.name}
            </span>
            <span style={{ color: theme.textMuted }}>:</span>
            <span className="text-emerald-400 font-medium">~/app</span>
            <span className="font-bold" style={{ color: theme.accentPrimary }}>$</span>
          </div>

          {/* Interactive Shell Input */}
          <div className="flex-1 relative flex items-center">
            <input
              ref={inputRef}
              type="text"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
              spellCheck={false}
              autoComplete="off"
              className="w-full bg-transparent outline-none border-none text-slate-100 font-mono-term text-sm p-0 m-0 caret-transparent"
              placeholder=""
            />

            {/* Custom Modern Cursor according to user preferences */}
            {cursorStyle === 'block' && (
              <span 
                className={`inline-block w-2.5 h-4.5 -ml-1 align-middle ${cursorBlink ? 'animate-pulse' : ''}`}
                style={{
                  backgroundColor: theme.accentPrimary,
                  opacity: 0.85,
                }}
              />
            )}
            {cursorStyle === 'line' && (
              <span 
                className={`inline-block w-0.5 h-4.5 -ml-0.5 align-middle ${cursorBlink ? 'animate-pulse' : ''}`}
                style={{
                  backgroundColor: theme.accentPrimary,
                  opacity: 0.95,
                }}
              />
            )}
            {cursorStyle === 'underline' && (
              <span 
                className={`inline-block w-2.5 h-0.5 self-end -ml-1 mb-0.5 ${cursorBlink ? 'animate-pulse' : ''}`}
                style={{
                  backgroundColor: theme.accentPrimary,
                  opacity: 0.95,
                }}
              />
            )}
          </div>
        </div>

        {/* Scroll anchor */}
        <div ref={terminalEndRef} />
      </div>

      {/* Subtle Bottom Right Watermark Logo */}
      {showWatermark && (
        <div 
          className="absolute bottom-4 right-6 pointer-events-none select-none flex items-center gap-2 transition-opacity duration-300"
          style={{ opacity: (watermarkOpacity || 12) / 100 }}
        >
          <div 
            className="w-6 h-6 rounded-lg flex items-center justify-center border border-white/20"
            style={{ backgroundColor: theme.bgSurface }}
          >
            <TerminalIcon className="w-3.5 h-3.5 text-slate-300" />
          </div>
          <span className="text-xs font-semibold tracking-wider uppercase text-slate-400 font-mono">
            TMX SSH
          </span>
        </div>
      )}
    </div>
  );
};
