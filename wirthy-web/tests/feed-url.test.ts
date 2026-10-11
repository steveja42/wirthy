// Explore's filters <-> URL query (lib/feed-url.ts): shareable links must round-trip,
// keep foreign params, and drop values the feed can't honour.

import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import {
  EMPTY_FILTERS,
  applyFeedQuery,
  parseFeedQuery,
  relayScope,
  scopeFromKey,
  scopeKey,
  type FeedFilters,
} from '@/lib/feed-url';

const PK = getPublicKey(generateSecretKey());
const NPUB = npubEncode(PK);

describe('parseFeedQuery', () => {
  it('reads every filter, canonicalising built-in signal and category case', () => {
    const f = parseFeedQuery(`?publisher=${NPUB}&signal=worthwhile&signal=MASTERPIECE&category=tech&qualifier=Quick%20Read&q=rust&unread=1`);
    expect(f).toEqual<FeedFilters>({
      authors: [PK],
      signals: ['Worthwhile', 'Masterpiece'],
      category: 'Tech',
      qualifiers: ['Quick Read'],
      q: 'rust',
      unreadOnly: true,
    });
  });

  it('drops unknown signals and undecodable publishers, keeps a custom category verbatim', () => {
    const f = parseFeedQuery('?signal=amazing&publisher=npub1nope&publisher=deadbeef&category=Woodworking');
    expect(f.signals).toEqual([]);
    expect(f.authors).toEqual([]);
    expect(f.category).toBe('Woodworking');
  });

  it('returns empty filters for an empty or foreign-only query', () => {
    expect(parseFeedQuery('')).toEqual(EMPTY_FILTERS);
    expect(parseFeedQuery('?signin=1&settings=1')).toEqual(EMPTY_FILTERS);
  });
});

describe('applyFeedQuery', () => {
  it('round-trips through parseFeedQuery', () => {
    const f: FeedFilters = { ...EMPTY_FILTERS, authors: [PK], signals: ['Noise'], category: 'Science', qualifiers: ['Humorous / Satire'], q: 'x y' };
    expect(parseFeedQuery(applyFeedQuery('', f))).toEqual(f);
  });

  it('keeps params it does not own, and replaces the ones it does', () => {
    const out = applyFeedQuery('?signin=1&signal=noise&popover=1', { ...EMPTY_FILTERS, signals: ['Toxic'] });
    const p = new URLSearchParams(out);
    expect(p.get('signin')).toBe('1');
    expect(p.get('popover')).toBe('1');
    expect(p.getAll('signal')).toEqual(['toxic']);
  });

  it('carries publishers as npub, never hex', () => {
    const out = applyFeedQuery('', { ...EMPTY_FILTERS, authors: [PK] });
    expect(out).toContain(NPUB);
    expect(out).not.toContain(PK);
  });

  it('yields an empty string when nothing is set', () => {
    expect(applyFeedQuery('?signal=noise', EMPTY_FILTERS)).toBe('');
  });
});

describe('relayScope', () => {
  it('narrows by authors and a non-General category only', () => {
    expect(relayScope({ ...EMPTY_FILTERS, authors: [PK], category: 'Tech', signals: ['Noise'] }))
      .toEqual({ authors: [PK], category: 'Tech' });
    // General is the parser's default for an untagged cast, so a relay #l filter would miss those.
    expect(relayScope({ ...EMPTY_FILTERS, category: 'General' })).toEqual({});
  });

  it('survives the scopeKey round-trip and ignores author order', () => {
    const a = 'a'.repeat(64);
    const b = 'b'.repeat(64);
    const s = relayScope({ ...EMPTY_FILTERS, authors: [b, a], category: 'Culture' });
    expect(scopeFromKey(scopeKey(s))).toEqual(s);
    expect(scopeKey(relayScope({ ...EMPTY_FILTERS, authors: [a, b], category: 'Culture' }))).toBe(scopeKey(s));
    expect(scopeFromKey(scopeKey({}))).toEqual({});
  });
});
