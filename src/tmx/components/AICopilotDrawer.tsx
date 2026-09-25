import React, { useState } from 'react';
import { 
  Send, 
  Play, 
  Copy, 
  Check, 
  Terminal, 
  ShieldAlert, 
  HelpCircle, 
  ArrowRight,
  Code2,
  Pin
} from 'lucide-react';
import type { ThemeConfig, ConnectionHost } from '../types';
import { useT } from '../i18n/context';
interface AICopilotDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  theme: ThemeConfig;
  host: ConnectionHost;
  onInsertCommand: (command: string) => void;
  onExecuteCommand: (command: string) => void;
  className?: string;
}

export const AICopilotDrawer: React.FC<AICopilotDrawerProps> = ({
  isOpen,
  onClose,
  theme,
  host,
  onInsertCommand,
  onExecuteCommand,
  className,
}) => {
  const t = useT()
  const [promptInput, setPromptInput] = useState('');
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  const [history, setHistory] = useState<{
    id: string;
    query: string;
    command: string;
    explanation: string;
    dangerLevel: 'safe' | 'warning' | 'critical';
  }[]>([]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!promptInput.trim()) return;

    let generatedCmd = `grep -rn "${promptInput.trim()}" /var/www/app/`;
    let expl = `根据你输入的需求自然语言自动生成对应的 POSIX 规范命令，适配 ${host.os}。`;
    let danger: 'safe' | 'warning' = 'safe';

    if (promptInput.includes('删') || promptInput.includes('清理') || promptInput.includes('clean') || promptInput.includes('rm')) {
      generatedCmd = `find /var/log -type f -name "*.log" -mtime +7 -delete`;
      expl = '匹配 7 天以前的过时日志并执行安全归档删除。';
      danger = 'warning';
    } else if (promptInput.includes('内存') || promptInput.includes('占用')) {
      generatedCmd = `ps -eo pid,ppid,cmd,%mem,%cpu --sort=-%mem | head -n 15`;
      expl = '按内存消耗倒序展示进程快照。';
    } else if (promptInput.includes('docker') || promptInput.includes('容器')) {
      generatedCmd = `docker stats --no-stream --format "table {{.Container}}\\t{{.CPUPerc}}\\t{{.MemUsage}}"`;
      expl = '输出当前容器瞬间资源消耗快照表格。';
    }

    const newItem = {
      id: `ai-${Date.now()}`,
      query: promptInput.trim(),
      command: generatedCmd,
      explanation: expl,
      dangerLevel: danger,
    };

    setHistory([newItem, ...history]);
    setPromptInput('');
  };

  const handleCopy = (cmd: string) => {
    navigator.clipboard.writeText(cmd);
    setCopiedCmd(cmd);
    setTimeout(() => setCopiedCmd(null), 1500);
  };

  return (
    <div
      className={className || "w-[320px] shrink-0 h-full flex flex-col rounded-md border select-none transition-colors duration-150 z-20"}
      style={{
        backgroundColor: theme.bgCanvas,
        borderColor: theme.borderSubtle,
      }}
    >
      {/* Header (model status moved up here) */}
      <div 
        className="flex items-center justify-between h-10 px-3 border-b shrink-0"
        style={{
          backgroundColor: theme.bgCanvas,
          borderColor: theme.borderSubtle,
        }}
      >
        <div className="flex items-center gap-2">
          <span className="font-semibold text-xs text-slate-100">
            {t('ai.title')}
          </span>
        </div>
        <div
          className="flex items-center gap-2 text-[11px] font-mono truncate"
          style={{ color: theme.textSecondary }}
        >
          <span className="text-emerald-400 shrink-0">{t('common.connected')}</span>
        </div>
      </div>

      {/* History and Suggestions */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2 text-xs">
        {history.length === 0 && (
          <div className="py-10 text-center space-y-1.5">
            <div className="text-xs text-slate-400">{t('ai.empty')}</div>
            <div className="text-[11px] text-slate-500">{t('ai.emptyHint')}</div>
          </div>
        )}
        {history.map((item) => (
          <div 
            key={item.id}
            className="p-2.5 rounded-xl border space-y-1.5 bg-black/20 group transition-all"
            style={{ borderColor: theme.borderSubtle }}
          >
            <div className="flex items-center justify-between gap-2 h-5">
              <div className="font-medium text-slate-200 text-xs flex items-center gap-1.5 truncate">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: theme.accentPrimary }} />
                <span className="truncate">{item.query}</span>
              </div>
              <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                <button
                  onClick={() => onInsertCommand(item.command)}
                  className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-white/10 transition-colors"
                  title={t('ai.insert')}
                >
                  <Terminal className="w-3 h-3" />
                </button>
                <button
                  onClick={() => onExecuteCommand(item.command)}
                  className="p-1 rounded hover:bg-white/10 transition-colors"
                  style={{ color: theme.accentPrimary }}
                  title={t('ai.execute')}
                >
                  <Play className="w-3 h-3 fill-current" />
                </button>
              </div>
            </div>

            {/* Generated Command Box */}
            <div 
              className="group/code p-2 rounded-lg border font-mono-term text-[11px] break-all flex items-start justify-between gap-2"
              style={{
                backgroundColor: theme.bgCanvas,
                borderColor: theme.borderHover,
                color: theme.accentPrimary,
              }}
            >
              <span>{item.command}</span>
              <button
                onClick={() => handleCopy(item.command)}
                className="shrink-0 p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-white/10 transition-opacity opacity-0 group-hover/code:opacity-100"
                title={t('ai.copyCmd')}
              >
                {copiedCmd === item.command ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>

            <p className="text-[10px] text-slate-500 truncate">
              {item.explanation}
            </p>
          </div>
        ))}
      </div>

      {/* Input form */}
      <form 
        onSubmit={handleSubmit}
        className="p-3 border-t shrink-0 space-y-2"
        style={{
          backgroundColor: theme.bgBase,
          borderColor: theme.borderSubtle,
        }}
      >
        <div 
          className="flex items-center gap-2 p-2 rounded-xl border focus-within:border-sky-400 transition-colors"
          style={{
            backgroundColor: theme.bgInput,
            borderColor: theme.borderSubtle,
          }}
        >
          <input
            type="text"
            value={promptInput}
            onChange={(e) => setPromptInput(e.target.value)}
            placeholder={t('ai.contextPlaceholder')}
            className="w-full bg-transparent border-none outline-none text-xs text-slate-200 placeholder-slate-500"
          />
          <button
            type="submit"
            className="p-1.5 rounded-lg text-slate-950 font-semibold shrink-0"
            style={{ backgroundColor: theme.accentPrimary }}
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </form>
    </div>
  );
};
