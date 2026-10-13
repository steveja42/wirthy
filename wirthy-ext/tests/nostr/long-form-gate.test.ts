// longFormReason decides whether a cast also publishes a kind-30023. A flat
// social post is fully carried by its kind-1, and as a long-form it only
// clutters NIP-23 readers; anything the plain-text kind-1 would lose keeps it.
// The flat shapes below mirror real captures (x.com status, Facebook post).
import { describe, it, expect } from 'vitest';
import { longFormReason } from '@/content/html-to-markdown';
import { htmlToQuoteText } from '@/shared/nostr/events';

const PHOTO = 'https://pbs.twimg.com/media/HIUNHegXwAAVKkB?format=webp&name=medium';
const TWEET_URL = 'https://x.com/CIA/status/2055074954375254084';

function tweet(text: string, extra = ''): string {
  return `<div class="tweet-card tweet-card--native">
    <div class="tweet-header"><img class="tweet-avatar" src="https://pbs.twimg.com/profile_images/1/a_normal.jpg" alt="CIA" width="48" height="48">
      <div class="tweet-author"><span class="tweet-name">CIA</span><span class="tweet-handle">@CIA</span></div></div>
    <div class="tweet-text">${text}</div>
    <div class="tweet-photo-grid"><div class="tweet-photo"><img src="${PHOTO.replace(/&/g, '&amp;')}" alt="Image" data-dx-src="${PHOTO.replace(/&/g, '&amp;')}"></div></div>
    ${extra}
    <div class="tweet-footer"><a class="tweet-date" href="${TWEET_URL}">11:57 PM · May 14, 2026</a><span class="tweet-stat" aria-label="Like"><span class="tweet-stat-count">43398</span></span></div>
  </div>`;
}
const tweetBody = (text: string) => `CIA @CIA\n\n${text}\n\n${PHOTO}\n\n❤️ 43398  ·  11:57 PM · May 14, 2026`;
const tweetInput = (html: string, text: string) =>
  ({ html, title: 'CIA on X: "Havana, Cuba"', url: TWEET_URL, bodyText: tweetBody(text), imageUrls: [PHOTO] });

describe('longFormReason — flat posts skip the long-form', () => {
  it('a text + photo tweet: byline bold and stats line are card chrome, not structure', () => {
    expect(longFormReason(tweetInput(tweet('<span>Havana, Cuba</span>'), 'Havana, Cuba'))).toBeNull();
  });

  it('a Facebook text post with a hashtag link and a counts row', () => {
    const html = `<div class="dx-post"><div class="dx-header"><a href="https://www.facebook.com/ezemba"><b>Ezemba Fitness Page</b></a></div>
      <div>Best full body workout 💪🏾 <a href="https://www.facebook.com/hashtag/viral">#viral</a></div>
      <div class="dx-stats"><span>12</span><span>3</span></div></div>`;
    expect(longFormReason({
      html, title: '(1) Facebook', url: 'https://www.facebook.com/ezemba/posts/1',
      bodyText: 'Ezemba Fitness Page\n\nBest full body workout 💪🏾 #viral',
    })).toBeNull();
  });

  it('a heading that only repeats the title', () => {
    expect(longFormReason({ html: '<h1>Short note</h1><p>One line.</p>', title: 'Short note', url: 'https://a.example/', bodyText: 'Short note\n\nOne line.' })).toBeNull();
  });

  it('a bare URL link, which every client autolinks', () => {
    const html = '<p>See <a href="https://example.com/a">https://example.com/a</a></p>';
    expect(longFormReason({ html, title: 't', url: 'https://a.example/', bodyText: 'See https://example.com/a' })).toBeNull();
  });

  it('a <br> where bodyText kept the line break', () => {
    expect(longFormReason(tweetInput(tweet('<span>Line one<br>Line two</span>'), 'Line one\nLine two'))).toBeNull();
  });

  it('a plain one-paragraph selection', () => {
    expect(longFormReason({ html: '<p>The pleasure of a sentence.</p>', title: 't', url: 'https://a.example/' })).toBeNull();
  });
});

