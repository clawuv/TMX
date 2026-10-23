import React, { useEffect, useRef, useState } from 'react';

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
  /** Double-click the handle to restore the default width (fallback when no onCollapse) */
  onReset: () => void;
  /** Double-click the handle to collapse (close) the drawer; wins over onReset */
  onCollapse?: () => void;
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
  onCollapse,
  children,
}) => {
  const t = useT()
  const [isDragging, setIsDragging] = useState(false);
  // Double-click detection lives in mousedown: preventDefault() there stops
  // Chromium from synthesizing native dblclick events on the handle.
  const lastHandleTapRef = useRef(0);

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
      {/* Drag handle. The visible 1px divider is the docked drawer's own right
          border — this overlay only provides the hit area, a hover hint, and a
          stronger column while dragging. */}
      <div
        onMouseDown={(e) => {
          e.preventDefault();
          // detail===2 covers CDP/automation double-presses that skip the first
          // mousedown; the timing window catches everything else.
          const now = Date.now();
          if (e.detail === 2 || now - lastHandleTapRef.current < 350) {
            lastHandleTapRef.current = 0;
            setIsDragging(false);
            if (onCollapse) onCollapse();
            else onReset();
            return;
          }
          lastHandleTapRef.current = now;
          setIsDragging(true);
        }}
        onDoubleClick={(e) => {
          e.preventDefault();
          if (onCollapse) onCollapse();
          else onReset();
        }}
        title={t('dock.resizeHint')}
        className={`absolute inset-y-0 right-0 w-[5px] -mr-[2px] cursor-col-resize z-30 ${
          isDragging ? 'bg-sky-500/15' : 'hover:bg-white/5'
        } transition-colors`}
      >
        {isDragging && <div className="absolute inset-y-0 right-[2px] w-[2px] bg-sky-400" />}
      </div>
    </div>
  );
};
