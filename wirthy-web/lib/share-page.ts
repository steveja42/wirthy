// Crawler-visible metadata for the share pages (/c/<id>, /p/<npub>), injected into the
// exported static shell by netlify/functions/share-page.mts. Pure string work so it is
// unit-tested directly; the function only does the I/O around it.
//
// EVERYTHING interpolated here comes from a Nostr event — untrusted user input — so every
// value goes through escapeHtml (attributes and text alike) and JSON-LD escapes `<`.
//
// Indexing policy: a cast page is indexable only when the publisher added a take (a note
// or a Signal rating), and never for the e2e test author. The body summary carries their
// contribution plus a short excerpt — never the captured article itself, which is someone
// else's content and would read as scraped. Publisher pages are previews only (noindex).

import { npubEncode } from 'nostr-tools/nip19';
import { SIGNAL_LEVELS, CATEGORIES } from '@/lib/constants';
import type { ClipData } from '@/lib/types';
import type { PublisherProfile } from '@/lib/nostr/cast-ref';

export const SITE = 'https://wirthy.app';
export const DEFAULT_OG_IMAGE = `${SITE}/og/default.png`;
const DESCRIPTION_MAX = 200;
const EXCERPT_MAX = 300;

export interface ShareMeta {
  title: string;
  description: string;
  canonical: string;
  image: string;
  ogType: 'article' | 'profile';
  index: boolean;
  /** Pre-escaped HTML for the #ssr-cast placeholder ('' leaves it empty). */
  bodyHtml: string;
  jsonLd?: Record<string, unknown>;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncate(s: string, max: number): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function httpUrl(u: string | null | undefined): string | undefined {
  return u && /^https:\/\//i.test(u) ? u : undefined;
}

export function shortNpub(pubkey: string): string {
  try { return `${npubEncode(pubkey).slice(0, 12)}…`; } catch { return 'someone'; }
}

/** Plain-text excerpt from the cast's own summary fields — never the captured body markdown. */
function excerptOf(clip: ClipData): string {
  const c = clip.capture;
  return truncate(c.summary ?? c.selectionText ?? c.bodyText ?? '', EXCERPT_MAX);
}

export interface CastShareInput {
  clip: ClipData;
  canonicalPath: string;
  authorName?: string;
  isTestAuthor: boolean;
}

export function castShareMeta({ clip, canonicalPath, authorName, isTestAuthor }: CastShareInput): ShareMeta {
  const { capture, evaluation } = clip;
  const signal = evaluation.signal;
  const note = capture.note?.trim();
  const by = authorName ?? (capture.authorPubkey ? shortNpub(capture.authorPubkey) : 'someone');
  const category = CATEGORIES[evaluation.category]?.label ?? evaluation.category;
  const excerpt = excerptOf(clip);
  const canonical = `${SITE}${canonicalPath}`;
  const description = truncate(note || excerpt || `A post by ${by} on Wirthy.`, DESCRIPTION_MAX);
  const date = new Date(capture.timestamp);
  let domain = '';
  try { domain = new URL(capture.url).hostname.replace(/^www\./, ''); } catch { /* no source url */ }

  const rating = [signal ? `Rated <strong>${escapeHtml(signal)}</strong>` : null, escapeHtml(category),
    ...(evaluation.qualifiers ?? []).map(escapeHtml)].filter(Boolean).join(' · ');
  const source = capture.url && /^https?:\/\//i.test(capture.url)
    ? `<p><a href="${escapeHtml(capture.url)}" rel="nofollow ugc noopener">Read the original${domain ? ` at ${escapeHtml(domain)}` : ''}</a></p>`
    : '';
  const bodyHtml = [
    '<article>',
    `<h1>${escapeHtml(capture.title)}</h1>`,
    `<p>${rating}</p>`,
    `<p>Posted by ${escapeHtml(by)} on <time datetime="${date.toISOString()}">${escapeHtml(date.toDateString())}</time></p>`,
    note ? `<blockquote>${escapeHtml(note)}</blockquote>` : '',
    excerpt ? `<p>${escapeHtml(excerpt)}</p>` : '',
    source,
    '</article>',
  ].join('');

  const rank = signal ? SIGNAL_LEVELS.indexOf(signal) + 1 : 0;
  const jsonLd = rank > 0 ? {
    '@context': 'https://schema.org',
    '@type': 'Review',
    name: capture.title,
    url: canonical,
    datePublished: date.toISOString(),
    itemReviewed: { '@type': 'CreativeWork', name: capture.title, ...(capture.url ? { url: capture.url } : {}) },
    reviewRating: { '@type': 'Rating', ratingValue: rank, bestRating: 5, worstRating: 1, name: signal },
    author: { '@type': 'Person', name: by },
    ...(note ? { reviewBody: note } : {}),
  } : undefined;

  return {
    title: `${capture.title}${signal ? ` · ${signal}` : ''} — Wirthy`,
    description,
    canonical,
    image: httpUrl(capture.thumbnail) ?? httpUrl(capture.imageUrls?.[0]) ?? DEFAULT_OG_IMAGE,
    ogType: 'article',
    index: Boolean(note || signal) && !isTestAuthor,
    bodyHtml,
    jsonLd,
  };
}

export function publisherShareMeta(pubkey: string, profile: PublisherProfile | null): ShareMeta {
  const name = profile?.name ?? shortNpub(pubkey);
  return {
    title: `Posts by ${name} — Wirthy`,
    description: truncate(profile?.about || `Posts ${name} clipped, rated and published with Wirthy.`, DESCRIPTION_MAX),
    canonical: `${SITE}/p/${npubEncode(pubkey)}`,
    image: httpUrl(profile?.picture) ?? DEFAULT_OG_IMAGE,
    ogType: 'profile',
    index: false,
    bodyHtml: '',
  };
}

// Tags Next emits from the layout/page metadata that the injected block replaces.
const REPLACED_TAGS = [
  /<title>[\s\S]*?<\/title>/g,
  /<meta name="(?:description|robots)"[^>]*>/g,
  /<meta property="og:[^"]*"[^>]*>/g,
  /<meta name="twitter:[^"]*"[^>]*>/g,
  /<link rel="canonical"[^>]*>/g,
];

