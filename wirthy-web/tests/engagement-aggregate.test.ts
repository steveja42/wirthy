// Engagement aggregation: likes and threaded replies made in ANY client, matched to a
// cast whether they reference its kind-1 note, its kind-30023 article, or the article's
// address — including the case where the feed card has lost the note's id.

import { describe, it, expect } from 'vitest';
import type { Event } from 'nostr-tools';
import { aggregateAll, aggregateEngagement, castTargetOf, type CastTarget } from '@/lib/nostr/engagement';
import { parseEvent } from '@/lib/nostr/parse';

const AUTHOR = 'a'.repeat(64);
const ME = 'b'.repeat(64);
const ALICE = 'c'.repeat(64);
const BOB = 'd'.repeat(64);
const NOTE = '1'.repeat(64);
const ARTICLE = '2'.repeat(64);
const D = 'clip-uuid-1';
const COORD = `30023:${AUTHOR}:${D}`;

let seq = 0;
function ev(kind: number, pubkey: string, tags: string[][], content = '', created_at = 1_700_000_000 + (++seq)): Event {
  return { id: `${kind}-${pubkey.slice(0, 2)}-${seq}`.padEnd(64, '0'), pubkey, kind, tags, content, created_at, sig: '' };
}

const castNote = (): Event => ({ ...ev(1, AUTHOR, [['t', 'wirthy'], ['r', 'https://x.test/a'], ['a', COORD]]), id: NOTE });
const article = (): Event => ({ ...ev(30023, AUTHOR, [['t', 'wirthy'], ['d', D], ['title', 'A']]), id: ARTICLE });

// The feed card for a cast with a long-form is the ARTICLE: it doesn't know the note id.
const articleTarget = (): CastTarget => castTargetOf(parseEvent(article()))!;
// A card still holding the note (its article hasn't arrived): knows both id and address.
const noteTarget = (): CastTarget => castTargetOf(parseEvent(castNote()))!;

describe('castTargetOf', () => {
  it('keys a note and its long-form alike', () => {
    const fromNote = castTargetOf(parseEvent(castNote()))!;
    expect(fromNote.key).toBe(articleTarget().key);
    expect(fromNote.noteId).toBe(NOTE);
    expect(articleTarget().noteId).toBeUndefined();
    expect(articleTarget().coord).toBe(COORD);
  });
});

