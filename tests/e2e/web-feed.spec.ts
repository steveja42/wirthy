// Mocks the public Nostr relay subscription used by HomeClient by intercepting
// every wss:// WebSocket. On REQ, responds with a single signed Wirthy
// kind:1 event and EOSE. Asserts the event renders on the home feed.

import { test, expect } from '@playwright/test';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import type { EventTemplate } from 'nostr-tools/core';

function buildFixtureEvent(createdAt = Math.floor(Date.now() / 1000)) {
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  const template: EventTemplate = {
    kind: 1,
    created_at: createdAt,
    tags: [
      ['r', 'https://example.com/test-cast'],
      ['L', 'app.wirthy.signal'],
      ['l', 'Masterpiece', 'app.wirthy.signal'],
      ['L', 'app.wirthy.qualifier'],
      ['l', 'Timeless', 'app.wirthy.qualifier'],
      ['L', 'app.wirthy.category'],
      ['l', 'Science', 'app.wirthy.category'],
      ['t', 'wirthy'],
      ['format', 'article'],
      ['client', 'wirthy'],
    ],
    content: 'Wirthy: ★★★★★ Masterpiece in Science\n\nA Mocked Cast Title\nhttps://example.com/test-cast',
  };
  return { event: finalizeEvent(template, sk), pk };
}

test.describe('public feed — mocked Nostr relay', () => {
  test('renders a clip from a mocked relay subscription', async ({ page }) => {
    const { event } = buildFixtureEvent();

    // Force production relay mode so the feed opens wss:// sockets we can
    // intercept. In dev the NEXT_PUBLIC_LOCAL_RELAY env var makes the feed
    // subscribe to ws://localhost:7777 instead, which bypasses the mock (and,
    // when the local relay is running, floods the feed with real test casts).
    await page.addInitScript(() => {
      try { localStorage.setItem('wirthy.relayMode', 'production'); } catch { /* ignore */ }
    });

    // Intercept any wss:// connection HomeClient opens via SimplePool.
    await page.routeWebSocket(/^wss:\/\//, (ws) => {
      ws.onMessage((message: string | Buffer) => {
        const msg = typeof message === 'string' ? message : message.toString();
        try {
          const parsed = JSON.parse(msg);
          if (Array.isArray(parsed) && parsed[0] === 'REQ') {
            const subId = parsed[1];
            ws.send(JSON.stringify(['EVENT', subId, event]));
            ws.send(JSON.stringify(['EOSE', subId]));
          }
        } catch {
          // Ignore non-JSON frames (e.g. CLOSE).
        }
      });
    });

    await page.goto('/explore');
    // The feed renders one <article class="clip"> per kind:1 event. Scope to
    // that container — the title shows up in multiple child elements (.clip-title
    // and .clip-excerpt/.clip-note), so a page-wide getByText would be ambiguous.
    await expect(
      page.locator('article.clip', { hasText: 'A Mocked Cast Title' }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  // A cast's created_at is its CAPTURE time, so it can predate the feed's live
  // tail by minutes (the signing flow even opens a fresh /explore tab). The tail
  // must still deliver it; a `since: now` filter had the relay drop it.
  test('a cast published after load appears live even if created earlier', async ({ page }) => {
    const { event } = buildFixtureEvent(Math.floor(Date.now() / 1000) - 120);
    await page.addInitScript(() => {
      try { localStorage.setItem('wirthy.relayMode', 'production'); } catch { /* ignore */ }
    });

    type Sub = { send: (m: string) => void; id: string; filter: { since?: number; until?: number } };
    const open: Sub[] = [];
    await page.routeWebSocket(/^wss:\/\//, (ws) => {
      ws.onMessage((message: string | Buffer) => {
        try {
          const parsed = JSON.parse(typeof message === 'string' ? message : message.toString());
          if (parsed[0] === 'REQ') {
            open.push({ send: (m) => ws.send(m), id: parsed[1], filter: parsed[2] ?? {} });
            ws.send(JSON.stringify(['EOSE', parsed[1]])); // empty history
          } else if (parsed[0] === 'CLOSE') {
            const i = open.findIndex(s => s.id === parsed[1]);
            if (i >= 0) open.splice(i, 1);
          }
        } catch { /* ignore non-JSON frames */ }
      });
    });

    await page.goto('/explore');
    // Wait until the backfill has closed and the live tail is the open REQ.
    await expect.poll(() => open.length, { timeout: 10_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(1_000);

    // "Publish": deliver to every open sub whose filter admits it, as a relay would.
    for (const s of open) {
      if (s.filter.since !== undefined && event.created_at < s.filter.since) continue;
      if (s.filter.until !== undefined && event.created_at > s.filter.until) continue;
      s.send(JSON.stringify(['EVENT', s.id, event]));
    }
    await expect(
      page.locator('article.clip', { hasText: 'A Mocked Cast Title' }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
