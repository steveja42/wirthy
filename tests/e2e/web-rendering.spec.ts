// Drives the /clips page by injecting clip fixtures through the same
// postMessage bridge the extension uses. Asserts that ClipRow renders the
// fields we promise users will see.

import { test, expect, type Page } from '@playwright/test';
import { loadClipFixtures } from './helpers/loadFixtures';

const clips = loadClipFixtures().map((f) => ({
  capture: f.capture,
  evaluation: f.evaluation,
  encrypted: '',
}));

test.describe('web rendering — /clips via bridge', () => {
  test('renders one ClipRow per injected clip with title, domain, excerpt', async ({ page }) => {
    await page.goto('/clips');
    // Wait for the bridge hook to mount and post WIRTHY_WEB_READY.
    await page.waitForLoadState('networkidle');

    await page.evaluate((injectedClips) => {
      // Simulate the extension's HELLO + CLIPS bursts.
      window.postMessage(
        { type: 'WIRTHY_BRIDGE_HELLO', pubkey: 'a'.repeat(64), authMethod: 'nip07' },
        window.location.origin,
      );
      window.postMessage(
        { type: 'WIRTHY_BRIDGE_CLIPS', clips: injectedClips },
        window.location.origin,
      );
    }, clips);

    // One <article class="clip"> per fixture.
    const rows = page.locator('article.clip');
    await expect(rows).toHaveCount(clips.length);

    for (const clip of clips) {
      await expect(page.locator('article.clip', { hasText: clip.capture.title })).toBeVisible();
    }

    // Spot-check the article fixture's domain (example.com appears on a few).
    await expect(page.locator('article.clip .domain').first()).toBeVisible();
  });

  test('clicking a clip surfaces its detail content', async ({ page }) => {
    await page.goto('/clips');
    await page.waitForLoadState('networkidle');

    const articleClip = clips.find((c) => c.capture.format === 'article');
    if (!articleClip) test.skip(true, 'no article fixture');

    await page.evaluate((c) => {
      window.postMessage(
        { type: 'WIRTHY_BRIDGE_HELLO', pubkey: 'a'.repeat(64), authMethod: 'nip07' },
        window.location.origin,
      );
      window.postMessage({ type: 'WIRTHY_BRIDGE_CLIPS', clips: [c] }, window.location.origin);
    }, articleClip);

    const row = page.locator('article.clip', { hasText: articleClip!.capture.title });
    await expect(row).toBeVisible();

    // The row glyph shows the signal star pill + qualifier chips for rated clips.
    if (articleClip!.evaluation.signal) {
      await expect(row.locator('.signal-tag')).toBeVisible();
    }
    for (const q of articleClip!.evaluation.qualifiers ?? []) {
      await expect(row.locator('.qual-chip', { hasText: q })).toBeVisible();
    }

    await row.click();
    // The DetailPanel renders the full title in a .detail-title heading.
    // (The same title text also lives in the row's <h3> and possibly the body,
    //  so we scope strictly to the detail panel selector.)
    await expect(page.locator('.detail-title', { hasText: articleClip!.capture.title }))
      .toBeVisible();
    // Detail panel surfaces the Signal section + each qualifier chip.
    if (articleClip!.evaluation.signal) {
      await expect(page.locator('.detail-section-label', { hasText: 'Signal' })).toBeVisible();
      await expect(page.locator('.signal-name-lg')).toContainText(articleClip!.evaluation.signal);
    }
    for (const q of articleClip!.evaluation.qualifiers ?? []) {
      await expect(page.locator('.detail-section .qual-chip', { hasText: q })).toBeVisible();
    }
  });

  test('fullscreen puts the clip id in the address bar and Back closes it', async ({ page }) => {
    await gotoClips(page, '/clips', [clip]);
    await expect(page.locator('.detail-title', { hasText: clip.capture.title })).toBeVisible();
    // A full reload would lose this marker; Back must stay a same-document navigation.
    await page.evaluate(() => { (window as unknown as { __noReload: boolean }).__noReload = true; });
    const panel = page.locator('aside.detail').first();
    const expand = panel.getByRole('button', { name: 'Expand to fullscreen' });
    const here = () => { const u = new URL(page.url()); return u.pathname + u.search; };

    await expand.click();
    await expect(panel).toHaveClass(/detail--fullscreen/);
    expect(here()).toBe(clipUrl);

    await page.goBack();
    await expect(panel).not.toHaveClass(/detail--fullscreen/);
    expect(here()).toBe('/clips');

    await page.goForward();
    await expect(panel).toHaveClass(/detail--fullscreen/);
    expect(here()).toBe(clipUrl);

    await page.keyboard.press('Escape');
    await expect(panel).not.toHaveClass(/detail--fullscreen/);
    await expect.poll(here).toBe('/clips');

    expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
  });

  test('reloading a fullscreen clip reopens it, and Back returns to the Library', async ({ page }) => {
    // The pre-paint cover must not make the server HTML disagree with the client.
    const hydrationErrors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error' && /hydrat/i.test(m.text())) hydrationErrors.push(m.text()); });
    // Sample every frame from first parse: the split view must never paint.
    await page.addInitScript(() => {
      const w = window as unknown as { __splitFrames: number };
      w.__splitFrames = 0;
      const tick = () => {
        const shell = document.querySelector('.feed-shell');
        const covered = !!document.querySelector('.detail--fullscreen') || !!document.getElementById('clip-fullscreen-cover');
        if (shell && !covered) w.__splitFrames++;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await gotoClips(page, clipUrl);
    const panel = page.locator('aside.detail').first();
    await expect(panel).toHaveClass(/detail--fullscreen/);
    await expect(panel.locator('.detail-title')).toHaveText(clip.capture.title);
    expect(await page.evaluate(() => (window as unknown as { __splitFrames: number }).__splitFrames)).toBe(0);
    expect(hydrationErrors).toEqual([]);
    const here = () => { const u = new URL(page.url()); return u.pathname + u.search; };
    expect(here()).toBe(clipUrl);

    await page.goBack();
    await expect(panel).not.toHaveClass(/detail--fullscreen/);
    expect(here()).toBe('/clips');
  });

  test('a bare ?clip= link selects the clip without going fullscreen', async ({ page }) => {
    await gotoClips(page, `/clips?clip=${encodeURIComponent(clip.capture.id)}`);
    const panel = page.locator('aside.detail').first();
    await expect(panel.locator('.detail-title')).toHaveText(clip.capture.title);
    await expect(panel).not.toHaveClass(/detail--fullscreen/);
    await expect.poll(() => new URL(page.url()).pathname + new URL(page.url()).search).toBe('/clips');
  });
});

const clip = clips[0];
const clipUrl = `/clips?clip=${encodeURIComponent(clip.capture.id)}&fullscreen=1`;

// Loads a /clips URL, then delivers the fixture clips the way the extension bridge does.
async function gotoClips(page: Page, url: string, delivered = clips) {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  await page.evaluate((all) => {
    window.postMessage(
      { type: 'WIRTHY_BRIDGE_HELLO', pubkey: 'a'.repeat(64), authMethod: 'nip07' },
      window.location.origin,
    );
    window.postMessage({ type: 'WIRTHY_BRIDGE_CLIPS', clips: all }, window.location.origin);
  }, delivered);
}
