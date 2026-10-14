// Collapsed "Filters" button for the Explore / Clips toolbar. Hovering with a mouse
// opens the panel; a click or tap pins it open until another click, an outside click,
// or Escape.

'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type React from 'react';

interface FilterWidgetProps {
  /** Number of active filters, shown as a badge on the button. */
  activeCount: number;
  children: ReactNode;
}

// Grace period so the pointer can cross the gap from the button into the panel.
const CLOSE_DELAY_MS = 200;

// Keyed on the event's pointer, not `(hover: hover)`: a touchscreen laptop reports
// hover:none even while a mouse is in use. A tap is pointerType 'touch' → click only.
const isMouse = (e: React.PointerEvent) => e.pointerType === 'mouse';

function FilterIcon() {
  return (
    <svg className="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 5h18l-7 8.5V19l-4 2v-7.5z" />
    </svg>
  );
}

export default function FilterWidget({ activeCount, children }: FilterWidgetProps) {
  const [hoverOpen, setHoverOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelId = useId();
  const open = hoverOpen || pinned;

  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };

  useEffect(() => cancelClose, []);

  useEffect(() => {
    if (!pinned) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) { setPinned(false); setHoverOpen(false); }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setPinned(false); setHoverOpen(false); }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [pinned]);

  return (
    <div
      ref={wrapRef}
      className={`filter-widget${open ? ' filter-widget--open' : ''}`}
      onPointerEnter={(e) => {
        if (!isMouse(e)) return;
        cancelClose();
        setHoverOpen(true);
      }}
      onPointerLeave={(e) => {
        if (!isMouse(e)) return;
        cancelClose();
        closeTimer.current = setTimeout(() => setHoverOpen(false), CLOSE_DELAY_MS);
      }}
    >
      <button
        type="button"
        className={`filter-widget-btn${pinned ? ' pinned' : ''}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          // Clicking a hover-opened panel pins it; clicking a pinned one closes it.
          if (pinned) { setPinned(false); setHoverOpen(false); } else setPinned(true);
        }}
      >
        <FilterIcon />
        <span>Filters</span>
        {activeCount > 0 && <span className="filter-widget-count">{activeCount}</span>}
      </button>
      {open && (
        <div id={panelId} className="filter-widget-panel" role="dialog" aria-label="Filters">
          {children}
        </div>
      )}
    </div>
  );
}
