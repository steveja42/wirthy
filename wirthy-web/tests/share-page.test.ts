// Share-page metadata (lib/share-page.ts) and the REAL Netlify handler around it
// (netlify/functions/share-page.mts). The relay is an in-memory mock of nostr-tools'
// pool and `fetch` serves a minimal shell, so fetchCast/parseEvent/injection all run for real.
//
// The branches that matter: hostile event text cannot break out of the markup, the
// indexing policy (a take, not the test author), and every failure serving the bare shell.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { naddrEncode, noteEncode, npubEncode } from 'nostr-tools/nip19';
import type { Event, Filter } from 'nostr-tools';
import type { ClipData } from '@/lib/types';

let relayEvents: Event[] = [];
let relayDown = false;
function matches(e: Event, f: Filter): boolean {
  if (f.ids && !f.ids.includes(e.id)) return false;
  if (f.kinds && !f.kinds.includes(e.kind)) return false;
  if (f.authors && !f.authors.includes(e.pubkey)) return false;
  if (f['#d'] && !e.tags.some((t) => t[0] === 'd' && f['#d']!.includes(t[1]))) return false;
  return true;
}
vi.mock('nostr-tools', async (orig) => ({
  ...(await orig<typeof import('nostr-tools')>()),
  SimplePool: class {
    async querySync(_r: string[], f: Filter) {
      if (relayDown) throw new Error('simulated relay failure');
      return relayEvents.filter((e) => matches(e, f));
    }
    destroy() {}
  },
}));

const { castShareMeta, injectShareMeta, publisherShareMeta, DEFAULT_OG_IMAGE } = await import('@/lib/share-page');
const { verifyNip05 } = await import('@/lib/nostr/cast-ref');
const { default: handler } = await import('../netlify/functions/share-page.mts');
const { TEST_CAST_PUBKEY } = await import('@/lib/nostr/test-cast-author');

// The tags Next emits into the exported shell (see out/c.html), plus the placeholder.
const SHELL = '<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Post — Wirthy</title>'
  + '<meta name="description" content="Default"/><meta name="robots" content="noindex, follow"/>'
  + '<meta property="og:title" content="Post — Wirthy"/><meta property="og:image" content="x"/>'
  + '<meta name="twitter:card" content="summary_large_image"/></head>'
  + '<body><main class="cast-page"><div id="ssr-cast"></div></main></body></html>';

const SK = generateSecretKey();
const PK = getPublicKey(SK);
const D = 'share-test';
const evalTags = (signal?: string) => [
  ...(signal ? [['L', 'app.wirthy.signal'], ['l', signal, 'app.wirthy.signal']] : []),
  ['L', 'app.wirthy.category'], ['l', 'Tech', 'app.wirthy.category'],
  ['t', 'wirthy'], ['r', 'https://example.com/a'],
];
const LONG = finalizeEvent({
  kind: 30023, created_at: 100, content: 'SECRET ARTICLE BODY that must not reach the HTML',
  tags: [['d', D], ['title', 'Long Title'], ['summary', 'A short summary.'], ...evalTags('Worthwhile')],
}, SK);
const NOTE = finalizeEvent({ kind: 1, created_at: 100, content: 'teaser', tags: [['a', `30023:${PK}:${D}`], ['title', 'Long Title'], ...evalTags('Worthwhile')] }, SK);
const BARE = finalizeEvent({ kind: 1, created_at: 100, content: 'Bare\nhttps://example.com/a', tags: [['title', 'Bare Bookmark'], ...evalTags()] }, SK);
const RATED = finalizeEvent({ kind: 1, created_at: 100, content: 'x', tags: [['title', 'Rated Bookmark'], ...evalTags('Masterpiece')] }, SK);
const PROFILE = finalizeEvent({ kind: 0, created_at: 100, content: JSON.stringify({ name: 'Alice', about: 'Reads things.', picture: 'https://img.example/a.png', nip05: 'alice@example.com' }), tags: [] }, SK);

function clipOf(over: Partial<ClipData['capture']>, evaluation: Partial<ClipData['evaluation']> = {}): ClipData {
  return {
    capture: { id: 'x', kind: 1, format: 'bookmark', url: 'https://example.com/a', title: 'T', timestamp: 0, authorPubkey: PK, ...over },
    evaluation: { qualifiers: [], category: 'Tech', ...evaluation },
    encrypted: '',
  } as ClipData;
}

