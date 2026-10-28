// Likes and threaded replies on a cast in /explore, end to end against an in-memory
// relay (every wss:// socket is routed to it). Engagement made by "another client" is
// seeded into the relay; the page's own likes/replies are signed by a window.nostr shim
// backed by a Node-side key, published by the web app, and read back off the relay.

import { test, expect, type Page } from '@playwright/test';
import { finalizeEvent, generateSecretKey, getPublicKey, type Event, type EventTemplate } from 'nostr-tools/pure';
import { matchFilter, type Filter } from 'nostr-tools/filter';

const now = () => Math.floor(Date.now() / 1000);
const sign = (sk: Uint8Array, t: Omit<EventTemplate, 'created_at'> & { created_at?: number }) =>
  finalizeEvent({ created_at: now() - 600, ...t }, sk);

const authorSk = generateSecretKey();
const AUTHOR = getPublicKey(authorSk);
const franSk = generateSecretKey();
const gusSk = generateSecretKey();
const mySk = generateSecretKey();
const ME = getPublicKey(mySk);
const D = 'clip-engagement-e2e';
const COORD = `30023:${AUTHOR}:${D}`;

function seed(): Event[] {
  const note = sign(authorSk, {
    kind: 1,
    tags: [['r', 'https://example.com/e2e'], ['L', 'app.wirthy.category'], ['l', 'Science', 'app.wirthy.category'],
      ['t', 'wirthy'], ['format', 'article'], ['title', 'Engagement Test Cast'], ['a', COORD]],
    content: 'Engagement Test Cast\nhttps://example.com/e2e',
  });
  const article = sign(authorSk, {
    kind: 30023,
    tags: [['d', D], ['title', 'Engagement Test Cast'], ['r', 'https://example.com/e2e'], ['L', 'app.wirthy.category'],
      ['l', 'Science', 'app.wirthy.category'], ['t', 'wirthy'], ['format', 'article']],
    content: 'The long-form body of the engagement test cast.',
  });
  const like = sign(franSk, { kind: 7, tags: [['e', note.id], ['p', AUTHOR], ['k', '1']], content: '+' });
  const r1 = sign(franSk, { kind: 1, tags: [['e', note.id, '', 'root', AUTHOR], ['p', AUTHOR]], content: 'Fran replied from another client' });
  const r2 = sign(gusSk, {
    kind: 1,
    tags: [['e', note.id, '', 'root', AUTHOR], ['e', r1.id, '', 'reply', getPublicKey(franSk)], ['p', getPublicKey(franSk)]],
    content: 'Gus answered Fran',
  });
  // A reply that copied the #wirthy hashtag must not be shown as a cast.
  const hashtagReply = sign(gusSk, { kind: 1, tags: [['e', note.id, '', 'root'], ['t', 'wirthy']], content: 'Hashtag-copying reply' });
  const franProfile = sign(franSk, { kind: 0, tags: [], content: JSON.stringify({ name: 'Fran Foreign' }) });
  return [note, article, like, r1, r2, hashtagReply, franProfile];
}
// Signed once: every test and assertion must see the same ids.
const SEED = seed();
const [NOTE_EVENT, , , FRAN_REPLY] = SEED;

/** One store shared by every routed socket, like a set of relays that all accept. */
async function mockRelay(page: Page) {
  const store: Event[] = [...SEED];
  const published: Event[] = [];
  const subs: { send: (m: string) => void; id: string; filters: Filter[] }[] = [];
  await page.routeWebSocket(/^wss:\/\//, (ws) => {
    ws.onMessage((raw) => {
      let msg: unknown[];
      try { msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString()); } catch { return; }
      if (msg[0] === 'REQ') {
        const [, id, ...filters] = msg as [string, string, ...Filter[]];
        subs.push({ send: (m) => ws.send(m), id, filters });
        for (const e of store) if (filters.some((f) => matchFilter(f, e))) ws.send(JSON.stringify(['EVENT', id, e]));
        ws.send(JSON.stringify(['EOSE', id]));
      } else if (msg[0] === 'CLOSE') {
        const i = subs.findIndex((s) => s.id === msg[1]);
        if (i >= 0) subs.splice(i, 1);
      } else if (msg[0] === 'EVENT') {
        const e = msg[1] as Event;
        ws.send(JSON.stringify(['OK', e.id, true, '']));
        if (store.some((x) => x.id === e.id)) return;
        published.push(e);
        deliver(e);
      }
    });
  });
  // Store an event and stream it to every open subscription it matches, as a relay would.
  function deliver(e: Event) {
    store.push(e);
    for (const s of subs) if (s.filters.some((f) => matchFilter(f, e))) s.send(JSON.stringify(['EVENT', s.id, e]));
  }
  return { published, deliver };
}

