// Relay subscription for cast engagement (see engagement.ts for what is read and why).
// Kept apart from the pure aggregation so the relay pool is only loaded on demand.

import { SimplePool, type Event, type Filter } from 'nostr-tools';
import { getActiveRelays } from '@/lib/constants';
import { LL, log } from '@/lib/logger';
import { isCastNote, type CastTarget } from './engagement';

const CHUNK = 100;
const ENGAGEMENT_KINDS = [1, 1111, 7];

function chunks<T>(list: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
}

/**
 * Streams every engagement event for `targets`. A discovered cast note, and each
 * reaction or reply seen, widen the subscription (debounced): replies may reference
 * only the note, and deletions only the event they delete. Widening REPLACES the
 * affected subscriptions rather than stacking more, since relays cap them per socket.
 */
export function subscribeEngagement(targets: CastTarget[], onEvent: (e: Event) => void): () => void {
  const relays = [...getActiveRelays()];
  const pool = new SimplePool();
  let closed = false;
  log(LL.NORMAL, `[nostr] subscribeEngagement for ${targets.length} cast(s) on`, relays);

  type Sub = { close: () => void };
  const open = (filter: Filter): Sub => pool.subscribeMany(relays, filter, { onevent: handle, oneose: () => {} });
  const reopen = (prev: Sub[], kinds: number[], ids: Set<string>): Sub[] => {
    prev.forEach((s) => s.close());
    return chunks([...ids]).map((c) => open({ kinds, '#e': c }));
  };

  const coords = new Set(targets.flatMap((t) => (t.coord ? [t.coord] : [])));
  const watchedIds = new Set(targets.flatMap((t) => [...t.ids, ...(t.noteId ? [t.noteId] : [])]));
  const deletable = new Set<string>();
  let idsDirty = false;
  let deletableDirty = false;
  let idSubs: Sub[] = [];
  let deletionSubs: Sub[] = [];
  const coordSubs: Sub[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    timer = undefined;
    if (closed) return;
    if (idsDirty) idSubs = reopen(idSubs, ENGAGEMENT_KINDS, watchedIds);
    if (deletableDirty) deletionSubs = reopen(deletionSubs, [5], deletable);
    idsDirty = deletableDirty = false;
  };
  const schedule = () => { if (!timer) timer = setTimeout(flush, 800); };

  function handle(e: Event) {
    if (closed) return;
    if (isCastNote(e)) {
      if (!watchedIds.has(e.id) && e.tags.some((t) => t[0] === 'a' && coords.has(t[1]))) {
        watchedIds.add(e.id);
        idsDirty = true;
        schedule();
      }
    } else if (e.kind !== 5 && !deletable.has(e.id)) {
      deletable.add(e.id);
      deletableDirty = true;
      schedule();
    }
    onEvent(e);
  }

  idSubs = reopen([], ENGAGEMENT_KINDS, watchedIds);
  for (const c of chunks([...coords])) {
    coordSubs.push(open({ kinds: ENGAGEMENT_KINDS, '#a': c }), open({ kinds: ENGAGEMENT_KINDS, '#A': c }));
  }

  return () => {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
    [...idSubs, ...deletionSubs, ...coordSubs].forEach((s) => s.close());
    pool.destroy();
  };
}