describe('aggregateEngagement', () => {
  it('discovers the note through the article address and does not count it as a reply', () => {
    const e = aggregateEngagement([castNote()], articleTarget(), null);
    expect(e.noteId).toBe(NOTE);
    expect(e.replyCount).toBe(0);
  });

  it('counts one like per person, newest wins, and ignores dislikes', () => {
    const events = [
      castNote(),
      ev(7, ALICE, [['e', NOTE], ['p', AUTHOR]], '+'),
      ev(7, ALICE, [['e', NOTE], ['p', AUTHOR]], '🤙'),
      ev(7, BOB, [['e', NOTE], ['p', AUTHOR]], '+'),
      ev(7, BOB, [['e', NOTE], ['p', AUTHOR]], '-'),
      ev(7, ME, [['e', NOTE], ['p', AUTHOR]], ''),
    ];
    const e = aggregateEngagement(events, articleTarget(), ME);
    expect(e.likes).toBe(2); // Alice + me; Bob's newest is a dislike
    expect(e.myReactionIds).toHaveLength(1);
  });

  it('counts a like made on the article in a long-form client', () => {
    const otherArticleId = '9'.repeat(64);
    const e = aggregateEngagement(
      [castNote(), ev(7, ALICE, [['e', otherArticleId], ['a', COORD], ['k', '30023']], '+')],
      noteTarget(),
      null,
    );
    expect(e.likes).toBe(1);
  });

  it('honours a deletion by the reactor and ignores one by anyone else', () => {
    const mine = ev(7, ME, [['e', NOTE]], '+');
    const alices = ev(7, ALICE, [['e', NOTE]], '+');
    const events = [castNote(), mine, alices, ev(5, ME, [['e', mine.id]]), ev(5, BOB, [['e', alices.id]])];
    const e = aggregateEngagement(events, articleTarget(), ME);
    expect(e.likes).toBe(1);
    expect(e.myReactionIds).toEqual([]);
  });

  it('does not count a like on a reply as a like on the cast', () => {
    const reply = ev(1, ALICE, [['e', NOTE, '', 'root'], ['p', AUTHOR]], 'hi');
    const e = aggregateEngagement([castNote(), reply, ev(7, BOB, [['e', NOTE], ['e', reply.id]], '+')], articleTarget(), null);
    expect(e.likes).toBe(0);
    expect(e.replyCount).toBe(1);
  });

  it('threads NIP-10 replies and NIP-22 comments, oldest first', () => {
    const r1 = ev(1, ALICE, [['e', NOTE, '', 'root'], ['p', AUTHOR]], 'first');
    const r2 = ev(1, BOB, [['e', NOTE, '', 'root'], ['e', r1.id, '', 'reply'], ['p', ALICE]], 'nested');
    const c1 = ev(1111, ME, [['A', COORD], ['K', '30023'], ['a', COORD], ['k', '30023'], ['P', AUTHOR]], 'comment');
    const c2 = ev(1111, ALICE, [['A', COORD], ['K', '30023'], ['e', c1.id], ['k', '1111'], ['P', AUTHOR]], 'comment reply');
    const e = aggregateEngagement([castNote(), c2, r2, c1, r1], articleTarget(), null);
    expect(e.replyCount).toBe(4);
    expect(e.replies.map((n) => n.event.content)).toEqual(['first', 'comment']);
    expect(e.replies[0].children.map((n) => n.event.content)).toEqual(['nested']);
    expect(e.replies[1].children.map((n) => n.event.content)).toEqual(['comment reply']);
  });

  it('shows a reply to an unseen parent at top level', () => {
    const r = ev(1, BOB, [['e', NOTE, '', 'root'], ['e', 'f'.repeat(64), '', 'reply']], 'orphan');
    const e = aggregateEngagement([castNote(), r], articleTarget(), null);
    expect(e.replies.map((n) => n.event.content)).toEqual(['orphan']);
  });

  it('drops deleted replies and hidden authors', () => {
    const gone = ev(1, ALICE, [['e', NOTE, '', 'root']], 'gone');
    const hidden = ev(1, BOB, [['e', NOTE, '', 'root']], 'test cast author');
    const e = aggregateEngagement([castNote(), gone, hidden, ev(5, ALICE, [['e', gone.id]])], articleTarget(), null, new Set([BOB]));
    expect(e.replyCount).toBe(0);
  });

  it('ignores another Wirthy cast that shares the address but is not this author’s note', () => {
    const impostor = ev(1, ALICE, [['t', 'wirthy'], ['a', COORD]]);
    const e = aggregateEngagement([impostor], articleTarget(), null);
    expect(e.noteId).toBeUndefined();
    expect(e.replyCount).toBe(0);
  });
});

describe('aggregateAll', () => {
  it('matches the per-cast result and keeps casts apart', () => {
    const other = castTargetOf(parseEvent({ ...ev(1, BOB, [['t', 'wirthy']]), id: '3'.repeat(64) }))!;
    const events = [
      castNote(),
      ev(7, ALICE, [['e', NOTE]], '+'),
      ev(1, ALICE, [['e', NOTE, '', 'root']], 'on cast 1'),
      ev(7, ME, [['e', other.ids[0]]], '+'),
    ];
    const all = aggregateAll(events, [articleTarget(), other], ME);
    expect(all.get(articleTarget().key)).toEqual(aggregateEngagement(events, articleTarget(), ME));
    expect(all.get(articleTarget().key)?.likes).toBe(1);
    expect(all.get(other.key)?.likes).toBe(1);
    expect(all.get(other.key)?.replyCount).toBe(0);
  });
});
