// Public-event HTML is attacker-controlled: anyone can publish a #wirthy kind-1
// whose `quote` tag is rendered as the excerpt. These guard the sanitiser and the
// one sink that injects it (DetailPanel), driven from a real signed event.

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { generateSecretKey, finalizeEvent } from 'nostr-tools/pure';
import { sanitizePublicHtml } from '@/lib/sanitize-html';
import { parseEvent } from '@/lib/nostr/parse';
import DetailPanel from '@/components/feed/DetailPanel';

const parse = (html: string) => new DOMParser().parseFromString(`<body>${sanitizePublicHtml(html)}</body>`, 'text/html').body;

describe('sanitizePublicHtml', () => {
  it.each([
    ['<img src="x" onerror="alert(1)">', 'img[onerror]'],
    ['<script>alert(1)</script>', 'script'],
    ['<a href="javascript:alert(1)">x</a>', 'a[href^="javascript"]'],
    ['<iframe src="https://evil.example/"></iframe>', 'iframe'],
    ['<svg><script>alert(1)</script></svg>', 'script'],
    ['<svg onload="alert(1)"></svg>', '[onload]'],
    ['<style>body{display:none}</style>', 'style'],
    ['<div style="position:fixed;inset:0">x</div>', '[style]'],
    ['<form action="https://evil.example/"><input name="password"></form>', 'form, input'],
    ['<img id="currentScript" name="x" src="https://a.example/i.png">', '[id], [name]'],
    ['<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>', '[onerror]'],
  ])('neutralises %s', (html, banned) => {
    expect(parse(html).querySelector(banned)).toBeNull();
  });

  it('keeps the excerpt markup the extension produces', () => {
    const body = parse(
      '<div class="tweet-card tweet-card--native page-modal"><span class="tweet-name">CIA</span>'
      + '<svg class="tweet-badge-verified" viewBox="0 0 22 22"><path d="M1 1"></path></svg>'
      + '<p>Text <strong>bold</strong> <a href="https://example.com/a">link</a></p>'
      + '<img src="data:image/png;base64,iVBORw0KGgo=" alt="Image"></div>',
    );
    expect(body.querySelector('.tweet-card')?.getAttribute('class')).toBe('tweet-card tweet-card--native');
    expect(body.querySelector('svg path')).not.toBeNull();
    expect(body.querySelector('strong')?.textContent).toBe('bold');
    expect(body.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/png/);
  });

  it('opens links safely in a new tab', () => {
    const a = parse('<a href="https://example.com/a" target="_self">x</a>').querySelector('a')!;
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer nofollow ugc');
  });
});

describe('DetailPanel renders a hostile quote tag inert', () => {
  it('sanitises the excerpt of a public kind-1', () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const quote = '<p>hello</p><img src="x" onerror="alert(1)"><a href="javascript:alert(2)">click</a>';
    // Control: unsanitised, the payload carries the handler these selectors look for.
    expect(new DOMParser().parseFromString(quote, 'text/html').querySelector('[onerror]')).not.toBeNull();
    const event = finalizeEvent({
      kind: 1,
      created_at: 1_740_000_000,
      tags: [
        ['t', 'wirthy'],
        ['r', 'https://example.com/a'],
        ['quote', quote],
      ],
      content: 'hello',
    }, generateSecretKey());
    const clip = parseEvent(event);
    const { container } = render(
      <DetailPanel clip={clip} onDelete={() => {}} onUpdateNote={() => {}} bodies={new Map()} onBodyFetched={() => {}} readOnly />,
    );
    const excerpt = container.querySelector('.detail-excerpt')!;
    expect(excerpt.textContent).toContain('hello');
    expect(excerpt.querySelector('[onerror]')).toBeNull();
    expect(excerpt.querySelector('a')?.getAttribute('href') ?? '').not.toMatch(/javascript/i);
    expect(alert).not.toHaveBeenCalled();
  });
});
