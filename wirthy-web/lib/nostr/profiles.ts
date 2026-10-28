// Nostr kind:0 profile subscription for the authors appearing in the public feed.
// Fetches each author's profile metadata (name / nip05), emits the profiles as they
// arrive, then asynchronously verifies any nip05 against the domain's
// /.well-known/nostr.json (NIP-05) and re-emits with `verified: true` on success.
// Modelled on subscribeFollowList; returns a cleanup function mirroring its teardown.

import { SimplePool, type Event, type Filter } from 'nostr-tools';
import { npubEncode } from 'nostr-tools/nip19';
import { isNip05, isValid, type Nip05 } from 'nostr-tools/nip05';
import { getActiveRelays } from '@/lib/constants';
import { LL, log } from '@/lib/logger';

export interface AuthorProfile {
  pubkey: string;
  name?: string;
  nip05?: string;
  picture?: string;
  verified?: boolean;
}

// Cache nip05-verification results across feed refreshes / re-subscriptions so we
// never re-hit the same /.well-known/nostr.json for an author we've already checked.
// Key is `${pubkey}|${nip05}` — verification is pubkey-specific.
const verifyCache = new Map<string, boolean>();

function parseProfileContent(content: string): { name?: string; nip05?: string; picture?: string } {
  try {
    const meta = JSON.parse(content) as { name?: string; display_name?: string; nip05?: string; picture?: string };
    const picture = typeof meta.picture === 'string' && /^https:\/\//i.test(meta.picture) ? meta.picture : undefined;
    return { name: meta.display_name || meta.name, nip05: meta.nip05, picture };
  } catch {
    return {};
  }
}

// The user-facing label for an author: a *verified* nip05 if present, otherwise a
// slice of the npub (never raw hex). Shared by ClipRow and DetailPanel.
export function authorLabel(pubkey: string, profile?: AuthorProfile): string {
  if (profile?.verified && profile.nip05) return profile.nip05;
  try { return `${npubEncode(pubkey).slice(0, 12)}…`; } catch { return pubkey.slice(0, 12); }
}

// Kind-0 is replaceable, but some relays (relay.ditto.pub) still serve every old version,
// in any order. True only for an event newer than the last one seen from its author.
export function isNewestReplaceable(seen: Map<string, number>, e: Event): boolean {
  if (e.created_at <= (seen.get(e.pubkey) ?? -1)) return false;
  seen.set(e.pubkey, e.created_at);
  return true;
}

// NIP-05's root identifier `_@domain` is conventionally shown as just the domain.
export function nip05DisplayName(nip05: string): string {
  return nip05.startsWith('_@') ? nip05.slice(2) : nip05;
}

// Like authorLabel, but also accepts an unverified kind-0 display name. Used by the
// Publishers filter list, where a self-declared name is a better handle for picking
// someone out of a list than a truncated npub — the stricter authorLabel stays the
// rule for attribution shown on a cast itself.
export function authorDisplayName(pubkey: string, profile?: AuthorProfile): string {
  if (profile?.verified && profile.nip05) return profile.nip05;
  const name = profile?.name?.trim();
  if (name) return name;
  return authorLabel(pubkey, profile);
}

export function subscribeAuthorProfiles(
  pubkeys: string[],
  onUpdate: (profiles: Map<string, AuthorProfile>) => void,
  relayUrls: string[] = getActiveRelays(),
): () => void {
  const pool = new SimplePool();
  const relays = [...relayUrls];
  log(LL.NORMAL, '[nostr] subscribeAuthorProfiles connecting to', relays, 'for', pubkeys.length, 'author(s)');
  let closed = false;

  const profiles = new Map<string, AuthorProfile>();
  const newest = new Map<string, number>();

  const emit = () => {
    if (closed) return;
    onUpdate(new Map(profiles));
  };

  // Confirm a profile's nip05 against its domain, then mark verified and re-emit.
  const verify = (pubkey: string, nip05: string) => {
    if (!isNip05(nip05)) return;
    const cacheKey = `${pubkey}|${nip05}`;
    const cached = verifyCache.get(cacheKey);
    if (cached !== undefined) {
      if (cached) markVerified(pubkey, nip05);
      return;
    }
    isValid(pubkey, nip05 as Nip05)
      .then((ok) => {
        verifyCache.set(cacheKey, ok);
        if (ok) markVerified(pubkey, nip05);
      })
      .catch(() => { verifyCache.set(cacheKey, false); });
  };

  // Only flip verified if the stored profile still claims this same nip05.
  const markVerified = (pubkey: string, nip05: string) => {
    if (closed) return;
    const current = profiles.get(pubkey);
    if (!current || current.nip05 !== nip05) return;
    profiles.set(pubkey, { ...current, verified: true });
    emit();
  };

  const filter: Filter = { kinds: [0], authors: pubkeys };
  const sub = pool.subscribeMany(relays, filter, {
    onevent: (e: Event) => {
      if (closed || !isNewestReplaceable(newest, e)) return;
      const meta = parseProfileContent(e.content);
      profiles.set(e.pubkey, { pubkey: e.pubkey, ...meta });
      emit();
      if (meta.nip05) verify(e.pubkey, meta.nip05);
    },
    oneose: () => { /* keep open for late / updated profiles */ },
  });

  return () => {
    if (closed) return;
    closed = true;
    sub.close();
    pool.destroy();
  };
}