export function injectShareMeta(shell: string, meta: ShareMeta): string {
  const attr = escapeHtml;
  const tags = [
    `<title>${escapeHtml(meta.title)}</title>`,
    `<meta name="description" content="${attr(meta.description)}"/>`,
    `<meta name="robots" content="${meta.index ? 'index, follow' : 'noindex, follow'}"/>`,
    `<link rel="canonical" href="${attr(meta.canonical)}"/>`,
    `<meta property="og:title" content="${attr(meta.title)}"/>`,
    `<meta property="og:description" content="${attr(meta.description)}"/>`,
    `<meta property="og:url" content="${attr(meta.canonical)}"/>`,
    `<meta property="og:site_name" content="Wirthy"/>`,
    `<meta property="og:type" content="${meta.ogType}"/>`,
    `<meta property="og:image" content="${attr(meta.image)}"/>`,
    `<meta name="twitter:card" content="${meta.image === DEFAULT_OG_IMAGE ? 'summary_large_image' : 'summary'}"/>`,
    `<meta name="twitter:title" content="${attr(meta.title)}"/>`,
    `<meta name="twitter:description" content="${attr(meta.description)}"/>`,
    `<meta name="twitter:image" content="${attr(meta.image)}"/>`,
    meta.jsonLd
      ? `<script type="application/ld+json">${JSON.stringify(meta.jsonLd).replace(/</g, '\\u003c')}</script>`
      : '',
  ].join('');

  let html = shell;
  for (const re of REPLACED_TAGS) html = html.replace(re, '');
  // Function replacers: a string replacement would expand `$&` / `$'` found in event text.
  html = html.replace('</head>', () => `${tags}</head>`);
  if (meta.bodyHtml) html = html.replace('<div id="ssr-cast"></div>', () => `<div id="ssr-cast">${meta.bodyHtml}</div>`);
  return html;
}
