// Public cast pages (/c/<id>): one exported shell serves every id, the client fetches the
// event from a mocked relay, re-addresses a kind-1 to its long-form's naddr, and renders it
// with the feed's DetailPanel. Also: the Explore feed links into these pages.

import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { naddrEncode, noteEncode, npubEncode } from 'nostr-tools/nip19';
import type { Event, Filter } from 'nostr-tools';

const OUT = join(process.cwd(), 'test-output');
mkdirSync(OUT, { recursive: true });

const SK = generateSecretKey();
const PK = getPublicKey(SK);
const D = 'e2e-cast-page';
const TITLE = 'A Cast Worth Its Own Page';
const now = Math.floor(Date.now() / 1000);

const sharedTags = [
  ['r', 'https://example.com/worth-a-page'],
  ['title', TITLE],
  ['L', 'app.wirthy.signal'], ['l', 'Masterpiece', 'app.wirthy.signal'],
  ['L', 'app.wirthy.category'], ['l', 'Culture', 'app.wirthy.category'],
  ['t', 'wirthy'],
  ['format', 'article'],
];
const LONG_FORM = finalizeEvent({ kind: 30023, created_at: now - 60, content: 'The **full** article body.', tags: [['d', D], ...sharedTags] }, SK);
const NOTE = finalizeEvent({ kind: 1, created_at: now - 60, content: `${TITLE}\nhttps://example.com/worth-a-page`, tags: [['a', `30023:${PK}:${D}`], ...sharedTags] }, SK);
const NADDR = naddrEncode({ kind: 30023, pubkey: PK, identifier: D });

function matches(e: Event, f: Filter): boolean {
  if (f.ids && !f.ids.includes(e.id)) return false;
  if (f.kinds && !f.kinds.includes(e.kind)) return false;
  if (f.authors && !f.authors.includes(e.pubkey)) return false;
  if (f['#d'] && !e.tags.some((t) => t[0] === 'd' && f['#d']!.includes(t[1]))) return false;
  if (f['#t'] && !e.tags.some((t) => t[0] === 't' && f['#t']!.includes(t[1]))) return false;
  if (f.since !== undefined && e.created_at < f.since) return false;
  return true;
}

async function mockRelay(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('wirthy.relayMode', 'production');
      localStorage.setItem('wirthy.seenHero', '1');
    } catch { /* ignore */ }
  });
  await page.routeWebSocket(/^wss:\/\//, (ws) => {
    ws.onMessage((message) => {
      try {
        const parsed = JSON.parse(typeof message === 'string' ? message : message.toString());
        if (!Array.isArray(parsed) || parsed[0] !== 'REQ') return;
        const [, subId, ...filters] = parsed as [string, string, ...Filter[]];
        for (const e of [NOTE, LONG_FORM].filter((ev) => filters.some((f) => matches(ev, f)))) {
          ws.send(JSON.stringify(['EVENT', subId, e]));
        }
        ws.send(JSON.stringify(['EOSE', subId]));
      } catch { /* non-JSON frame */ }
    });
  });
}

test.describe('public cast page', () => {
  test('a kind-1 link resolves to its long-form and is re-addressed to the naddr', async ({ page }) => {
    await mockRelay(page);
    await page.goto(`/c/${noteEncode(NOTE.id)}?ref=share`);

    await expect(page.locator('.detail-title')).toHaveText(TITLE, { timeout: 15_000 });
    await expect(page.locator('.clip-body, .detail').first()).toContainText('full');
    await expect.poll(() => new URL(page.url()).pathname).toBe(`/c/${NADDR}`);
    expect(new URL(page.url()).searchParams.get('ref')).toBe('share');
    await expect(page).toHaveTitle(`${TITLE} — Wirthy`);

    // Read-only: no delete action, and the publisher link opens their filtered feed.
    await expect(page.locator('.btn-detail-delete')).toHaveCount(0);
    await expect(page.locator('.cast-page-byline a')).toHaveAttribute('href', `/p/${npubEncode(PK)}`);
    // The crawler placeholder is gone once the live cast is shown.
    await expect(page.locator('#ssr-cast')).toHaveCount(0);
    await page.screenshot({ path: join(OUT, 'cast-page.png') });
  });

  test('an naddr link loads directly', async ({ page }) => {
    await mockRelay(page);
    await page.goto(`/c/${NADDR}`);
    await expect(page.locator('.detail-title')).toHaveText(TITLE, { timeout: 15_000 });
    expect(new URL(page.url()).pathname).toBe(`/c/${NADDR}`);
  });

  test('an unknown cast and a malformed id each get their own message', async ({ page }) => {
    await mockRelay(page);
    await page.goto(`/c/${noteEncode('f'.repeat(64))}`);
    await expect(page.locator('.cast-page-status h1')).toHaveText('Post not found.', { timeout: 15_000 });

    await page.goto('/c/definitely-not-an-id');
    await expect(page.locator('.cast-page-status h1')).toHaveText('That isn’t a post link.', { timeout: 15_000 });
  });

  test('the Explore feed links each post to its page', async ({ page }) => {
    await mockRelay(page);
    await page.goto('/explore');
    await expect(page.locator('article.clip', { hasText: TITLE }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.btn-detail-link').first()).toHaveAttribute('href', `/c/${NADDR}`);
  });
});
