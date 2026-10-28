// Likes and threaded replies for the casts on screen, and the actions to add them.
// Reads engagement made in ANY Nostr client (see lib/nostr/engagement.ts); writes are
// signed by the page's NIP-07 wallet and published by the web app itself, so a like or
// reply needs a connected wallet session, not the extension.

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Event, EventTemplate } from 'nostr-tools';
import type { AuthState, ClipData } from '@/lib/types';
import { getShowTestCasts, onRelayModeChange } from '@/lib/constants';
import { TEST_CAST_PUBKEY } from '@/lib/nostr/test-cast-author';
import { aggregateAll, castTargetOf, EMPTY_ENGAGEMENT, type CastTarget, type Engagement } from '@/lib/nostr/engagement';
import type { ReplyParent } from '@/lib/nostr/engagement-events';
import { LL, log } from '@/lib/logger';

// Clips stream in during the feed's backfill; wait for the set to settle before subscribing.
const SUBSCRIBE_DEBOUNCE_MS = 600;
// Relays deliver a burst on subscribe; batch it into one render.
const FLUSH_MS = 150;

export interface CastEngagementView extends Engagement {
  liked: boolean;
  likePending: boolean;
  error: string | null;
}

export interface CastEngagementApi {
  get: (clip: ClipData) => CastEngagementView;
  /** A wallet session that can sign (NIP-07). Others see engagement but can't add to it. */
  canAct: boolean;
  myPubkey: string | null;
  toggleLike: (clip: ClipData) => void;
  /** Rejects with a user-facing message, for the composer to show. */
  reply: (clip: ClipData, parent: ReplyParent | null, text: string) => Promise<void>;
}

const NO_HIDDEN: ReadonlySet<string> = new Set();
const TEST_HIDDEN: ReadonlySet<string> = new Set([TEST_CAST_PUBKEY]);

function withEntry<V>(m: Map<string, V>, key: string, value: V | undefined): Map<string, V> {
  const next = new Map(m);
  if (value === undefined) next.delete(key); else next.set(key, value);
  return next;
}

/**
 * `walletAvailable`: the page has window.nostr. A session restored after a reload is
 * 'readonly' until the wallet is asked again, so it may still act; the click is the
 * gesture, and signAndPublish refuses if the wallet's identity differs.
 */
