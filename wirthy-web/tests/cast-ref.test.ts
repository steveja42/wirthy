// /c/<id> addressing (lib/nostr/cast-ref.ts): which id a cast is linked by, decoding it,
// and fetching it — including the kind-1 → long-form upgrade and ignoring stray events.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { naddrEncode, neventEncode, noteEncode, npubEncode } from 'nostr-tools/nip19';
import type { Event, Filter } from 'nostr-tools';
import type { ClipData } from '@/lib/types';

// The relay set fetchCast queries is mocked by one in-memory event list.
let relayEvents: Event[] = [];
function matches(e: Event, f: Filter): boolean {
  if (f.ids && !f.ids.includes(e.id)) return false;
  if (f.kinds && !f.kinds.includes(e.kind)) return false;
  if (f.authors && !f.authors.includes(e.pubkey)) return false;
  const d = f['#d'];
  if (d && !e.tags.some((t) => t[0] === 'd' && d.includes(t[1]))) return false;
  return true;
}
vi.mock('nostr-tools', async (orig) => ({
  ...(await orig<typeof import('nostr-tools')>()),
  SimplePool: class {
    async querySync(_relays: string[], f: Filter) { return relayEvents.filter((e) => matches(e, f)); }
    destroy() {}
  },
}));

const { castPath, decodeCastRef, encodeCastRef, fetchCast } = await import('@/lib/nostr/cast-ref');

const SK = generateSecretKey();
const PK = getPublicKey(SK);
const D = 'clip-1234';
const longForm = (title: string, at: number) => finalizeEvent({
  kind: 30023, created_at: at, content: 'body', tags: [['d', D], ['title', title], ['t', 'wirthy']],
}, SK);
const note = finalizeEvent({
  kind: 1, created_at: 100, content: 'teaser', tags: [['a', `30023:${PK}:${D}`], ['t', 'wirthy']],
}, SK);
const bareNote = finalizeEvent({ kind: 1, created_at: 100, content: 'bookmark', tags: [['t', 'wirthy']] }, SK);

beforeEach(() => { relayEvents = []; });

describe('decodeCastRef / encodeCastRef', () => {
  it('accepts note, nevent and a kind-30023 naddr, and round-trips', () => {
    expect(decodeCastRef(noteEncode(note.id))).toEqual({ type: 'note', id: note.id });
    expect(decodeCastRef(neventEncode({ id: note.id, relays: ['wss://x'] }))).toEqual({ type: 'note', id: note.id });
    const naddr = naddrEncode({ kind: 30023, pubkey: PK, identifier: D });
    expect(decodeCastRef(naddr)).toEqual({ type: 'naddr', pubkey: PK, d: D });
    expect(encodeCastRef(decodeCastRef(naddr)!)).toBe(naddr);
  });

  it('rejects anything that does not name a cast', () => {
    expect(decodeCastRef(npubEncode(PK))).toBeNull();
    expect(decodeCastRef(naddrEncode({ kind: 30078, pubkey: PK, identifier: D }))).toBeNull();
    expect(decodeCastRef('not-bech32')).toBeNull();
    expect(decodeCastRef('')).toBeNull();
  });
});

describe('castPath', () => {
  const clip = (capture: Partial<ClipData['capture']>) => ({ capture, evaluation: { qualifiers: [], category: 'General' }, encrypted: '' }) as unknown as ClipData;

  it('links a cast with a long-form by its naddr, a plain note by its note id', () => {
    expect(castPath(clip({ id: 'x', kind: 30023, longFormId: D, authorPubkey: PK })))
      .toBe(`/c/${naddrEncode({ kind: 30023, pubkey: PK, identifier: D })}`);
    expect(castPath(clip({ id: bareNote.id, kind: 1, authorPubkey: PK }))).toBe(`/c/${noteEncode(bareNote.id)}`);
  });

  it('gives a private library clip (uuid id, no author) no page', () => {
    expect(castPath(clip({ id: '0b6c7a0e-4c1e-4d7a-9a55-3f1c2b9e8d10' }))).toBeNull();
  });
});

describe('fetchCast', () => {
  it('upgrades a kind-1 to its long-form and makes the naddr canonical', async () => {
    relayEvents = [note, longForm('Article', 100)];
    const got = await fetchCast({ type: 'note', id: note.id }, ['wss://r']);
    expect(got?.event.kind).toBe(30023);
    expect(got?.canonical).toEqual({ type: 'naddr', pubkey: PK, d: D });
  });

  it('keeps a kind-1 whose long-form is unavailable, and a bare note as itself', async () => {
    relayEvents = [note, bareNote];
    expect((await fetchCast({ type: 'note', id: note.id }, ['wss://r']))?.canonical).toEqual({ type: 'note', id: note.id });
    expect((await fetchCast({ type: 'note', id: bareNote.id }, ['wss://r']))?.event.id).toBe(bareNote.id);
  });

  it('returns the newest copy of a replaceable long-form', async () => {
    relayEvents = [longForm('Old', 100), longForm('New', 200)];
    const got = await fetchCast({ type: 'naddr', pubkey: PK, d: D }, ['wss://r']);
    expect(got?.event.tags.find((t) => t[0] === 'title')?.[1]).toBe('New');
  });

  it('returns null when no relay has it', async () => {
    expect(await fetchCast({ type: 'note', id: 'f'.repeat(64) }, ['wss://r'])).toBeNull();
  });
});
