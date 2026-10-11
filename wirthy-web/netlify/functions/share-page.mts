// Share pages (/c/<id>, /p/<npub>) with crawler-visible metadata.
//
// The pages are one exported static shell each (out/c.html, out/p.html) that the client
// fills from Nostr. Search engines and link-preview bots (Discord, X, Nostr clients) don't
// run that JavaScript, so this function fetches the event from the production relays and
// injects the title, description, Open Graph tags, canonical, robots and a short summary
// into the shell. The client renders exactly as it would without it.
//
// Any failure returns the shell unmodified — the page still works, it just previews generically.
// See wirthy-web/CLAUDE.md → Share pages.

import { decodeCastRef, encodeCastRef, fetchCast, fetchProfile } from '../../lib/nostr/cast-ref.ts';
import { parseEvent } from '../../lib/nostr/parse.ts';
import { DEFAULT_RELAYS } from '../../lib/constants.ts';
import { TEST_CAST_PUBKEY } from '../../lib/nostr/test-cast-author.ts';
import { npubToHex } from '../../lib/feed-url.ts';
import { castShareMeta, injectShareMeta, publisherShareMeta, type ShareMeta } from '../../lib/share-page.ts';

// Minimal local shape for the v2-runtime type we touch (see feedback.mts for why).
interface Config { path: string[]; preferStatic?: boolean }

// The relays answer in ~200ms; this bounds a slow one so a preview bot isn't kept waiting.
const RELAY_TIMEOUT_MS = 2_500;

// CDN caching. A note id names one immutable event; an naddr (replaceable long-form) or a
// profile can change, so it is revalidated hourly. Misses are retried after a minute.
const CACHE_IMMUTABLE = 'public, durable, s-maxage=86400, stale-while-revalidate=604800';
const CACHE_MUTABLE = 'public, durable, s-maxage=3600, stale-while-revalidate=86400';
const CACHE_MISS = 'public, s-maxage=60';

function respond(html: string, cdnCache: string, index: boolean): Response {
  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=0, must-revalidate',
      'netlify-cdn-cache-control': cdnCache,
      ...(index ? {} : { 'x-robots-tag': 'noindex' }),
    },
  });
}

async function castMeta(id: string, relays: string[]): Promise<{ meta: ShareMeta; immutable: boolean } | null> {
  const ref = decodeCastRef(id);
  if (!ref) return null;
  const found = await fetchCast(ref, relays, RELAY_TIMEOUT_MS);
  if (!found) return null;
  const clip = parseEvent(found.event);
  const profile = await fetchProfile(found.event.pubkey, relays, RELAY_TIMEOUT_MS).catch(() => null);
  return {
    meta: castShareMeta({
      clip,
      canonicalPath: `/c/${encodeCastRef(found.canonical)}`,
      authorName: profile?.name,
      isTestAuthor: found.event.pubkey === TEST_CAST_PUBKEY,
    }),
    immutable: found.canonical.type === 'note',
  };
}

async function publisherMeta(npub: string, relays: string[]): Promise<ShareMeta | null> {
  const pubkey = npubToHex(npub);
  if (!pubkey) return null;
  return publisherShareMeta(pubkey, await fetchProfile(pubkey, relays, RELAY_TIMEOUT_MS).catch(() => null));
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const [, section, rawId = ''] = url.pathname.split('/');
  const id = decodeURIComponent(rawId);

  let shell: string;
  try {
    const res = await fetch(new URL(section === 'p' ? '/p.html' : '/c.html', url.origin));
    if (!res.ok) throw new Error(`shell ${res.status}`);
    shell = await res.text();
  } catch (err) {
    console.error('[share-page] could not load the static shell:', err);
    return new Response('Temporarily unavailable', { status: 503, headers: { 'cache-control': 'no-store' } });
  }

  try {
    const relays = [...DEFAULT_RELAYS];
    if (section === 'p') {
      const meta = await publisherMeta(id, relays);
      return meta ? respond(injectShareMeta(shell, meta), CACHE_MUTABLE, false) : respond(shell, CACHE_MISS, false);
    }
    const result = await castMeta(id, relays);
    if (!result) return respond(shell, CACHE_MISS, false);
    return respond(injectShareMeta(shell, result.meta), result.immutable ? CACHE_IMMUTABLE : CACHE_MUTABLE, result.meta.index);
  } catch (err) {
    console.error('[share-page] metadata failed, serving the bare shell:', err);
    return respond(shell, CACHE_MISS, false);
  }
}

// preferStatic: the exported RSC payloads under out/c/ and out/p/ (__next.*.txt) must be
// served as files, not intercepted by this function.
export const config: Config = { path: ['/c/*', '/p/*'], preferStatic: true };