describe('castShareMeta + injectShareMeta', () => {
  it('escapes hostile event text everywhere it lands', () => {
    const hostile = '</title><script>alert(1)</script>"><img src=x onerror=alert(2)> $\' $&';
    const meta = castShareMeta({
      clip: clipOf({ title: hostile, note: hostile, url: 'https://e.com/"><script>' }, { signal: 'Noise', qualifiers: ['<b>q</b>'] }),
      canonicalPath: '/c/x', isTestAuthor: false,
    });
    const html = injectShareMeta(SHELL, meta);
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>q</b>');
    expect(html.match(/<title>/g)).toHaveLength(1);
    // `$'` / `$&` survive literally instead of splicing shell text into the output.
    expect(html).toContain("$&#39; $&amp;");
    // JSON-LD can't close its own <script>.
    const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
    expect(ld).not.toContain('<');
    expect(JSON.parse(ld).reviewBody).toBe(hostile);
  });

  it('replaces every shell tag exactly once and fills the placeholder', () => {
    const html = injectShareMeta(SHELL, castShareMeta({ clip: clipOf({ title: 'Hello', note: 'Mine' }), canonicalPath: '/c/abc', isTestAuthor: false }));
    for (const tag of ['<meta name="description"', '<meta name="robots"', '<meta property="og:title"', '<meta name="twitter:card"', '<link rel="canonical"']) {
      expect(html.split(tag).length - 1).toBe(1);
    }
    expect(html).toContain('<link rel="canonical" href="https://wirthy.app/c/abc"/>');
    expect(html).toContain('<div id="ssr-cast"><article><h1>Hello</h1>');
    expect(html).not.toContain('content="Default"');
  });

  it('indexes only a cast with a take, and never the test author', () => {
    const meta = (over: Partial<ClipData['capture']>, signal?: 'Noise', isTestAuthor = false) =>
      castShareMeta({ clip: clipOf(over, { signal }), canonicalPath: '/c/x', isTestAuthor });
    expect(meta({ note: 'my take' }).index).toBe(true);
    expect(meta({}, 'Noise').index).toBe(true);
    expect(meta({}).index).toBe(false);
    expect(meta({ note: 'my take' }, 'Noise', true).index).toBe(false);
    expect(meta({}).jsonLd).toBeUndefined();
  });

  it('a hostile kind-0 name cannot close the embedded identity script', () => {
    const name = '</script><script>alert(1)</script>';
    const html = injectShareMeta(SHELL, castShareMeta({
      clip: clipOf({ title: 'T' }), canonicalPath: '/c/x', isTestAuthor: false, author: { pubkey: PK, name },
    }));
    expect(html).not.toContain('<script>alert');
    const embedded = /id="ssr-author">([^<]*)<\/script>/.exec(html)?.[1];
    expect(JSON.parse(embedded ?? 'null').name).toBe(name);
  });

  it('only verifies a NIP-05 on a plain https hostname', async () => {
    const fetchSpy = vi.fn(async () => Response.json({ names: { a: PK } }));
    vi.stubGlobal('fetch', fetchSpy);
    for (const bad of ['a@127.0.0.1', 'a@localhost', 'a@example.com:8080', 'a@[::1]', 'no-at-sign']) {
      expect(await verifyNip05(PK, bad)).toBe(false);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await verifyNip05(PK, 'a@example.com')).toBe(true);
    vi.unstubAllGlobals();
  });

  it('uses an https image only, else the default card', () => {
    const img = (thumbnail: string) => castShareMeta({ clip: clipOf({ thumbnail }), canonicalPath: '/c/x', isTestAuthor: false }).image;
    expect(img('https://cdn.example/h.jpg')).toBe('https://cdn.example/h.jpg');
    expect(img('data:image/png;base64,AAAA')).toBe(DEFAULT_OG_IMAGE);
  });

  it('publisher pages preview but stay noindex', () => {
    const meta = publisherShareMeta(PK, { name: 'Alice', about: 'Reads things.' });
    expect(meta.title).toBe('Posts by Alice — Wirthy');
    expect(meta.index).toBe(false);
    expect(meta.canonical).toBe(`https://wirthy.app/p/${npubEncode(PK)}`);
  });
});

