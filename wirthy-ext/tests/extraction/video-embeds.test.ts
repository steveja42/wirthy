// Guards the generic video-embed substitution (substituteVideoEmbeds).
//
// Real-world defect (primal.net note nevent1qqsxc60eds…): the note's only media
// was an <iframe src="youtube.com/embed/OSW2zeM3yLU">. There is no <video>
// element on the page at all — so substituteVideosWithPosters' <video> and
// background-image passes never saw it — and sanitiseTreeInPlace strips every
// iframe outright. The video block therefore vanished from the clip with no
// poster and no link.
//
// The fix is generic, not a primal tagger: any site embedding a player
// (Substack, WordPress, news articles, Nostr clients) hits the same shape. The
// pass runs on all five capture paths, AFTER substituteEmbeddedTweets so
// platform.twitter.com iframes stay on the richer tweet-card path.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { captureContext } from '@/content/capture';
import { loadFixture } from '../helpers/loadFixture';

const URL_ = 'https://example.com/post/video-embeds';
const ODYSEE_LBRY = 'lbry://@corbettreport#0/solutionswatch-unvandalism#1';
const ODYSEE_THUMB = 'https://thumbs.odycdn.com/7a035214b2d2fcbb0b291abeb877f267.webp';

describe('video embed substitution', () => {
  // Odysee's resolve API, shaped as measured; the lookup must never reach the network.
  let odyseeBodies: string[] = [];
  beforeEach(() => {
    odyseeBodies = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      odyseeBodies.push(String(init?.body ?? ''));
      return new Response(JSON.stringify({ result: { [ODYSEE_LBRY]: { value: { thumbnail: { url: ODYSEE_THUMB } } } } }));
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  for (const smartArticleDetection of [false, true]) {
    describe(`smartArticleDetection=${smartArticleDetection}`, () => {
      const capture = async () => {
        loadFixture('video-embeds.html', URL_);
        return captureContext('article', { smartArticleDetection, stripInlineStyles: false });
      };

      it('renders a YouTube embed as a poster card, not nothing', async () => {
        const html = (await capture()).bodyHtml ?? '';
        // The poster <img> is the whole point of the fix. Assert on
        // data-dx-src: inlineAllImages rewrites `src` to base64 (a 1px stub
        // under the jsdom fetch shim), while data-dx-src preserves the real
        // URL — which is also what keeps the poster in the cast markdown,
        // since htmlToMarkdown refuses data: URIs.
        expect(html, 'youtube poster img').toContain('i.ytimg.com/vi/OSW2zeM3yLU/mqdefault.jpg');
        expect(html, 'poster card class').toContain('tweet-video-poster');
        // Links to the canonical watch URL so the clip stays clickable.
        expect(html, 'watch link').toContain('https://www.youtube.com/watch?v=OSW2zeM3yLU');
      });

      it('handles the youtube-nocookie variant', async () => {
        const html = (await capture()).bodyHtml ?? '';
        expect(html, 'watch link').toContain('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
        expect(html, 'card built').toContain('tweet-video');
      });

      it('keeps one poster per distinct video', async () => {
        // Every YouTube poster shares its alt and the "mqdefault" filename, so
        // both image-dedup passes used to treat different videos as one photo —
        // an XDA reply's video vanished from its clip.
        const html = (await capture()).bodyHtml ?? '';
        for (const id of ['OSW2zeM3yLU', 'dQw4w9WgXcQ', 'jNQXAC9IVRw']) {
          expect(html, `poster for ${id}`).toContain(`i.ytimg.com/vi/${id}/mqdefault.jpg`);
        }
      });

      it('degrades thumbnail-less providers to a link card', async () => {
        const html = (await capture()).bodyHtml ?? '';
        expect(html, 'vimeo link').toContain('https://vimeo.com/76979871');
        expect(html, 'vimeo label').toContain('Vimeo video');
        expect(html, 'rumble label').toContain('Rumble video');
        expect(html, 'twitch label').toContain('Twitch video');
        expect(html, 'link card class').toContain('dx-video-link');
      });

      it('builds an Odysee poster card from a percent-encoded embed src', async () => {
        // corbettreport.com: `/%24/embed/…` never matched `/$/embed/`, so the
        // iframe was stripped and the clip had neither poster nor player.
        const html = (await capture()).bodyHtml ?? '';
        expect(odyseeBodies.some(b => b.includes(ODYSEE_LBRY)), 'resolve request').toBe(true);
        expect(html, 'odysee poster').toContain(`data-dx-src="${ODYSEE_THUMB}"`);
        expect(html, 'watch-page link').toContain('href="https://odysee.com/@corbettreport:0/solutionswatch-unvandalism:1"');
        // The iframe sits in a <p>; a card left there splits in two when re-parsed.
        expect(html.match(/href="https:\/\/odysee\.com\/@corbettreport/g)?.length, 'one card').toBe(1);
      });

      it('resolves a Facebook plugins.video.php embed to its canonical URL', async () => {
        const html = (await capture()).bodyHtml ?? '';
        // No derivable thumbnail (unlike YouTube's predictable i.ytimg.com
        // path), so this is a link card — but it must decode the href= query
        // param back to the plain facebook.com watch URL, not leave the
        // %-encoded plugin URL or drop the embed entirely.
        expect(html, 'facebook canonical link').toContain('https://www.facebook.com/somepage/videos/1234567890/');
        expect(html, 'facebook label').toContain('Facebook video');
      });

      it('still strips unrecognised iframes and leaves no iframe behind', async () => {
        const html = (await capture()).bodyHtml ?? '';
        expect(html, 'no iframes survive sanitisation').not.toContain('<iframe');
        expect(html, 'ad slot dropped').not.toContain('ads.example.com');
      });

      it('keeps the surrounding prose intact', async () => {
        const cap = await capture();
        const text = cap.bodyText ?? '';
        expect(text).toContain('RIP');
        expect(text).toContain('embedded player');
      });
    });
  }
});
