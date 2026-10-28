// Templates for likes, unlikes and replies. Their tags are what other Nostr clients
// read, and a stray ['t','wirthy'] would make a reply show up in our own feed as a cast.

import { describe, it, expect } from 'vitest';
import { buildReaction, buildReply, buildUnlike } from '@/lib/nostr/engagement-events';
import { isReplyNotCast } from '@/lib/nostr/feed';
import pkg from '@/package.json';

const NOTE = '1'.repeat(64);
const CAST_AUTHOR = 'a'.repeat(64);
const ME = 'b'.repeat(64);
const OTHER = 'c'.repeat(64);

const hasWirthyTopic = (tags: string[][]) => tags.some((t) => t[0] === 't' && t[1] === 'wirthy');

describe('buildReaction', () => {
  it('is a NIP-25 like on the cast note', () => {
    const r = buildReaction(NOTE, CAST_AUTHOR);
    expect(r.kind).toBe(7);
    expect(r.content).toBe('+');
    expect(r.tags).toContainEqual(['e', NOTE, '']);
    expect(r.tags).toContainEqual(['p', CAST_AUTHOR]);
    expect(r.tags).toContainEqual(['k', '1']);
    expect(r.tags).toContainEqual(['client', 'wirthy', pkg.version]);
    expect(r.tags.filter((t) => t[0] === 'e').at(-1)?.[1]).toBe(NOTE);
    expect(hasWirthyTopic(r.tags)).toBe(false);
  });
});

describe('buildUnlike', () => {
  it('deletes every given reaction (NIP-09)', () => {
    const d = buildUnlike(['r1', 'r2']);
    expect(d.kind).toBe(5);
    expect(d.tags).toContainEqual(['e', 'r1']);
    expect(d.tags).toContainEqual(['e', 'r2']);
    expect(d.tags).toContainEqual(['k', '7']);
  });
});

describe('buildReply', () => {
  it('replies to the cast with a root marker and notifies its author', () => {
    const r = buildReply(NOTE, CAST_AUTHOR, 'Nice find', ME);
    expect(r.kind).toBe(1);
    expect(r.content).toBe('Nice find');
    expect(r.tags).toContainEqual(['e', NOTE, '', 'root', CAST_AUTHOR]);
    expect(r.tags.filter((t) => t[0] === 'e')).toHaveLength(1);
    expect(r.tags.filter((t) => t[0] === 'p')).toEqual([['p', CAST_AUTHOR]]);
    expect(hasWirthyTopic(r.tags)).toBe(false);
    // The feed's guard would never mistake it for a cast either.
    expect(isReplyNotCast({ ...r, id: 'x', pubkey: ME, sig: '' })).toBe(true);
  });

  it('nests under a reply with a reply marker and de-duplicated p tags, never tagging me', () => {
    const parent = { id: 'p'.repeat(64), pubkey: OTHER, tags: [['p', CAST_AUTHOR], ['p', ME], ['p', OTHER]] };
    const r = buildReply(NOTE, CAST_AUTHOR, 'Agreed', ME, parent);
    expect(r.tags).toContainEqual(['e', NOTE, '', 'root', CAST_AUTHOR]);
    expect(r.tags).toContainEqual(['e', parent.id, '', 'reply', OTHER]);
    expect(r.tags.filter((t) => t[0] === 'p').map((t) => t[1])).toEqual([CAST_AUTHOR, OTHER]);
  });
});
