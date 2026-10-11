// Addressing one public cast: its /c/<id> URL, decoding that id, and fetching the event.
// Shared by the cast page and the share-page Netlify function, so no React and no window.
//
// A cast with a long-form companion is addressed by its kind-30023 `naddr` (author + d):
// that matches the feed's dedup preference and survives edits to the replaceable event.
// Anything else is addressed by its kind-1 `note` id. Relay hints are left out of both,
// since the readers query a known relay set.

import type { Event, Filter } from 'nostr-tools';
import { decode, naddrEncode, noteEncode } from 'nostr-tools/nip19';
import type { ClipData } from '@/lib/types';

export type CastRef =
  | { type: 'note'; id: string }
  | { type: 'naddr'; pubkey: string; d: string };

export function decodeCastRef(value: string): CastRef | null {
  try {
    const r = decode(value.trim());
    if (r.type === 'note') return { type: 'note', id: r.data };
    if (r.type === 'nevent') return { type: 'note', id: r.data.id };
    if (r.type === 'naddr' && r.data.kind === 30023) {
      return { type: 'naddr', pubkey: r.data.pubkey, d: r.data.identifier };
    }
  } catch { /* not bech32 */ }
  return null;
}

export function encodeCastRef(ref: CastRef): string {
  return ref.type === 'note'
    ? noteEncode(ref.id)
    : naddrEncode({ kind: 30023, pubkey: ref.pubkey, identifier: ref.d });
}

/** The cast's own page, or null for a clip that isn't a published cast. */
export function castPath(clip: ClipData): string | null {
  const { longFormId, authorPubkey, id, kind } = clip.capture;
  if (longFormId && authorPubkey) return `/c/${encodeCastRef({ type: 'naddr', pubkey: authorPubkey, d: longFormId })}`;
  if (kind === 1 && /^[0-9a-f]{64}$/.test(id)) return `/c/${encodeCastRef({ type: 'note', id })}`;
  return null;
}

/** The `30023:<pubkey>:<d>` long-form a kind-1 note points at through its `a` tag, if any. */
function longFormRefOf(note: Event): CastRef | null {
  const a = note.tags.find((t) => t[0] === 'a' && t[1]?.startsWith('30023:'))?.[1];
  const [, pubkey, d] = a?.split(':') ?? [];
  return pubkey && d ? { type: 'naddr', pubkey, d } : null;
}

function filterFor(ref: CastRef): Filter {
  return ref.type === 'note'
    ? { ids: [ref.id] }
    : { kinds: [30023], authors: [ref.pubkey], '#d': [ref.d] };
}

/** The display fields of a kind-0 profile, for share previews. */
export interface PublisherProfile {
  name?: string;
  about?: string;
  picture?: string;
}

/** The newest kind-0 for `pubkey`, or null. Malformed profile JSON reads as an empty profile. */
export async function fetchProfile(pubkey: string, relays: string[], timeoutMs = 2000): Promise<PublisherProfile | null> {
  const { SimplePool } = await import('nostr-tools');
  const pool = new SimplePool();
  try {
    const events = await pool.querySync(relays, { kinds: [0], authors: [pubkey] }, { maxWait: timeoutMs });
    const newest = events.filter((e) => e.pubkey === pubkey).sort((a, b) => b.created_at - a.created_at)[0];
    if (!newest) return null;
    try {
      const m = JSON.parse(newest.content) as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
      return { name: str(m.display_name) ?? str(m.name), about: str(m.about), picture: str(m.picture) };
    } catch {
      return {};
    }
  } finally {
    pool.destroy();
  }
}

export interface FetchedCast {
  event: Event;
  /** The ref this cast should be linked by — a note that has a long-form resolves to it. */
  canonical: CastRef;
}

/**
 * Fetches a cast from `relays`. A replaceable long-form may differ between relays, so the
 * newest copy wins. A kind-1 whose long-form companion can be found is upgraded to it.
 */
export async function fetchCast(ref: CastRef, relays: string[], timeoutMs = 3000): Promise<FetchedCast | null> {
  // Lazy, so pages that only build links (the feed) don't pull the relay pool into prerender.
  const { SimplePool } = await import('nostr-tools');
  const pool = new SimplePool();
  const newest = async (r: CastRef): Promise<Event | null> => {
    const events = await pool.querySync(relays, filterFor(r), { maxWait: timeoutMs });
    // An id lookup must return that exact event; a relay answering with anything else is ignored.
    const valid = r.type === 'note' ? events.filter((e) => e.id === r.id) : events.filter((e) => e.pubkey === r.pubkey);
    return valid.sort((a, b) => b.created_at - a.created_at)[0] ?? null;
  };
  try {
    const event = await newest(ref);
    if (!event) return null;
    if (event.kind === 1) {
      const lf = longFormRefOf(event);
      const longForm = lf && lf.type === 'naddr' && lf.pubkey === event.pubkey ? await newest(lf) : null;
      if (longForm && lf) return { event: longForm, canonical: lf };
    }
    return { event, canonical: ref };
  } finally {
    pool.destroy();
  }
}
