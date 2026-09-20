import React, { useEffect, useState } from 'react';

import type { ThemeConfig } from '../types';
import { useT } from '../i18n/context';

interface ResizableDockProps {
  /** Preferred width as a percentage of the window width (kept in sync while dragging) */
  widthPct: number;
  theme: ThemeConfig;
  /** Hard floor so the drawer content never collapses */
  minPx?: number;
  /** Never let the dock eat more than this share of the window */
  maxPct?: number;
  onChange: (pct: number) => void;
  /** Double-click the handle to restore the default width */
  onReset: () => void;
  children: React.ReactNode;
}

/**
 * Docked-drawer shell with a draggable right edge. Width is percentage-based so it
 * follows window resizes, while CSS clamp() enforces the min/max bounds.
 */
export const ResizableDock: React.FC<ResizableDockProps> = ({
  widthPct,
  minPx = 240,
  maxPct = 45,
  onChange,
  onReset,
  theme,
  children,
}) => {
  const t = useT()
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      onChange(Math.min(maxPct, Math.max(5, (e.clientX / window.innerWidth) * 100)));
    };
    const onUp = () => setIsDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging, maxPct, onChange]);

  return (
    <div
      className="soft-dock relative h-full shrink-0 flex min-w-0"
      style={{ width: `clamp(${minPx}px, ${widthPct}%, ${maxPct}%)` }}
    >
      {children}
      {/* Divider: subtle inset line (gaps at both ends) that highlights on hover */}
      <div
        onMouseDown={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDoubleClick={onReset}
        title={t('dock.resizeHint')}
        className={`absolute inset-y-3 right-0 w-[5px] -mr-[2px] cursor-col-resize z-30 flex items-center justify-center ${
          isDragging ? 'bg-sky-500/15' : 'hover:bg-white/5'
        } transition-colors`}
      >
        <div
          className={`h-full w-px transition-colors ${isDragging ? 'w-[2px] bg-sky-400' : ''}`}
          style={
            isDragging
              ? undefined
              : { backgroundColor: theme.borderSubtle, opacity: 0.4 }
          }
        />
      </div>
    </div>
  );
};
