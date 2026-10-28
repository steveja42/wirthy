// Likes and replies on public casts, from ANY client. Engagement is read as kind-7
// reactions, kind-1 (NIP-10) and kind-1111 (NIP-22) replies, and kind-5 deletions that
// reference a cast's kind-1 note, its kind-30023 article, or the article's
// `30023:<pk>:<d>` address. Pure; the relay subscription lives in engagement-sub.ts.
//
// A feed card merged to its long-form has lost the note's id. The note carries the
// article's `a` tag, so the `#a` filter returns it too; resolveNoteId recognises it.

import type { Event } from 'nostr-tools';
import { parse as parseNip10 } from 'nostr-tools/nip10';
import type { ClipData } from '@/lib/types';

export interface CastTarget {
  /** Stable per cast: a note and its long-form share it (author + article id). */
  key: string;
  authorPubkey: string;
  /** Event ids the card itself carries (the note, or the article). */
  ids: string[];
  /** `30023:<pk>:<d>` when the cast has a long-form companion. */
  coord?: string;
  /** Known up front when the card is the kind-1 note. */
  noteId?: string;
}

export interface ReplyNode {
  event: Event;
  children: ReplyNode[];
}

export interface Engagement {
  /** The kind-1 note likes and replies target; undefined until discovered. */
  noteId?: string;
  likes: number;
  /** My live (undeleted) likes, all of which an unlike deletes. */
  myReactionIds: string[];
  replyCount: number;
  replies: ReplyNode[];
}

export const EMPTY_ENGAGEMENT: Engagement = { likes: 0, myReactionIds: [], replyCount: 0, replies: [] };

export function castTargetOf(clip: ClipData): CastTarget | null {
  const { id, kind, longFormId, authorPubkey } = clip.capture;
  if (!authorPubkey || !/^[0-9a-f]{64}$/.test(id)) return null;
  const coord = longFormId ? `30023:${authorPubkey}:${longFormId}` : undefined;
  return {
    key: coord ? `${authorPubkey}:${longFormId}` : id,
    authorPubkey,
    ids: [id],
    coord,
    noteId: kind === 1 ? id : undefined,
  };
}

function hasTag(e: Event, name: string, value: string): boolean {
  return e.tags.some((t) => t[0] === name && t[1] === value);
}

/** True for a Wirthy cast note itself (casts never carry an `e` tag; replies do). */
export function isCastNote(e: Event): boolean {
  return e.kind === 1 && hasTag(e, 't', 'wirthy') && !e.tags.some((t) => t[0] === 'e');
}

export function resolveNoteId(target: CastTarget, events: Iterable<Event>): string | undefined {
  if (target.noteId) return target.noteId;
  if (!target.coord) return undefined;
  let best: Event | undefined;
  for (const e of events) {
    if (e.pubkey !== target.authorPubkey || !isCastNote(e) || !hasTag(e, 'a', target.coord)) continue;
    if (!best || e.created_at > best.created_at) best = e;
  }
  return best?.id;
}

/** The parent a reply answers, or null when it answers the cast itself. */
function replyParent(e: Event, castIds: Set<string>): string | null {
  if (e.kind === 1111) {
    const parent = e.tags.find((t) => t[0] === 'e')?.[1];
    return parent && !castIds.has(parent) ? parent : null;
  }
  const { root, reply } = parseNip10(e);
  const parent = reply?.id ?? root?.id;
  return parent && !castIds.has(parent) ? parent : null;
}

function refersTo(e: Event, castIds: Set<string>, coord?: string): boolean {
  return e.tags.some((t) =>
    ((t[0] === 'e' || t[0] === 'E') && castIds.has(t[1]))
    || (!!coord && (t[0] === 'a' || t[0] === 'A') && t[1] === coord));
}

/**
 * One cast's likes and threaded replies from the events seen. Pure.
 * `hidden` drops authors entirely (the test-cast key, unless test casts are shown).
 */
