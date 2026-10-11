// Manages the live Nostr Cast feed subscription.
// Starts with an empty list and prepends incoming events, deduplicated and
// capped at 200. Feed and parse modules are dynamically imported so they
// never run server-side.

'use client';

import { useState, useEffect } from 'react';
import type { ClipData } from '@/lib/types';
import { scopeKey, scopeFromKey } from '@/lib/feed-url';

type FeedStatus = 'connecting' | 'live' | 'error';

// A companion kind-1 note (a summary + link) and its kind-30023 long-form share
// this key: author pubkey + the long-form's `d` id. The note exposes it via its
// `a` tag, the long-form via its own `d` tag (both surfaced as capture.longFormId
// by parseEvent). Standalone clips fall back to their own event id.
export function dedupKey(clip: ClipData): string {
  const { longFormId, authorPubkey, id } = clip.capture;
  return longFormId && authorPubkey ? `${authorPubkey}:${longFormId}` : id;
}

// Of two clips sharing a dedup key, prefer the richer kind-30023 long-form.
export function preferLongForm(a: ClipData, b: ClipData): ClipData {
  const aIsLong = a.capture.kind === 30023;
  const bIsLong = b.capture.kind === 30023;
  if (aIsLong && !bIsLong) return a;
  if (bIsLong && !aIsLong) return b;
  return a; // both same kind — keep the incumbent
}

const NO_CLIPS: ClipData[] = [];

/**
 * `scope` is a `scopeKey()` string (lib/feed-url.ts) narrowing the REQ relay-side, or
 * null to hold off subscribing (Explore passes null until it has read its URL filters).
 */
export function useCastFeed(scope: string | null = scopeKey({})) {
  // Tagged with the relay epoch + scope the casts came from. A mode flip or a new
  // scope therefore reads as an empty feed during render, rather than needing a
  // setClips([]) reset at the top of the subscribe effect.
  const [entry, setEntry] = useState<{ feed: string; clips: ClipData[] }>({ feed: '', clips: NO_CLIPS });
  // Status is feed-scoped for the same reason: re-subscribing is a fresh
  // connection, so it reads back as 'connecting' during render instead of being
  // reset by a setState in the effect.
  const [statusEntry, setStatus] = useState<{ feed: string; status: FeedStatus }>({ feed: '', status: 'connecting' });
  // Bumped whenever the dev relay mode flips, forcing the subscribe effect to
  // tear down its pool and re-subscribe against the new relay set.
  const [relayEpoch, setRelayEpoch] = useState(0);
  const feed = scope === null ? '' : `${relayEpoch}#${scope}`;

  useEffect(() => {
    let active = true;
    let cleanupSub: (() => void) | undefined;
    import('@/lib/constants').then(({ onRelayModeChange }) => {
      if (!active) return;
      cleanupSub = onRelayModeChange(() => setRelayEpoch((e) => e + 1));
    });
    return () => { active = false; cleanupSub?.(); };
  }, []);

  useEffect(() => {
    if (scope === null) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    const init = async () => {
      try {
        const [{ subscribeFeed }, { parseEvent }] = await Promise.all([
          import('@/lib/nostr/feed'),
          import('@/lib/nostr/parse'),
        ]);
        if (cancelled) return;
        cleanup = subscribeFeed(
          (e) => {
            if (cancelled) return;
            const clip = parseEvent(e);
            setEntry((prevEntry) => {
              // Casts from a superseded relay set or scope are dropped rather than
              // merged: a mode flip or a new filter scope starts the feed over.
              const prev = prevEntry.feed === feed ? prevEntry.clips : NO_CLIPS;
              // Companion kind-1 note + kind-30023 long-form share a dedup key
              // (author + long-form id); keep only one, PREFERRING the richer
              // 30023. Standalone clips key on their own event id.
              const key = dedupKey(clip);
              const existingIdx = prev.findIndex((c) => dedupKey(c) === key);
              let next: ClipData[];
              if (existingIdx >= 0) {
                const existing = prev[existingIdx];
                // Same event re-delivered, or the less-preferred half of a pair:
                // keep what we have.
                if (preferLongForm(existing, clip) === existing) {
                  return prevEntry.feed === feed ? prevEntry : { feed, clips: prev };
                }
                next = [...prev];
                next[existingIdx] = clip;
              } else {
                next = [clip, ...prev];
              }
              // Sort by timestamp descending so newest is always on top,
              // regardless of the order in which relays deliver events.
              return {
                feed,
                clips: next
                  .sort((a, b) => b.capture.timestamp - a.capture.timestamp)
                  .slice(0, 200),
              };
            });
          },
          () => { if (!cancelled) setStatus({ feed, status: 'live' }); },
          scopeFromKey(scope),
        );
      } catch {
        if (!cancelled) setStatus({ feed, status: 'error' });
      }
    };

    init();
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [feed, scope]);

  const clips = feed !== '' && entry.feed === feed ? entry.clips : NO_CLIPS;
  const status = feed !== '' && statusEntry.feed === feed ? statusEntry.status : 'connecting';
  return { clips, status };
}
