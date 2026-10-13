// The author identity the share-page function embeds in /c and /p pages (already
// NIP-05-verified server-side), so the byline shows the NIP-05 from first paint instead of
// an npub until the client's own kind-0 fetch + nostr.json check finish (~5s measured).

import type { AuthorProfile } from '@/lib/nostr/profiles';

export const SSR_AUTHOR_ID = 'ssr-author';

/** The embedded author, or null when absent or malformed. Call only in the browser. */
export function readSsrAuthor(): AuthorProfile | null {
  try {
    const raw = document.getElementById(SSR_AUTHOR_ID)?.textContent;
    if (!raw) return null;
    const a = JSON.parse(raw) as Partial<AuthorProfile>;
    if (typeof a.pubkey !== 'string' || !/^[0-9a-f]{64}$/.test(a.pubkey)) return null;
    return {
      pubkey: a.pubkey,
      name: typeof a.name === 'string' ? a.name : undefined,
      nip05: typeof a.nip05 === 'string' ? a.nip05 : undefined,
      verified: a.verified === true,
    };
  } catch {
    return null;
  }
}

/** `live` with the embedded author filled in until the live profile is itself verified. */
export function withSsrAuthor(live: Map<string, AuthorProfile>, ssr: AuthorProfile | null): Map<string, AuthorProfile> {
  if (!ssr) return live;
  const current = live.get(ssr.pubkey);
  if (current?.verified) return live;
  const merged = new Map(live);
  merged.set(ssr.pubkey, ssr.verified ? { ...current, ...ssr } : current ?? ssr);
  return merged;
}