export function aggregateEngagement(
  events: Event[],
  target: CastTarget,
  myPubkey: string | null,
  hidden: ReadonlySet<string> = new Set(),
): Engagement {
  const noteId = resolveNoteId(target, events);
  const castIds = new Set(target.ids);
  if (noteId) castIds.add(noteId);

  // A deletion only counts when its author also wrote the event it deletes.
  const deleted = new Set<string>();
  for (const e of events) {
    if (e.kind !== 5) continue;
    for (const t of e.tags) if (t[0] === 'e' && t[1]) deleted.add(`${e.pubkey}:${t[1]}`);
  }
  const live = (e: Event) => !deleted.has(`${e.pubkey}:${e.id}`) && !hidden.has(e.pubkey);

  const replies = new Map<string, ReplyNode>();
  const parents = new Map<string, string | null>();
  for (const e of events) {
    if ((e.kind !== 1 && e.kind !== 1111) || castIds.has(e.id) || isCastNote(e) || !live(e)) continue;
    if (!refersTo(e, castIds, target.coord)) continue;
    replies.set(e.id, { event: e, children: [] });
    parents.set(e.id, replyParent(e, castIds));
  }

  // NIP-25: the LAST `e` tag names what was reacted to, so a like on a reply isn't counted.
  const newestByPubkey = new Map<string, Event>();
  const mine: string[] = [];
  for (const e of events) {
    if (e.kind !== 7 || !live(e)) continue;
    const lastE = e.tags.filter((t) => t[0] === 'e').at(-1)?.[1];
    // A like on the article from a long-form client names an article id this card may not know.
    const onCast = (!!lastE && castIds.has(lastE))
      || (!!target.coord && hasTag(e, 'a', target.coord) && !(lastE && replies.has(lastE)));
    if (!onCast) continue;
    if (e.content !== '-' && e.pubkey === myPubkey) mine.push(e.id);
    const prev = newestByPubkey.get(e.pubkey);
    if (!prev || e.created_at > prev.created_at) newestByPubkey.set(e.pubkey, e);
  }
  const likes = [...newestByPubkey.values()].filter((e) => e.content !== '-').length;

  const roots: ReplyNode[] = [];
  for (const [id, node] of replies) {
    const parent = parents.get(id);
    const parentNode = parent ? replies.get(parent) : undefined;
    (parentNode ? parentNode.children : roots).push(node);
  }
  const byTime = (a: ReplyNode, b: ReplyNode) => a.event.created_at - b.event.created_at;
  const sortTree = (nodes: ReplyNode[]) => { nodes.sort(byTime); nodes.forEach((n) => sortTree(n.children)); };
  sortTree(roots);

  return { noteId, likes, myReactionIds: mine, replyCount: replies.size, replies: roots };
}

/**
 * aggregateEngagement for many casts at once. Events are bucketed by the ids and
 * addresses they reference, so each cast only scans its own events (plus deletions).
 */
export function aggregateAll(
  events: Iterable<Event>,
  targets: CastTarget[],
  myPubkey: string | null,
  hidden: ReadonlySet<string> = new Set(),
): Map<string, Engagement> {
  const byRef = new Map<string, Event[]>();
  const deletions: Event[] = [];
  for (const e of events) {
    if (e.kind === 5) { deletions.push(e); continue; }
    const refs = new Set(e.tags.filter((t) => /^[eEaA]$/.test(t[0]) && t[1]).map((t) => t[1]));
    for (const ref of refs) {
      const bucket = byRef.get(ref);
      if (bucket) bucket.push(e); else byRef.set(ref, [e]);
    }
  }

  const out = new Map<string, Engagement>();
  for (const target of targets) {
    const own = new Set<Event>();
    const add = (ref: string | undefined) => { if (ref) byRef.get(ref)?.forEach((e) => own.add(e)); };
    target.ids.forEach(add);
    add(target.coord);
    const noteId = resolveNoteId(target, own);
    if (noteId && noteId !== target.noteId) add(noteId);
    out.set(target.key, aggregateEngagement([...own, ...deletions], { ...target, noteId }, myPubkey, hidden));
  }
  return out;
}
