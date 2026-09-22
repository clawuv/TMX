import React, { useState } from 'react';
import { 
  X, 
  Check, 
  Copy, 
  Palette, 
  Sparkles, 
  ShieldCheck, 
  Eye, 
  Terminal as TerminalIcon,
  SunMoon,
  Info
} from 'lucide-react';
import type { ThemeConfig } from '../types';
import { useT } from '../i18n/context';
import { THEMES } from '../data/themes';

interface PaletteDesignModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentTheme: ThemeConfig;
  onSelectTheme: (theme: ThemeConfig) => void;
}

export const PaletteDesignModal: React.FC<PaletteDesignModalProps> = ({
  isOpen,
  onClose,
  currentTheme,
  onSelectTheme,
}) => {
  const t = useT()
  const [copiedHex, setCopiedHex] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleCopy = (hex: string) => {
    navigator.clipboard.writeText(hex);
    setCopiedHex(hex);
    setTimeout(() => setCopiedHex(null), 1500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div
        className="relative w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl border overflow-hidden text-slate-200"
        style={{
          backgroundColor: currentTheme.bgSurface,
          borderColor: currentTheme.borderHover,
        }}
      >
        {/* Header */}
        <div 
          className="flex items-center justify-between px-6 py-4 border-b shrink-0"
          style={{
            backgroundColor: currentTheme.bgBase,
            borderColor: currentTheme.borderSubtle,
          }}
        >
          <div className="flex items-center gap-3">
            <div 
              className="w-9 h-9 rounded-xl flex items-center justify-center border"
              style={{
                backgroundColor: currentTheme.bgActive,
                borderColor: currentTheme.borderHover,
                color: currentTheme.accentPrimary,
              }}
            >
              <Palette className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-slate-100">
                  {t('paletteDesign.subtitle')}
                </h2>
                <span 
                  className="px-2 py-0.5 rounded-full text-[10px] font-medium border"
                  style={{
                    backgroundColor: currentTheme.accentSoft,
                    borderColor: currentTheme.accentPrimary,
                    color: currentTheme.accentPrimary,
                  }}
                >
                  {t('paletteDesign.custom')}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {t('paletteDesign.principle')}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="overflow-y-auto p-6 space-y-6 flex-1 text-xs">
          {/* Theme Selector Tabs */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="font-semibold text-slate-200 text-sm">
                {t('paletteDesign.themes')}
              </span>
              <span className="text-slate-400 text-xs">
                {t('paletteDesign.current')} <strong style={{ color: currentTheme.accentPrimary }}>{currentTheme.nameCn}</strong>
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {THEMES.map((th) => {
                const isSelected = th.id === currentTheme.id;
                return (
                  <button
                    key={th.id}
                    onClick={() => onSelectTheme(th)}
                    className="flex flex-col p-3 rounded-xl border text-left transition-all duration-200 group relative"
                    style={{
                      backgroundColor: th.bgBase,
                      borderColor: isSelected ? th.accentPrimary : th.borderSubtle,
                      boxShadow: isSelected ? `0 0 0 1px ${th.accentPrimary}` : 'none',
                    }}
                  >
                    {/* Top title & badge */}
                    <div className="flex items-center justify-between w-full mb-2">
                      <span className="font-semibold text-xs text-slate-100 group-hover:text-sky-300 transition-colors">
                        {th.name}
                      </span>
                      {isSelected && (
                        <span 
                          className="w-4 h-4 rounded-full flex items-center justify-center text-white"
                          style={{ backgroundColor: th.accentPrimary }}
                        >
                          <Check className="w-2.5 h-2.5" />
                        </span>
                      )}
                    </div>

                    <p className="text-[11px] text-slate-400 mb-3 line-clamp-2">
                      {th.tagline}
                    </p>

                    {/* Color Swatch Preview strip */}
                    <div className="flex items-center gap-1.5 mt-auto pt-2 border-t border-white/5 w-full">
                      <span className="w-4 h-4 rounded-md border border-white/20" style={{ backgroundColor: th.bgCanvas }} title={t('paletteDesign.tokenBase')} />
                      <span className="w-4 h-4 rounded-md border border-white/20" style={{ backgroundColor: th.bgSurface }} title={t('paletteDesign.tokenSurface')} />
                      <span className="w-4 h-4 rounded-md border border-white/20" style={{ backgroundColor: th.bgActive }} title={t('paletteDesign.tokenActive')} />
                      <span className="w-4 h-4 rounded-md border border-white/20" style={{ backgroundColor: th.accentPrimary }} title={t('paletteDesign.tokenAccent')} />
                      <span className="w-4 h-4 rounded-md border border-white/20" style={{ backgroundColor: th.accentSuccess }} title={t('paletteDesign.tokenSuccess')} />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Current Palette Detailed Spec Breakdown */}
          <div 
            className="p-4 rounded-xl border space-y-4"
            style={{
              backgroundColor: currentTheme.bgBase,
              borderColor: currentTheme.borderSubtle,
            }}
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: currentTheme.accentPrimary }} />
                  {t('paletteDesign.tokens', { name: currentTheme.nameCn })}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {currentTheme.description}
                </p>
              </div>
            </div>

            {/* Core UI Tokens */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {[
                { label: `Base`, hex: currentTheme.bgBase, role: t('paletteDesign.roleSidebar') },
                { label: `Surface`, hex: currentTheme.bgSurface, role: t('paletteDesign.roleTitlebar') },
                { label: `Canvas`, hex: currentTheme.bgCanvas, role: t('paletteDesign.roleTerminal') },
                { label: `Active`, hex: currentTheme.bgActive, role: t('paletteDesign.roleHighlight') },
                { label: `Accent`, hex: currentTheme.accentPrimary, role: t('paletteDesign.tokenAccent') },
                { label: `Border`, hex: '1px rgba/0.08', role: t('paletteDesign.roleHairline') },
              ].map((token) => (
                <div
                  key={token.label}
                  onClick={() => handleCopy(token.hex)}
                  className="p-2.5 rounded-lg border bg-white/[0.02] hover:bg-white/[0.05] cursor-pointer transition-colors border-white/10 group"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span 
                      className="w-5 h-5 rounded-md border border-white/20"
                      style={{ backgroundColor: token.hex.startsWith('#') ? token.hex : currentTheme.borderHover }}
                    />
                    <span className="text-[10px] text-slate-400 group-hover:text-slate-200">
                      {copiedHex === token.hex ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 opacity-0 group-hover:opacity-100" />}
                    </span>
                  </div>
                  <div className="font-semibold text-slate-200 text-[11px] truncate">{token.label}</div>
                  <div className="font-mono text-[10px] text-slate-400 mt-0.5">{token.hex}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{token.role}</div>
                </div>
              ))}
            </div>

            {/* ANSI 16 Terminal Colors Spec */}
            <div className="pt-2 border-t border-white/5">
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-slate-300 text-xs">
                  {t('paletteDesign.ansi')}
                </span>
                <span className="text-[11px] text-slate-400 font-mono">
                  {t('paletteDesign.wcag')}
                </span>
              </div>

              <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
                {[
                  { name: 'Black', hex: currentTheme.ansi.black },
                  { name: 'Red', hex: currentTheme.ansi.red },
                  { name: 'Green', hex: currentTheme.ansi.green },
                  { name: 'Yellow', hex: currentTheme.ansi.yellow },
                  { name: 'Blue', hex: currentTheme.ansi.blue },
                  { name: 'Magenta', hex: currentTheme.ansi.magenta },
                  { name: 'Cyan', hex: currentTheme.ansi.cyan },
                  { name: 'White', hex: currentTheme.ansi.white },
                  { name: 'Br.Black', hex: currentTheme.ansi.brightBlack },
                  { name: 'Br.Red', hex: currentTheme.ansi.brightRed },
                  { name: 'Br.Green', hex: currentTheme.ansi.brightGreen },
                  { name: 'Br.Yellow', hex: currentTheme.ansi.brightYellow },
                  { name: 'Br.Blue', hex: currentTheme.ansi.brightBlue },
                  { name: 'Br.Magenta', hex: currentTheme.ansi.brightMagenta },
                  { name: 'Br.Cyan', hex: currentTheme.ansi.brightCyan },
                  { name: 'Br.White', hex: currentTheme.ansi.brightWhite },
                ].map((item) => (
                  <div
                    key={item.name}
                    onClick={() => handleCopy(item.hex)}
                    className="p-1.5 rounded-lg border border-white/5 bg-black/20 hover:border-white/20 cursor-pointer text-center group"
                  >
                    <div 
                      className="w-full h-4 rounded mb-1"
                      style={{ backgroundColor: item.hex }}
                    />
                    <div className="text-[10px] font-medium text-slate-300 truncate">{item.name}</div>
                    <div className="text-[9px] font-mono text-slate-500 group-hover:text-slate-300">{item.hex}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Design Rationale (Why this solves Electerm's flaws) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div 
              className="p-4 rounded-xl border"
              style={{
                backgroundColor: currentTheme.bgBase,
                borderColor: currentTheme.borderSubtle,
              }}
            >
              <div className="flex items-center gap-2 font-semibold text-slate-200 mb-1.5">
                <Eye className="w-4 h-4 text-sky-400" />
                <span>1. 拒绝纯黑，告别视觉割裂</span>
              </div>
              <p className="text-slate-400 text-xs leading-relaxed">
                放弃刺激极强且容易让眼部聚焦疲劳的 `#000000` 纯黑底，采用低饱和蓝冷灰（如 `#15181F`），在确保对比度的同时极大软化边缘光晕。
              </p>
            </div>

            <div 
              className="p-4 rounded-xl border"
              style={{
                backgroundColor: currentTheme.bgBase,
                borderColor: currentTheme.borderSubtle,
              }}
            >
              <div className="flex items-center gap-2 font-semibold text-slate-200 mb-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>2. 发丝微边框替代厚重卡片</span>
              </div>
              <p className="text-slate-400 text-xs leading-relaxed">
                使用 `1px rgba(255, 255, 255, 0.08)` 半透明发丝边框划分标题栏、侧边栏和工作区，不产生额外视觉厚重感，界面轻盈通透。
              </p>
            </div>

            <div 
              className="p-4 rounded-xl border"
              style={{
                backgroundColor: currentTheme.bgBase,
                borderColor: currentTheme.borderSubtle,
              }}
            >
              <div className="flex items-center gap-2 font-semibold text-slate-200 mb-1.5">
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span>3. 极克制的强调色策略</span>
              </div>
              <p className="text-slate-400 text-xs leading-relaxed">
                UI 控件常态保持中性低对比度，仅在焦点光标、活动标签高亮、延时状态指标处使用单一主题强调色（Accent Cyan），实现真正的视觉降噪。
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div 
          className="flex items-center justify-between px-6 py-3 border-t shrink-0"
          style={{
            backgroundColor: currentTheme.bgBase,
            borderColor: currentTheme.borderSubtle,
          }}
        >
          <div className="text-xs text-slate-400">
            提示：也可以在终端中输入 <code className="px-1.5 py-0.5 rounded bg-white/10 font-mono text-sky-300">palette</code> 随时唤起本面板。
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: currentTheme.accentPrimary, color: '#0B0F19' }}
          >
            应用并返回工作台
          </button>
        </div>
      </div>
    </div>
  );
};
