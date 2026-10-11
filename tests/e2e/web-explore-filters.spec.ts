// Explore's filters live in the URL (lib/feed-url.ts): a filtered link opens with those
// filters applied, narrows the relay REQ (authors / #l), and every change is mirrored
// back into the address bar. The relay is mocked and answers each REQ the way a real
// relay would, so a filter the app fails to send shows up as the wrong posts.

import { test, expect, type Page } from '@playwright/test';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import type { Event } from 'nostr-tools/core';

interface Filter { kinds?: number[]; authors?: string[]; '#l'?: string[] }

// Only the cast feed's REQs — the page also asks for kind-0 profiles of the authors it shows.
const feedReqs = (reqs: Filter[]) => reqs.filter((f) => f.kinds?.includes(30023));

function cast(sk: Uint8Array, title: string, category: string, signal: string, ageSec: number): Event {
  return finalizeEvent({
    kind: 1,
    created_at: Math.floor(Date.now() / 1000) - ageSec,
    tags: [
      ['r', `https://example.com/${title.toLowerCase().replace(/\s+/g, '-')}`],
      ['title', title],
      ['L', 'app.wirthy.signal'], ['l', signal, 'app.wirthy.signal'],
      ['L', 'app.wirthy.category'], ['l', category, 'app.wirthy.category'],
      ['t', 'wirthy'],
      ['format', 'bookmark'],
    ],
    content: `${title}\nhttps://example.com`,
  }, sk);
}

const SK_A = generateSecretKey();
const SK_B = generateSecretKey();
const PK_A = getPublicKey(SK_A);
const EVENTS = [
  cast(SK_A, 'Alpha Post', 'Tech', 'Worthwhile', 60),
  cast(SK_B, 'Beta Post', 'Science', 'Noise', 120),
];

function matches(e: Event, f: Filter): boolean {
  if (f.authors && !f.authors.includes(e.pubkey)) return false;
  if (f['#l'] && !e.tags.some((t) => t[0] === 'l' && f['#l']!.includes(t[1]))) return false;
  return true;
}

/** Mock every wss:// relay; returns the list of REQ filters received. */
async function mockRelay(page: Page): Promise<Filter[]> {
  const reqs: Filter[] = [];
  await page.addInitScript(() => {
    try {
      localStorage.setItem('wirthy.relayMode', 'production');
      // A returning visitor: the first-visit popover would cover the filter strip.
      localStorage.setItem('wirthy.seenHero', '1');
    } catch { /* ignore */ }
  });
  await page.routeWebSocket(/^wss:\/\//, (ws) => {
    ws.onMessage((message) => {
      try {
        const parsed = JSON.parse(typeof message === 'string' ? message : message.toString());
        if (!Array.isArray(parsed) || parsed[0] !== 'REQ') return;
        const [, subId, filter] = parsed as [string, string, Filter & { since?: number }];
        reqs.push(filter);
        // The live-tail REQ (since=now) gets nothing, like a real relay would.
        if (filter.since === undefined) {
          for (const e of EVENTS.filter((ev) => matches(ev, filter))) ws.send(JSON.stringify(['EVENT', subId, e]));
        }
        ws.send(JSON.stringify(['EOSE', subId]));
      } catch { /* non-JSON frame */ }
    });
  });
  return reqs;
}

const row = (page: Page, title: string) => page.locator('article.clip', { hasText: title });

test.describe('Explore filters in the URL', () => {
  test('a filtered link applies its filters and narrows the relay REQ', async ({ page }) => {
    const reqs = await mockRelay(page);
    await page.goto(`/explore?publisher=${npubEncode(PK_A)}&category=tech`);

    await expect(row(page, 'Alpha Post')).toBeVisible({ timeout: 15_000 });
    await expect(row(page, 'Beta Post')).toHaveCount(0);
    await expect(page.locator('.active-pill', { hasText: 'Tech' })).toBeVisible();
    await expect(page.locator('.active-pill', { hasText: 'By:' })).toBeVisible();

    // No unscoped REQ was sent first: every one carried the author and category.
    expect(feedReqs(reqs).length).toBeGreaterThan(0);
    for (const f of feedReqs(reqs)) {
      expect(f.authors).toEqual([PK_A]);
      expect(f['#l']).toEqual(['Tech']);
    }
  });

  test('clearing a relay-side filter re-subscribes without it', async ({ page }) => {
    const reqs = await mockRelay(page);
    await page.goto('/explore?category=tech');
    await expect(row(page, 'Alpha Post')).toBeVisible({ timeout: 15_000 });
    await expect(row(page, 'Beta Post')).toHaveCount(0);

    await page.locator('.active-pill', { hasText: 'Tech' }).locator('.x').click();
    await expect(row(page, 'Beta Post')).toBeVisible({ timeout: 15_000 });
    expect(feedReqs(reqs).some((f) => f['#l'] === undefined)).toBe(true);
    expect(new URL(page.url()).searchParams.get('category')).toBeNull();
  });

  test('a publisher page (/p/<npub>) is the feed locked to that author', async ({ page }) => {
    const reqs = await mockRelay(page);
    await page.goto(`/p/${npubEncode(PK_A)}`);

    await expect(row(page, 'Alpha Post')).toBeVisible({ timeout: 15_000 });
    await expect(row(page, 'Beta Post')).toHaveCount(0);
    await expect(page.locator('.feed-title')).toContainText('Posts by');
    for (const f of feedReqs(reqs)) expect(f.authors).toEqual([PK_A]);

    // The path names the publisher, so the query never repeats it — other filters still sync.
    await page.locator('.pip[title="Worthwhile"]').click();
    await expect.poll(() => new URL(page.url()).searchParams.getAll('signal')).toEqual(['worthwhile']);
    expect(new URL(page.url()).pathname).toBe(`/p/${npubEncode(PK_A)}`);
    expect(new URL(page.url()).searchParams.get('publisher')).toBeNull();

    // Dropping the publisher leaves for the general feed, keeping the other filters.
    await page.locator('.active-pill', { hasText: 'By:' }).locator('.x').click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/explore');
    expect(new URL(page.url()).searchParams.getAll('signal')).toEqual(['worthwhile']);
  });

  test('a malformed publisher link falls back to Explore', async ({ page }) => {
    await mockRelay(page);
    await page.goto('/p/not-an-npub?signal=noise');
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe('/explore');
    expect(new URL(page.url()).searchParams.getAll('signal')).toEqual(['noise']);
  });

  test('changing filters rewrites the address bar, keeping foreign params', async ({ page }) => {
    await mockRelay(page);
    await page.goto('/explore?popover=0');
    await expect(row(page, 'Beta Post')).toBeVisible({ timeout: 15_000 });

    await page.locator('.pip[title="Worthwhile"]').click();
    await expect(row(page, 'Beta Post')).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).searchParams.getAll('signal')).toEqual(['worthwhile']);

    await page.locator('.search input').fill('alpha');
    await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('alpha');
    expect(new URL(page.url()).searchParams.get('popover')).toBe('0');

    // The rewritten URL reproduces the view on a fresh load.
    await page.reload();
    await expect(row(page, 'Alpha Post')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.active-pill', { hasText: 'Signal: Worthwhile' })).toBeVisible();
    await expect(page.locator('.search input')).toHaveValue('alpha');
  });
});
