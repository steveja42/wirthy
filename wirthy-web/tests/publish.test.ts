// signAndPublish: the web app's only write path to Nostr. The wallet is stubbed with a
// real key (so verifyEvent passes) and the relay pool with scripted per-relay outcomes.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, type Event } from 'nostr-tools';

const relayOutcomes: Array<() => Promise<string>> = [];
const published: Event[] = [];

vi.mock('nostr-tools', async (orig) => {
  const real = await orig<typeof import('nostr-tools')>();
  class FakePool {
    publish(relays: string[], event: Event) {
      published.push(event);
      return relays.map((_, i) => (relayOutcomes[i] ?? (() => Promise.resolve('')))());
    }
    destroy() {}
  }
  return { ...real, SimplePool: FakePool };
});

vi.mock('@/lib/constants', async (orig) => ({
  ...(await orig<typeof import('@/lib/constants')>()),
  getActiveRelays: () => ['wss://one.test', 'wss://two.test', 'wss://three.test'],
}));

const { signAndPublish } = await import('@/lib/nostr/publish');

const sk = generateSecretKey();
const PK = getPublicKey(sk);
const template = { kind: 7, created_at: 1_700_000_000, content: '+', tags: [['e', '1'.repeat(64)]] };

function stubWallet(over: Partial<NonNullable<Window['nostr']>> = {}) {
  window.nostr = {
    getPublicKey: async () => PK,
    signEvent: async (t) => finalizeEvent(t as unknown as Parameters<typeof finalizeEvent>[0], sk) as unknown as Record<string, unknown>,
    ...over,
  };
}

beforeEach(() => { relayOutcomes.length = 0; published.length = 0; });
afterEach(() => { delete window.nostr; });

describe('signAndPublish', () => {
  it('signs with the wallet and resolves once two relays ack', async () => {
    stubWallet();
    relayOutcomes.push(() => Promise.resolve(''), () => Promise.reject(new Error('blocked')), () => Promise.resolve(''));
    const signed = await signAndPublish(template, PK);
    expect(signed.pubkey).toBe(PK);
    expect(signed.kind).toBe(7);
    expect(published).toHaveLength(1);
  });

  it('fails when fewer than two relays accept, counting a resolved connection failure as a miss', async () => {
    stubWallet();
    relayOutcomes.push(
      () => Promise.resolve(''),
      () => Promise.resolve('connection failure: refused'),
      () => Promise.reject(new Error('timeout')),
    );
    await expect(signAndPublish(template, PK)).rejects.toThrow(/1\/3 relays/);
  });

  it('refuses to sign as a different identity than the one signed in', async () => {
    stubWallet({ getPublicKey: async () => 'f'.repeat(64) });
    await expect(signAndPublish(template, PK)).rejects.toThrow(/active as/);
    expect(published).toHaveLength(0);
  });

  it('explains a latched wallet instead of surfacing its raw message', async () => {
    stubWallet({ signEvent: async () => { throw new Error('nos2x: rejecting further requests until the next reload'); } });
    await expect(signAndPublish(template, PK)).rejects.toThrow(/Reload this page/);
  });

  it('rejects a forged signature', async () => {
    stubWallet({ signEvent: async (t) => ({ ...(finalizeEvent(t as never, sk) as unknown as Record<string, unknown>), sig: '0'.repeat(128) }) });
    await expect(signAndPublish(template, PK)).rejects.toThrow(/invalid signature/);
  });

  it('needs a wallet at all', async () => {
    await expect(signAndPublish(template, PK)).rejects.toThrow(/No signing extension/);
  });
});
