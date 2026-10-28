// Signs an event with the page's NIP-07 wallet and publishes it to the active relays.
// The web app's only write path to Nostr (likes, unlikes, replies); everything else is
// published by the extension. Resolves once enough relays have acknowledged it.

import { SimplePool, verifyEvent, type Event, type EventTemplate } from 'nostr-tools';
import { npubEncode } from 'nostr-tools/nip19';
import { getActiveRelays } from '@/lib/constants';
import { LL, log } from '@/lib/logger';
import { WALLET_LATCHED_RE } from './wallet-errors';

const SIGN_TIMEOUT_MS = 30_000;
const PUBLISH_TIMEOUT_MS = 10_000;
// nostr-tools RESOLVES (not rejects) a publish that never reached the relay.
const NOT_ACKED_RE = /^(connection failure|connection skipped|duplicate url)/i;

/** Mirrors the extension's minAcksFor: 1 for a lone (local) relay, else 2. */
export function minAcksFor(relays: string[]): number {
  return Math.min(relays.length, 2);
}

function npubShort(pk: string): string {
  try { return `${npubEncode(pk).slice(0, 12)}…`; } catch { return `${pk.slice(0, 12)}…`; }
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

async function sign(template: EventTemplate, expectedPubkey: string): Promise<Event> {
  const nostr = window.nostr;
  if (!nostr) throw new Error('No signing extension found. Install or unlock one, then reload this page.');
  try {
    const active = await withTimeout(nostr.getPublicKey(), SIGN_TIMEOUT_MS, 'Your signing extension did not respond — it may be locked.');
    if (active !== expectedPubkey) {
      throw new Error(`Your signing extension is active as ${npubShort(active)} but you signed in as ${npubShort(expectedPubkey)}. Switch identity in your wallet, or sign in again.`);
    }
    const raw = await withTimeout(
      nostr.signEvent({ ...template, pubkey: expectedPubkey }),
      SIGN_TIMEOUT_MS,
      'Your signing extension did not respond — it may be locked.',
    ) as unknown as Event;
    // A fresh object: verifyEvent trusts a cached "verified" symbol riding on the original.
    const { id, pubkey, created_at, kind, tags, content, sig } = raw;
    const signed: Event = { id, pubkey, created_at, kind, tags, content, sig };
    if (!verifyEvent(signed) || signed.pubkey !== expectedPubkey) throw new Error('Your signing extension returned an invalid signature.');
    return signed;
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    if (WALLET_LATCHED_RE.test(raw)) throw new Error('Your signing extension is refusing requests after a cancelled prompt. Reload this page and try again.');
    throw err instanceof Error ? err : new Error(raw || 'Your signing extension rejected the request.');
  }
}

/** Resolves when `needed` relays acked; the pool stays open until every relay settles. */
function publish(signed: Event, relays: string[]): Promise<void> {
  const pool = new SimplePool();
  const needed = minAcksFor(relays);
  let acks = 0;
  let settled = 0;
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = () => {
      if (settled < relays.length) return;
      pool.destroy();
      if (!done) reject(new Error(`Could not publish (${acks}/${relays.length} relays accepted it).`));
    };
    for (const p of pool.publish(relays, signed, { maxWait: PUBLISH_TIMEOUT_MS })) {
      p.then((reason) => {
        if (typeof reason === 'string' && NOT_ACKED_RE.test(reason)) throw new Error(reason);
        acks += 1;
        if (!done && acks >= needed) { done = true; resolve(); }
      }).catch((err: unknown) => {
        log(LL.WARN, '[nostr] publish rejected by a relay:', err instanceof Error ? err.message : err);
      }).finally(() => { settled += 1; finish(); });
    }
  });
}

export async function signAndPublish(template: EventTemplate, expectedPubkey: string): Promise<Event> {
  const relays = [...getActiveRelays()];
  const signed = await sign(template, expectedPubkey);
  await publish(signed, relays);
  log(LL.NORMAL, `[nostr] published kind ${signed.kind} ${signed.id.slice(0, 8)} to`, relays);
  return signed;
}
