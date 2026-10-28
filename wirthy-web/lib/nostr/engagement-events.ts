// Event templates for liking (NIP-25), unliking (NIP-09) and replying (NIP-10) to a cast.
// All target the cast's kind-1 NOTE, which is what other clients display. None carries
// ['t','wirthy']: the feed queries `#t wirthy`, so a tagged reply would render as a cast.

import type { EventTemplate } from 'nostr-tools';
import pkg from '@/package.json';

const CLIENT_TAG = ['client', 'wirthy', pkg.version];

function now(): number {
  return Math.floor(Date.now() / 1000);
}

/** The event a reply answers when it is not the cast itself. */
export interface ReplyParent {
  id: string;
  pubkey: string;
  tags: string[][];
}

export function buildReaction(noteId: string, castAuthor: string, relayHint = ''): EventTemplate {
  return {
    kind: 7,
    created_at: now(),
    content: '+',
    tags: [['e', noteId, relayHint], ['p', castAuthor], ['k', '1'], CLIENT_TAG],
  };
}

/** Deletes the given reactions of mine (an unlike). */
export function buildUnlike(reactionIds: string[]): EventTemplate {
  return {
    kind: 5,
    created_at: now(),
    content: '',
    tags: [...reactionIds.map((id) => ['e', id]), ['k', '7'], CLIENT_TAG],
  };
}

export function buildReply(
  noteId: string,
  castAuthor: string,
  text: string,
  myPubkey: string,
  parent: ReplyParent | null = null,
  relayHint = '',
): EventTemplate {
  const tags: string[][] = [['e', noteId, relayHint, 'root', castAuthor]];
  if (parent) tags.push(['e', parent.id, relayHint, 'reply', parent.pubkey]);
  // NIP-10: notify the cast author, the parent's author, and everyone the parent notified.
  const mentioned = [castAuthor, parent?.pubkey, ...(parent?.tags ?? []).filter((t) => t[0] === 'p').map((t) => t[1])];
  const seen = new Set<string>();
  for (const pk of mentioned) {
    if (!pk || pk === myPubkey || seen.has(pk)) continue;
    seen.add(pk);
    tags.push(['p', pk]);
  }
  tags.push(CLIENT_TAG);
  return { kind: 1, created_at: now(), content: text, tags };
}