export function useCastEngagement(clips: ClipData[], auth: AuthState, walletAvailable = false): CastEngagementApi {
  const myPubkey = auth.pubkey;
  const canAct = !!myPubkey && ((auth.status === 'connected' && auth.source === 'nip07') || walletAvailable);

  // One target per cast; a note and its long-form share a key, so their ids are merged.
  const targets = useMemo(() => {
    const byKey = new Map<string, CastTarget>();
    for (const c of clips) {
      const t = castTargetOf(c);
      if (!t) continue;
      const prev = byKey.get(t.key);
      byKey.set(t.key, prev
        ? { ...prev, ids: [...new Set([...prev.ids, ...t.ids])], noteId: prev.noteId ?? t.noteId }
        : t);
    }
    return [...byKey.values()];
  }, [clips]);
  const targetsKey = targets.map((t) => `${t.key}=${[...t.ids].sort().join('+')}`).sort().join(',');

  // Every event seen, by id. Incoming events are buffered and flushed in batches.
  const [events, setEvents] = useState<Map<string, Event>>(new Map());
  const seen = useRef(new Set<string>());
  const buffer = useRef<Event[]>([]);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addEvent = useCallback((e: Event) => {
    if (seen.current.has(e.id)) return;
    seen.current.add(e.id);
    buffer.current.push(e);
    if (flushTimer.current) return;
    flushTimer.current = setTimeout(() => {
      flushTimer.current = null;
      const batch = buffer.current;
      buffer.current = [];
      setEvents((prev) => {
        const next = new Map(prev);
        for (const ev of batch) next.set(ev.id, ev);
        return next;
      });
    }, FLUSH_MS);
  }, []);
  useEffect(() => () => { if (flushTimer.current) clearTimeout(flushTimer.current); }, []);

  // A relay-mode flip means a different network: drop what the old one returned.
  const [relayEpoch, setRelayEpoch] = useState(0);
  useEffect(() => onRelayModeChange(() => {
    seen.current = new Set();
    buffer.current = [];
    setEvents(new Map());
    setRelayEpoch((n) => n + 1);
  }), []);

  useEffect(() => {
    if (!targetsKey) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    const timer = setTimeout(async () => {
      try {
        const { subscribeEngagement } = await import('@/lib/nostr/engagement-sub');
        if (!cancelled) cleanup = subscribeEngagement(targets, addEvent);
      } catch (err) {
        log(LL.WARN, '[engagement] subscribe failed:', err);
      }
    }, SUBSCRIBE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      cleanup?.();
    };
    // targetsKey stands for `targets`: re-subscribe when the SET changes, not its identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetsKey, relayEpoch, addEvent]);

  const hidden = getShowTestCasts() ? NO_HIDDEN : TEST_HIDDEN;
  const aggregated = useMemo(
    () => aggregateAll(events.values(), targets, myPubkey, hidden),
    [events, targets, myPubkey, hidden],
  );

  // Per-cast in-flight likes (true = liking, false = unliking) and last errors, by key.
  const [pending, setPending] = useState<Map<string, boolean>>(new Map());
  const [errors, setErrors] = useState<Map<string, string>>(new Map());

  const get = useCallback((clip: ClipData): CastEngagementView => {
    const key = castTargetOf(clip)?.key;
    const base = (key && aggregated.get(key)) || EMPTY_ENGAGEMENT;
    const inFlight = key ? pending.get(key) : undefined;
    const likedNow = base.myReactionIds.length > 0;
    const liked = inFlight ?? likedNow;
    return {
      ...base,
      likes: Math.max(0, base.likes + (liked === likedNow ? 0 : liked ? 1 : -1)),
      liked,
      likePending: inFlight !== undefined,
      error: (key && errors.get(key)) || null,
    };
  }, [aggregated, pending, errors]);

  const publish = useCallback(async (template: EventTemplate) => {
    if (!canAct || !myPubkey) throw new Error('Sign in with a Nostr signing extension to like or reply.');
    const { signAndPublish } = await import('@/lib/nostr/publish');
    const signed = await signAndPublish(template, myPubkey);
    // Straight into state, not the buffer: the pending flag clears in the same batch.
    seen.current.add(signed.id);
    setEvents((prev) => new Map(prev).set(signed.id, signed));
  }, [canAct, myPubkey]);

  const toggleLike = useCallback((clip: ClipData) => {
    const target = castTargetOf(clip);
    const view = get(clip);
    const noteId = view.noteId;
    if (!target || !noteId || view.likePending) return;
    const like = !view.liked;
    setPending((m) => withEntry(m, target.key, like));
    setErrors((m) => withEntry(m, target.key, undefined));
    (async () => {
      const { buildReaction, buildUnlike } = await import('@/lib/nostr/engagement-events');
      await publish(like ? buildReaction(noteId, target.authorPubkey) : buildUnlike(view.myReactionIds));
    })()
      .catch((err: unknown) => {
        log(LL.WARN, '[engagement] like failed:', err);
        setErrors((m) => withEntry(m, target.key, err instanceof Error ? err.message : String(err)));
      })
      .finally(() => setPending((m) => withEntry(m, target.key, undefined)));
  }, [get, publish]);

  const reply = useCallback(async (clip: ClipData, parent: ReplyParent | null, text: string) => {
    const target = castTargetOf(clip);
    const noteId = get(clip).noteId;
    const body = text.trim();
    if (!target || !noteId || !myPubkey || !body) return;
    const { buildReply } = await import('@/lib/nostr/engagement-events');
    await publish(buildReply(noteId, target.authorPubkey, body, myPubkey, parent));
  }, [get, myPubkey, publish]);

  return { get, canAct, myPubkey, toggleLike, reply };
}
