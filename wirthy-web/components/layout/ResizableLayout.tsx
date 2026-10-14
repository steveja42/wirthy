'use client';

import { useRef, useCallback, useState, type ReactNode } from 'react';

interface ResizableLayoutProps {
  feed: ReactNode;
  detail: ReactNode;
  showDetail?: boolean;
  showFeed?: boolean;
  /** Phone width shows one pane: the list, or (once an item is opened) the detail. */
  detailOpen?: boolean;
  onBack?: () => void;
}

const MIN_FEED = 280;
const MIN_DETAIL = 260;

export default function ResizableLayout({
  feed,
  detail,
  showDetail = true,
  showFeed = true,
  detailOpen = false,
  onBack,
}: ResizableLayoutProps) {
  // null = use CSS fr-based default; number = user has dragged, use px
  const [detailW, setDetailW] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const dragDetail = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    const startX = e.clientX;
    const containerW = container?.offsetWidth ?? window.innerWidth;
    // The detail pane is the grid's last child; measure it rather than estimating.
    const startW = detailW ?? container?.lastElementChild?.getBoundingClientRect().width ?? 600;
    const maxDetail = containerW - MIN_FEED - 4;

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      setDetailW(Math.max(MIN_DETAIL, Math.min(maxDetail, startW - dx)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [detailW]);

  const cols = !showFeed || !showDetail
    ? '1fr'
    : detailW !== null ? `1fr 4px ${detailW}px` : '1fr 4px 1.4fr';

  // The single-pane phone layout is CSS-only (globals.css), keyed on these classes.
  const cls = `main resizable-main${showFeed ? ' main--has-feed' : ''}${detailOpen ? ' main--detail-open' : ''}`;

  return (
    <div ref={containerRef} className={cls} style={{ gridTemplateColumns: cols }}>
      {showFeed && feed}
      {showFeed && showDetail && (
        <div className="col-resizer" onMouseDown={dragDetail} title="Drag to resize" />
      )}
      {showDetail && (
        <div className="detail-pane">
          {showFeed && (
            <button type="button" className="detail-back" onClick={onBack}>← Back</button>
          )}
          {detail}
        </div>
      )}
    </div>
  );
}
