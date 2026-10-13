// Sanitiser for HTML that arrives in a PUBLIC Nostr event.
//
// Anyone can publish a #wirthy note, so markup read from a relay (a kind-1's
// `quote` tag) is attacker-controlled and must never reach innerHTML as-is. The
// extension's own capture sanitiser is no protection here: a hostile event never
// went through the extension. Mirrors the extension's output contract — only
// `dx-*` / `tweet-*` class tokens survive — so a cast cannot borrow app classes.

import DOMPurify, { type DOMPurify as DOMPurifyInstance } from 'dompurify';

const TRUSTED_CLASS_PREFIXES = ['dx-', 'tweet-'];

let purifier: DOMPurifyInstance | null = null;

function getPurifier(): DOMPurifyInstance | null {
  if (purifier) return purifier;
  if (typeof window === 'undefined') return null;
  const p = DOMPurify(window);
  if (!p.isSupported) return null;
  p.addHook('uponSanitizeAttribute', (_node, data) => {
    if (data.attrName !== 'class') return;
    data.attrValue = data.attrValue
      .split(/\s+/)
      .filter((t) => TRUSTED_CLASS_PREFIXES.some((pre) => t.startsWith(pre)))
      .join(' ');
    if (!data.attrValue) data.keepAttr = false;
  });
  p.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.hasAttribute('href')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer nofollow ugc');
    }
  });
  purifier = p;
  return p;
}

const CONFIG = {
  // Inline styles and forms enable full-page overlays and fake sign-in boxes;
  // id/name enable DOM clobbering of the app's own globals.
  FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'option', 'dialog', 'template'],
  FORBID_ATTR: ['style', 'id', 'name'],
  ALLOW_DATA_ATTR: false,
};

/**
 * Sanitise public-event HTML for injection. Fails CLOSED: DOMPurify returns its
 * input unchanged when no DOM is available, so without one this returns ''.
 */
export function sanitizePublicHtml(html: string): string {
  const p = getPurifier();
  if (!p) return '';
  return p.sanitize(html, CONFIG);
}
