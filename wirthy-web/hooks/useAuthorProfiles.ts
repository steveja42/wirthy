// Subscribes to Nostr kind:0 profile metadata for a set of pubkeys and returns a
// pubkey -> AuthorProfile map. Re-subscribes only when the set of distinct pubkeys
// changes (not on every append or re-order). The profiles module is dynamically
// imported so it never runs server-side.

'use client';

import { useState, useEffect, useMemo } from 'react';
import type { ClipData } from '@/lib/types';
import type { AuthorProfile } from '@/lib/nostr/profiles';

const EMPTY: Map<string, AuthorProfile> = new Map();

export function useProfiles(pubkeys: Iterable<string>): Map<string, AuthorProfile> {
  // Stable key over the distinct set, so the effect only re-runs when membership changes.
  const key = [...new Set(pubkeys)].sort().join(',');

  // Tagged with the set it was fetched for, so a membership change reads as empty
  // during render instead of via a setState at the top of the effect.
  const [entry, setEntry] = useState<{ key: string; profiles: Map<string, AuthorProfile> } | null>(null);
  const profiles = key && entry?.key === key ? entry.profiles : EMPTY;

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    (async () => {
      try {
        const { subscribeAuthorProfiles } = await import('@/lib/nostr/profiles');
        if (cancelled) return;
        cleanup = subscribeAuthorProfiles(key.split(','), (next) => {
          if (!cancelled) setEntry({ key, profiles: next });
        });
      } catch {
        if (!cancelled) setEntry({ key, profiles: EMPTY });
      }
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [key]);

  return profiles;
}

/** Profiles of the distinct authors of `clips`. */
export function useAuthorProfiles(clips: ClipData[]): Map<string, AuthorProfile> {
  const pubkeys = useMemo(() => clips.flatMap((c) => (c.capture.authorPubkey ? [c.capture.authorPubkey] : [])), [clips]);
  return useProfiles(pubkeys);
}
