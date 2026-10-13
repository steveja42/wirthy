// Share action for one public cast: the system share sheet on touch devices, otherwise a
// popover with the post's link, a Copy button, a nostr: link, and a link to the post page.

'use client';

import { useEffect, useRef, useState } from 'react';

interface ShareButtonProps {
  /** Site-relative post path, /c/<naddr|note>. */
  href: string;
  title: string;
}

type Copied = 'web' | 'nostr' | null;

// Desktop Chrome/Edge also expose navigator.share (the OS share dialog), but on a
// mouse-driven device a copyable link is what people expect.
function prefersNativeShare(): boolean {
  return typeof navigator.share === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

export default function ShareButton({ href, title }: ShareButtonProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<Copied>(null);
  const [onPostPage, setOnPostPage] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resetTimer = useRef<number | undefined>(undefined);

  const webUrl = typeof window === 'undefined' ? href : new URL(href, window.location.origin).href;
  const nostrUrl = `nostr:${href.replace(/^\/c\//, '')}`;

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      // Stop here so Escape closes the popover without also leaving fullscreen.
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey, true);
    inputRef.current?.select();
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  const toggle = async () => {
    if (open) { setOpen(false); return; }
    if (prefersNativeShare()) {
      try {
        await navigator.share({ title, url: webUrl });
        return;
      } catch (err) {
        if ((err as DOMException)?.name === 'AbortError') return;
        // Any other failure (no share target, permission) falls back to the popover.
      }
    }
    setOnPostPage(window.location.pathname === href);
    setCopied(null);
    setOpen(true);
  };

  const copy = async (text: string, which: Exclude<Copied, null>) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard refused: leave the link selected so Ctrl+C still works.
      inputRef.current?.select();
    }
  };

  return (
    <div className="share" ref={rootRef}>
      <button
        className="btn-detail-share"
        onClick={toggle}
        title="Share this post"
        aria-label="Share this post"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
          <polyline points="16 6 12 2 8 6" />
          <line x1="12" y1="2" x2="12" y2="15" />
        </svg>
      </button>

      {open && (
        <div className="share-popover" role="dialog" aria-label="Share this post">
          <div className="share-label">Link to this post</div>
          <div className="share-row">
            <input
              ref={inputRef}
              className="share-url"
              value={webUrl}
              readOnly
              aria-label="Post link"
              onFocus={(e) => e.currentTarget.select()}
            />
            <button className="btn primary share-copy" onClick={() => copy(webUrl, 'web')}>
              {copied === 'web' ? 'Copied ✓' : 'Copy'}
            </button>
          </div>
          <div className="share-foot">
            <button className="share-text-btn" onClick={() => copy(nostrUrl, 'nostr')} title={nostrUrl}>
              {copied === 'nostr' ? 'Nostr link copied ✓' : 'Copy Nostr link'}
            </button>
            {!onPostPage && <a href={href} className="share-open">Open post page →</a>}
          </div>
        </div>
      )}
    </div>
  );
}
