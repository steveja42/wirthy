// The share-page function's embedded author (lib/nostr/ssr-author.ts): read defensively,
// and used only until the client's own profile is verified.

import { describe, it, expect, afterEach } from 'vitest';
import { readSsrAuthor, withSsrAuthor, SSR_AUTHOR_ID } from '@/lib/nostr/ssr-author';
import type { AuthorProfile } from '@/lib/nostr/profiles';

const PK = 'a'.repeat(64);

function embed(json: string) {
  const s = document.createElement('script');
  s.type = 'application/json';
  s.id = SSR_AUTHOR_ID;
  s.textContent = json;
  document.head.appendChild(s);
}

afterEach(() => { document.getElementById(SSR_AUTHOR_ID)?.remove(); });

describe('readSsrAuthor', () => {
  it('reads a well-formed identity', () => {
    embed(JSON.stringify({ pubkey: PK, name: 'stevo', nip05: 'stevo@wirthy.app', verified: true }));
    expect(readSsrAuthor()).toEqual({ pubkey: PK, name: 'stevo', nip05: 'stevo@wirthy.app', verified: true });
  });

  it('returns null when absent, malformed, or not naming a hex pubkey', () => {
    expect(readSsrAuthor()).toBeNull();
    embed('{not json');
    expect(readSsrAuthor()).toBeNull();
    document.getElementById(SSR_AUTHOR_ID)?.remove();
    embed(JSON.stringify({ pubkey: 'npub1xyz', nip05: 'x@y.z', verified: true }));
    expect(readSsrAuthor()).toBeNull();
  });

  it('never treats a non-boolean as verified', () => {
    embed(JSON.stringify({ pubkey: PK, nip05: 'x@y.z', verified: 'yes' }));
    expect(readSsrAuthor()?.verified).toBe(false);
  });
});

describe('withSsrAuthor', () => {
  const ssr: AuthorProfile = { pubkey: PK, name: 'stevo', nip05: 'stevo@wirthy.app', verified: true };

  it('fills in the author before any live profile arrives', () => {
    expect(withSsrAuthor(new Map(), ssr).get(PK)).toEqual(ssr);
  });

  it('keeps the verified NIP-05 over a live profile that is still verifying', () => {
    const live = new Map([[PK, { pubkey: PK, name: 'stevo', nip05: 'stevo@wirthy.app' }]]);
    expect(withSsrAuthor(live, ssr).get(PK)?.verified).toBe(true);
  });

  it('defers to a live profile once that is verified', () => {
    const live = new Map([[PK, { pubkey: PK, nip05: 'new@wirthy.app', verified: true }]]);
    expect(withSsrAuthor(live, ssr)).toBe(live);
  });

  it('leaves other authors alone, and is a no-op without an embedded author', () => {
    const other = 'b'.repeat(64);
    const live = new Map([[other, { pubkey: other, name: 'x' }]]);
    expect(withSsrAuthor(live, ssr).get(other)).toEqual({ pubkey: other, name: 'x' });
    expect(withSsrAuthor(live, null)).toBe(live);
  });
});
