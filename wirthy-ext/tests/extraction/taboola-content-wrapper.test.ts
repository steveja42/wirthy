// interestingengineering.com wraps its whole story body in
// `<div id="taboola-article-content">` (Taboola's in-article placement anchor).
// SPONSORED_WIDGET_SELECTOR's `[id*="taboola"]` excluded it, so article and
// full-page clips stopped after the hero image. A widget-named element holding
// real paragraphs is content; a teaser grid beside it must still go.

import { describe, it, expect } from 'vitest';
import { captureContext } from '@/content/capture';

const para = (s: string) => `<p>${s} ${'The rover drove across the crater rim while engineers on Earth chose waypoints. '.repeat(3)}</p>`;

function load(): void {
  document.open();
  document.write(`<!doctype html><html><head><title>Rover sets record</title></head><body>
    <main>
      <h1>Perseverance sets a new Mars driving record</h1>
      <figure><img src="https://example.com/hero.jpg" alt="Rover"><figcaption>The rover.</figcaption></figure>
      <div id="taboola-article-content">
        ${para('FIRST-PARA')}
        ${para('SECOND-PARA')}
        <h2>Autonomous driving</h2>
        ${para('LAST-PARA')}
      </div>
      <div id="taboola-below-article-thumbnails">
        <a href="https://ads.example.com/1">Doctors Stunned By This One Trick</a>
        <span>Sponsored</span>
      </div>
    </main>
  </body></html>`);
  document.close();
}

describe('Taboola-named story wrapper', () => {
  for (const format of ['article', 'full-page'] as const) {
    it(`keeps the story body and drops the teaser grid (${format})`, async () => {
      load();
      const cap = await captureContext(format, { smartArticleDetection: false, stripInlineStyles: false });
      const text = cap.bodyText ?? '';
      expect(text).toContain('FIRST-PARA');
      expect(text).toContain('LAST-PARA');
      expect(text).not.toContain('Doctors Stunned');
    });
  }
});
