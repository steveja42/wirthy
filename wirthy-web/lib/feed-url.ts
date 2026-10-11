// Explore's filter state <-> URL query, so any filtered view is a shareable link:
//   /explore?publisher=npub1…&signal=worthwhile&category=tech&qualifier=Timeless&q=rust&unread=1
// Multi-valued filters REPEAT the param (qualifier labels contain spaces and slashes, and
// custom ones may contain commas). Pure: no window, no React — the caller passes the search.

import { npubEncode, decode } from 'nostr-tools/nip19';
import { CATEGORIES, SIGNAL_LEVELS } from '@/lib/constants';

export interface FeedFilters {
  category: string | null;
  signals: string[];
  qualifiers: string[];
  /** Hex pubkeys. The URL carries them as npubs; hex is never shown to users. */
  authors: string[];
  unreadOnly: boolean;
  q: string;
}

export const EMPTY_FILTERS: FeedFilters = {
  category: null,
  signals: [],
  qualifiers: [],
  authors: [],
  unreadOnly: false,
  q: '',
};

// Every param this module owns. Anything else (?signin, ?settings, ?popover) is preserved.
const OWNED = ['publisher', 'signal', 'category', 'qualifier', 'q', 'unread'] as const;

const SIGNAL_BY_LOWER = new Map(SIGNAL_LEVELS.map((s) => [s.toLowerCase(), s]));
const CATEGORY_BY_LOWER = new Map(Object.keys(CATEGORIES).map((c) => [c.toLowerCase(), c]));

export function npubToHex(value: string): string | null {
  try {
    const d = decode(value.trim());
    return d.type === 'npub' ? d.data : null;
  } catch {
    return null;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function parseFeedQuery(search: string): FeedFilters {
  const p = new URLSearchParams(search);
  const signals = p.getAll('signal')
    .map((s) => SIGNAL_BY_LOWER.get(s.trim().toLowerCase()))
    .filter((s): s is typeof SIGNAL_LEVELS[number] => s !== undefined);
  // A built-in category is matched case-insensitively; anything else is a custom
  // category and kept verbatim, since the feed compares categories exactly.
  const rawCat = p.get('category')?.trim();
  const category = rawCat ? CATEGORY_BY_LOWER.get(rawCat.toLowerCase()) ?? rawCat : null;
  return {
    category,
    signals: unique(signals),
    qualifiers: unique(p.getAll('qualifier').map((s) => s.trim()).filter(Boolean)),
    authors: unique(p.getAll('publisher').map(npubToHex).filter((h): h is string => h !== null)),
    unreadOnly: p.get('unread') === '1',
    q: p.get('q')?.trim() ?? '',
  };
}

/** Returns `search` with the owned params replaced by `f` and every other param kept. */
export function applyFeedQuery(search: string, f: FeedFilters): string {
  const p = new URLSearchParams(search);
  for (const key of OWNED) p.delete(key);
  for (const hex of f.authors) p.append('publisher', npubEncode(hex));
  for (const s of f.signals) p.append('signal', s.toLowerCase());
  if (f.category) p.set('category', CATEGORIES[f.category] ? f.category.toLowerCase() : f.category);
  for (const qual of f.qualifiers) p.append('qualifier', qual);
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.unreadOnly) p.set('unread', '1');
  const out = p.toString();
  return out ? `?${out}` : '';
}

export function hasActiveFilters(f: FeedFilters): boolean {
  return f.category !== null || f.signals.length > 0 || f.qualifiers.length > 0
    || f.authors.length > 0 || f.unreadOnly || f.q.trim() !== '';
}

/**
 * The part of the filters a relay can apply. `authors` maps to NIP-01 `authors`; a single
 * category maps to `#l` (categories travel as NIP-32 `l` labels). Signal and qualifier stay
 * client-side: they are `l` labels too, and values within one `#l` filter are ORed.
 * `General` is skipped because the parser defaults an untagged cast to it.
 */
export interface RelayScope {
  authors?: string[];
  category?: string;
}

export function relayScope(f: FeedFilters): RelayScope {
  const scope: RelayScope = {};
  if (f.authors.length > 0) scope.authors = [...f.authors].sort();
  if (f.category && f.category !== 'General') scope.category = f.category;
  return scope;
}

/** Stable identity for a scope, so the feed re-subscribes only when it really changes. */
export function scopeKey(s: RelayScope): string {
  return JSON.stringify([s.authors ?? [], s.category ?? '']);
}

export function scopeFromKey(key: string): RelayScope {
  const [authors, category] = JSON.parse(key) as [string[], string];
  return {
    ...(authors.length > 0 ? { authors } : {}),
    ...(category ? { category } : {}),
  };
}