async function useWallet(page: Page) {
  await page.exposeFunction('__e2eSign', (t: EventTemplate) => finalizeEvent(t, mySk));
  await page.addInitScript((pk) => {
    const w = window as unknown as { nostr: unknown; __e2eSign: (t: unknown) => Promise<unknown> };
    w.nostr = { getPublicKey: async () => pk, signEvent: (t: unknown) => w.__e2eSign(t) };
  }, ME);
}

test.describe('cast engagement — likes and replies', () => {
  test('shows engagement from other clients, and likes, unlikes and replies with a wallet', async ({ page }) => {
    // ~10 relay round-trips; under a full parallel run the cold /explore compile alone eats much of 30s.
    test.setTimeout(90_000);
    await page.addInitScript(() => {
      try {
        localStorage.setItem('wirthy.relayMode', 'production');
        localStorage.setItem('wirthy.seenHero', '1');
      } catch { /* ignore */ }
    });
    await useWallet(page);
    const { published } = await mockRelay(page);

    // ?signin=1 makes the page take the wallet's pubkey as a live (signing) session.
    await page.goto('/explore?signin=1');

    const row = page.locator('article.clip', { hasText: 'Engagement Test Cast' });
    await expect(row).toHaveCount(1, { timeout: 15_000 });
    await expect(page.locator('article.clip')).toHaveCount(1); // the hashtag-copying reply is not a cast
    await expect(row.getByLabel('1 like')).toBeVisible({ timeout: 10_000 });
    await expect(row.getByLabel('3 replies')).toBeVisible();

    const detail = page.locator('aside.detail');
    const replies = detail.locator('.cast-replies');
    await expect(replies.getByText('Fran replied from another client')).toBeVisible();
    await expect(replies.locator('.reply-list--nested').getByText('Gus answered Fran')).toBeVisible();
    await expect(replies.getByText('Fran Foreign')).toBeVisible();

    // Like → a NIP-25 reaction on the cast's kind-1 note (found through the article's address).
    const note = NOTE_EVENT;
    // Two bars share one state: the header's, and the one above the replies.
    const likeBtn = detail.locator('.detail-head .btn-detail-like');
    const bottomLike = replies.locator('.cast-replies-bar .btn-detail-like');
    await expect(likeBtn).toBeEnabled({ timeout: 10_000 });
    await likeBtn.click();
    await expect(likeBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(likeBtn).toHaveText('2');
    await expect(bottomLike).toHaveAttribute('aria-pressed', 'true');
    await expect(bottomLike).toHaveText('2');
    await expect.poll(() => published.filter((e) => e.kind === 7).length).toBe(1);
    const reaction = published.find((e) => e.kind === 7)!;
    expect(reaction.pubkey).toBe(ME);
    expect(reaction.tags).toEqual(expect.arrayContaining([['e', note.id, ''], ['p', AUTHOR], ['k', '1']]));
    await expect(row.getByLabel('2 likes')).toBeVisible();
    await detail.locator('.detail-head').screenshot({ path: 'test-output/engagement-liked-head.png' });
    await row.screenshot({ path: 'test-output/engagement-liked-row.png' });

    // Unlike from the bottom bar → a NIP-09 deletion of that reaction.
    await bottomLike.click();
    await expect(bottomLike).toHaveAttribute('aria-pressed', 'false');
    await expect(likeBtn).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => published.filter((e) => e.kind === 5).length).toBe(1);
    expect(published.find((e) => e.kind === 5)!.tags).toContainEqual(['e', reaction.id]);
    await expect(row.getByLabel('1 like')).toBeVisible();

    // Top-level reply.
    const box = replies.getByPlaceholder('Write a reply…');
    await box.fill('Replying from Wirthy');
    await box.press('Control+Enter');
    await expect(replies.locator('.reply-text', { hasText: 'Replying from Wirthy' })).toBeVisible();
    const top = published.find((e) => e.kind === 1 && e.content === 'Replying from Wirthy')!;
    expect(top.tags).toContainEqual(['e', note.id, '', 'root', AUTHOR]);
    expect(top.tags.some((t) => t[0] === 't')).toBe(false);

    // Reply to Fran's reply.
    const franReply = replies.locator('li.reply', { hasText: 'Fran replied from another client' }).first();
    await franReply.locator(':scope > .reply-action').click();
    const inline = franReply.getByLabel(/^Reply to /);
    await inline.fill('Nested from Wirthy');
    await inline.press('Control+Enter');
    await expect(franReply.locator('.reply-list--nested').getByText('Nested from Wirthy')).toBeVisible();
    const nested = published.find((e) => e.content === 'Nested from Wirthy')!;
    const r1 = FRAN_REPLY;
    expect(nested.tags).toEqual(expect.arrayContaining([['e', note.id, '', 'root', AUTHOR], ['e', r1.id, '', 'reply', r1.pubkey]]));
    await expect(row.getByLabel('5 replies')).toBeVisible();
    await expect(page.locator('article.clip')).toHaveCount(1); // our replies aren't casts either

    await detail.screenshot({ path: 'test-output/engagement-detail.png' });
  });

  // Reopening the tab restores the identity as read-only (no ?signin=1, no wallet prompt);
  // with a wallet on the page it must still be able to reply.
  test('a reopened tab with a saved identity can reply without signing in again', async ({ page }) => {
    test.setTimeout(60_000);
    await page.addInitScript((pk) => {
      try {
        localStorage.setItem('wirthy.relayMode', 'production');
        localStorage.setItem('wirthy.seenHero', '1');
        localStorage.setItem('wirthy.auth', pk);
      } catch { /* ignore */ }
    }, ME);
    await useWallet(page);
    const { published } = await mockRelay(page);
    await page.goto('/explore');

    const replies = page.locator('aside.detail .cast-replies');
    const box = replies.getByPlaceholder('Write a reply…');
    await expect(box).toBeVisible({ timeout: 15_000 });
    await box.fill('Reply after reopening');
    // Enabled once the cast's note has been found on the relays.
    await expect(replies.getByRole('button', { name: 'Reply', exact: true }).first()).toBeEnabled({ timeout: 10_000 });
    await box.press('Control+Enter');
    await expect(replies.locator('.reply-text', { hasText: 'Reply after reopening' })).toBeVisible();
    expect(published.find((e) => e.content === 'Reply after reopening')?.pubkey).toBe(ME);
  });

  test('a reply from another client appears while the page is open', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('wirthy.relayMode', 'production');
        localStorage.setItem('wirthy.seenHero', '1');
      } catch { /* ignore */ }
    });
    const { deliver } = await mockRelay(page);
    await page.goto('/explore');
    const row = page.locator('article.clip', { hasText: 'Engagement Test Cast' });
    await expect(row.getByLabel('3 replies')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(2_000); // let the note-id widening settle, as on a real page

    deliver(sign(franSk, { kind: 1, tags: [['e', NOTE_EVENT.id, '', 'root', AUTHOR], ['p', AUTHOR]], content: 'Posted live from Primal', created_at: now() }));
    await expect(page.locator('aside.detail .cast-replies').getByText('Posted live from Primal')).toBeVisible({ timeout: 10_000 });
    await expect(row.getByLabel('4 replies')).toBeVisible();
  });

  test('a session without a wallet sees engagement and a sign-in hint', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('wirthy.relayMode', 'production');
        localStorage.setItem('wirthy.seenHero', '1');
      } catch { /* ignore */ }
    });
    await mockRelay(page);
    await page.goto('/explore');
    const detail = page.locator('aside.detail');
    await expect(detail.getByText('Fran replied from another client')).toBeVisible({ timeout: 15_000 });
    await expect(detail.getByText(/Sign in with a Nostr signing extension/)).toBeVisible();
    await expect(detail.getByPlaceholder('Write a reply…')).toHaveCount(0);
    await expect(detail.locator('.btn-detail-delete')).toHaveCount(0);
    await detail.screenshot({ path: 'test-output/engagement-signed-out.png' });
  });
});