describe('share-page handler', () => {
  let shellOk = true;
  let nip05Names: Record<string, string> = {};
  beforeEach(() => {
    relayEvents = [NOTE, LONG, BARE, RATED, PROFILE];
    relayDown = false;
    shellOk = true;
    nip05Names = { alice: PK };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith('https://example.com/.well-known/nostr.json')) return Response.json({ names: nip05Names });
      return shellOk ? new Response(SHELL, { status: 200 }) : new Response('nope', { status: 404 });
    }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  const get = (path: string) => handler(new Request(`https://wirthy.app${path}`));

  it('resolves a kind-1 to its long-form: naddr canonical, author name, no article body', async () => {
    const res = await get(`/c/${noteEncode(NOTE.id)}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain(`href="https://wirthy.app/c/${naddrEncode({ kind: 30023, pubkey: PK, identifier: D })}"`);
    expect(html).toContain('Posted by alice@example.com');
    expect(html).toContain('A short summary.');
    expect(html).not.toContain('SECRET ARTICLE BODY');
    expect(res.headers.get('x-robots-tag')).toBeNull();
    expect(res.headers.get('netlify-cdn-cache-control')).toContain('s-maxage=3600');
  });

  it('caches a plain note as immutable', async () => {
    const res = await get(`/c/${noteEncode(RATED.id)}`);
    expect(res.headers.get('netlify-cdn-cache-control')).toContain('s-maxage=86400');
    expect(await res.text()).toContain('<title>Rated Bookmark · Masterpiece — Wirthy</title>');
  });

  it('marks a bare clip noindex in both the header and the page', async () => {
    const res = await get(`/c/${noteEncode(BARE.id)}`);
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    expect(await res.text()).toContain('<meta name="robots" content="noindex, follow"/>');
  });

  it('never indexes the e2e test author', async () => {
    const testSk = new Uint8Array(Array.from({ length: 32 }, (_, i) => (i * 7 + 13) & 0xff));
    expect(getPublicKey(testSk)).toBe(TEST_CAST_PUBKEY);
    const testCast = finalizeEvent({ kind: 1, created_at: 1, content: 'x', tags: [['title', 'T'], ['note', 'n'], ...evalTags('Noise')] }, testSk);
    relayEvents.push(testCast);
    const res = await get(`/c/${noteEncode(testCast.id)}`);
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
  });

  it('serves the bare shell for an unknown cast, a malformed id, and a relay failure', async () => {
    for (const path of [`/c/${noteEncode('f'.repeat(64))}`, '/c/garbage']) {
      const res = await get(path);
      expect(await res.text()).toBe(SHELL);
      expect(res.headers.get('netlify-cdn-cache-control')).toBe('public, s-maxage=60');
    }
    relayDown = true;
    const res = await get(`/c/${noteEncode(RATED.id)}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(SHELL);
  });

  it('answers 503 when the shell itself cannot be loaded', async () => {
    shellOk = false;
    expect((await get(`/c/${noteEncode(RATED.id)}`)).status).toBe(503);
  });

  it('embeds the verified identity so the client can show the NIP-05 at once', async () => {
    const html = await (await get(`/c/${noteEncode(RATED.id)}`)).text();
    const embedded = /<script type="application\/json" id="ssr-author">([^<]*)<\/script>/.exec(html)?.[1];
    expect(JSON.parse(embedded ?? 'null')).toEqual({ pubkey: PK, name: 'Alice', nip05: 'alice@example.com', verified: true });
  });

  it('falls back to the kind-0 name when the NIP-05 does not resolve to the author', async () => {
    nip05Names = { alice: 'e'.repeat(64) };
    const html = await (await get(`/c/${noteEncode(RATED.id)}`)).text();
    expect(html).toContain('Posted by Alice');
    expect(html).not.toContain('alice@example.com');
    const embedded = /id="ssr-author">([^<]*)</.exec(html)?.[1];
    expect(JSON.parse(embedded ?? 'null')).toEqual({ pubkey: PK, name: 'Alice' });
  });

  it('uses the large card for a post, and the small one for a profile avatar', async () => {
    expect(await (await get(`/c/${noteEncode(RATED.id)}`)).text()).toContain('<meta name="twitter:card" content="summary_large_image"/>');
    expect(await (await get(`/p/${npubEncode(PK)}`)).text()).toContain('<meta name="twitter:card" content="summary"/>');
  });

  it('previews a publisher page from their profile', async () => {
    const res = await get(`/p/${npubEncode(PK)}`);
    const html = await res.text();
    expect(html).toContain('<title>Posts by alice@example.com — Wirthy</title>');
    expect(html).toContain('content="https://img.example/a.png"');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
  });
});