describe('longFormReason — anything the kind-1 would lose keeps it', () => {
  const article = (html: string, bodyText: string) => ({ html, title: 'Title', url: 'https://a.example/post', bodyText });

  it('a video play card (click-to-play needs the markdown link)', () => {
    const card = `<a class="tweet-video" href="${TWEET_URL}"><img src="https://pbs.twimg.com/poster.jpg"></a>`;
    expect(longFormReason(tweetInput(tweet('<span>Havana</span>', card), 'Havana'))).toBe('video');
  });

  it('reply cards', () => {
    expect(longFormReason(tweetInput(tweet('<span>Havana</span>', '<div class="tweet-reply">r</div>'), 'Havana'))).toBe('replies');
  });

  it('an embedded post card, which bodyText omits', () => {
    expect(longFormReason(article('<p>Body.</p><div class="tweet-card tweet-card--embed">quoted</div>', 'Body.'))).toBe('embedded post');
  });

  it('a prose link with anchor text', () => {
    expect(longFormReason(article('<p>Read <a href="https://b.example/study">the study</a>.</p>', 'Read the study.'))).toBe('link');
  });

  it('a truncated display URL (the text is not the link)', () => {
    const html = '<span>Look <a href="https://t.co/abc">nytimes.com/2026/10/1…</a></span>';
    expect(longFormReason(tweetInput(tweet(html), 'Look nytimes.com/2026/10/1…'))).toBe('link');
  });

  it('a stats row that is really a content list', () => {
    const html = '<p>Album</p><div class="dx-stats"><a href="https://open.example/t/1">On the Run</a><span>3:36</span></div>';
    expect(longFormReason(article(html, 'Album'))).toBe('link');
  });

  it.each([
    ['<h2>Section</h2><p>x</p>', 'heading'],
    ['<blockquote>q</blockquote>', 'quote'],
    ['<ul><li>a</li></ul>', 'list'],
    ['<pre>code</pre>', 'code'],
    ['<table><tr><td>a</td><td>b</td></tr></table>', 'table'],
    ['<p>a</p><hr><p>b</p>', 'rule'],
    ['<p>so <em>very</em> good</p>', 'emphasis'],
  ])('%s → %s', (html, reason) => {
    expect(longFormReason(article(html, 'Section x q a code a b so very good'))).toBe(reason);
  });

  it('a <br> that bodyText collapsed', () => {
    expect(longFormReason(article('<p>Roses are red<br>violets are blue</p>', 'Roses are red violets are blue'))).toBe('line breaks');
  });

  it('an image the kind-1 does not carry', () => {
    const html = '<p>x</p><img src="https://a.example/photo.jpg" width="600" height="400">';
    expect(longFormReason({ ...article(html, 'x'), imageUrls: [] })).toBe('images');
  });

  it('text that bodyText left out (proseText skips bare <div> text)', () => {
    const html = '<p>Lead.</p><div>A whole second passage that only lives in a div and never reached the prose text.</div>';
    expect(longFormReason(article(html, 'Lead.'))).toBe('text missing from note');
  });

  it('footer counts the note omits (the long-form prints them)', () => {
    const html = tweet('<span>Havana, Cuba</span>').replace('</div>\n  </div>', '<span class="tweet-date">4.1M Views</span></div>\n  </div>');
    expect(longFormReason(tweetInput(html, 'Havana, Cuba'))).toBe('text missing from note');
  });

  it('a quoted post card (bodyText has it only as "> " lines)', () => {
    const html = tweet('<span>Look</span>', '<div class="tweet-quote"><div class="tweet-text">older post</div></div>');
    expect(longFormReason(tweetInput(html, 'Look\n\n> older post'))).toBe('quote');
  });

  it('a body the kind-1 would truncate', () => {
    expect(longFormReason(article('<p>x</p>', 'x'.repeat(8001)))).toBe('size');
  });

  it('a selection with structure', () => {
    expect(longFormReason({ html: '<ul><li>one</li></ul>', title: 't', url: 'https://a.example/' })).toBe('list');
  });
});

describe('htmlToQuoteText — the kind-1 quote line is plain text', () => {
  it('drops tags, decodes entities, keeps paragraph breaks', () => {
    expect(htmlToQuoteText('<p>a &amp; b&#39;s</p><p>c<br>d</p>')).toBe("a & b's\n\nc\nd");
  });

  it('separates adjacent inline leaves and drops svg', () => {
    const html = '<span class="tweet-name">CIA<svg><title>Verified</title><path d="M1"/></svg></span><span class="tweet-handle">@CIA</span>';
    expect(htmlToQuoteText(html)).toBe('CIA @CIA');
  });
});
