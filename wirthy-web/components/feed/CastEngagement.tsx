// Like button, reply count, and the threaded replies under a public cast. Replies come
// from any Nostr client and are rendered as plain text (links auto-linked), never HTML.

'use client';

import { useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import type { Event } from 'nostr-tools';
import { npubEncode } from 'nostr-tools/nip19';
import type { ReplyNode } from '@/lib/nostr/engagement';
import type { ReplyParent } from '@/lib/nostr/engagement-events';
import type { CastEngagementView } from '@/hooks/useCastEngagement';
import { useProfiles } from '@/hooks/useAuthorProfiles';
import { authorDisplayName, type AuthorProfile } from '@/lib/nostr/profiles';

/** Everything DetailPanel needs to show and add engagement for one cast. */
export interface CastEngagementProps {
  view: CastEngagementView;
  canAct: boolean;
  onToggleLike: () => void;
  onReply: (parent: ReplyParent | null, text: string) => Promise<void>;
  onSignIn?: () => void;
}

const MAX_INDENT_DEPTH = 4;
const SIGN_IN_HINT = 'Sign in with a Nostr signing extension (Alby, nos2x, …) to like or reply.';

function relativeTime(createdAt: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - createdAt);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  if (s < 30 * 86_400) return `${Math.floor(s / 86_400)}d`;
  return new Date(createdAt * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const TOKEN_RE = /(https?:\/\/[^\s<>"]+|nostr:[a-z]+1[02-9ac-hj-np-z]+)/gi;

// Plain text with http(s) links made clickable and nostr: references shortened.
function renderText(text: string): ReactNode[] {
  return text.split(TOKEN_RE).map((part, i) => {
    if (i % 2 === 0) return part;
    if (/^https?:/i.test(part)) {
      const url = part.replace(/[.,;:!?)\]]+$/, '');
      const tail = part.slice(url.length);
      return <span key={i}><a href={url} target="_blank" rel="noopener nofollow ugc">{url}</a>{tail}</span>;
    }
    const ref = part.slice('nostr:'.length);
    const short = `${ref.slice(0, 12)}…`;
    return <span key={i} className="reply-ref" title={ref}>{/^(npub|nprofile)1/.test(ref) ? `@${short}` : short}</span>;
  });
}

function Avatar({ pubkey, profile }: { pubkey: string; profile?: AuthorProfile }) {
  if (profile?.picture) return <img className="reply-avatar" src={profile.picture} alt="" loading="lazy" />;
  let initial = '·';
  try { initial = (profile?.name?.trim()?.[0] ?? npubEncode(pubkey)[5]).toUpperCase(); } catch { /* keep the dot */ }
  return <span className="reply-avatar reply-avatar--letter">{initial}</span>;
}

// Material Design "thumb_up" (Apache-2.0), the shape YouTube's like button is drawn from.
const THUMB_FILLED = 'M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z';
const THUMB_OUTLINED = 'M9 21h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.58 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2zM9 9l4.34-4.34L12 10h9v2l-3 7H9V9zM1 9h4v12H1z';

/** YouTube-style thumbs-up: outlined, solid once liked. */
export function ThumbsUpIcon({ filled = false, size = 15 }: { filled?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d={filled ? THUMB_FILLED : THUMB_OUTLINED} />
    </svg>
  );
}

export function ReplyIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.8-.9L3 20l1.1-4.4A8.4 8.4 0 1 1 21 11.5z" />
    </svg>
  );
}

export function LikeButton({ view, canAct, onToggleLike, onSignIn }: CastEngagementProps) {
  const ready = canAct && !!view.noteId;
  const title = !canAct ? SIGN_IN_HINT
    : !view.noteId ? 'Finding this post on the relays…'
    : view.liked ? 'Unlike' : 'Like';
  return (
    <button
      className={`btn-detail-like${view.liked ? ' liked' : ''}${view.likePending ? ' pending' : ''}`}
      onClick={() => (ready ? onToggleLike() : !canAct ? onSignIn?.() : undefined)}
      disabled={canAct && (!view.noteId || view.likePending)}
      aria-pressed={view.liked}
      aria-label={`${title} (${view.likes} like${view.likes === 1 ? '' : 's'})`}
      title={title}
    >
      <ThumbsUpIcon filled={view.liked} />
      {view.likes > 0 && <span className="engagement-count">{view.likes}</span>}
    </button>
  );
}

export function ReplyCountButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button className="btn-detail-replies" onClick={onClick} title="Replies" aria-label={`${count} repl${count === 1 ? 'y' : 'ies'}`}>
      <ReplyIcon />
      {count > 0 && <span className="engagement-count">{count}</span>}
    </button>
  );
}

function ReplyComposer({ placeholder, onSubmit, onCancel, autoFocus, disabledReason, inputRef }: {
  placeholder: string;
  onSubmit: (text: string) => Promise<void>;
  onCancel?: () => void;
  autoFocus?: boolean;
  disabledReason?: string;
  inputRef?: Ref<HTMLTextAreaElement>;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy || !text.trim() || disabledReason) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(text);
      setText('');
      onCancel?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="reply-composer">
      <textarea
        ref={inputRef}
        className="note-textarea reply-textarea"
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void submit(); }
          if (e.key === 'Escape' && onCancel) { e.stopPropagation(); onCancel(); }
        }}
        autoFocus={autoFocus}
        disabled={busy}
        aria-label={placeholder}
      />
      {error && <div className="engagement-error" role="alert">{error}</div>}
      <div className="note-edit-actions">
        <button className="btn-note-save" onClick={() => void submit()} disabled={busy || !text.trim() || !!disabledReason} title={disabledReason}>
          {busy ? 'Publishing…' : 'Reply'}
        </button>
        {onCancel && <button className="btn-note-cancel" onClick={onCancel} disabled={busy}>Cancel</button>}
      </div>
    </div>
  );
}

function ReplyItem({ node, depth, profiles, canAct, composerDisabled, replyingTo, setReplyingTo, onReply }: {
  node: ReplyNode;
  depth: number;
  profiles: Map<string, AuthorProfile>;
  canAct: boolean;
  composerDisabled?: string;
  replyingTo: string | null;
  setReplyingTo: (id: string | null) => void;
  onReply: CastEngagementProps['onReply'];
}) {
  const e: Event = node.event;
  const profile = profiles.get(e.pubkey);
  const name = authorDisplayName(e.pubkey, profile);
  return (
    <li className="reply">
      <div className="reply-head">
        <Avatar pubkey={e.pubkey} profile={profile} />
        <span className="reply-author" title={(() => { try { return npubEncode(e.pubkey); } catch { return name; } })()}>{name}</span>
        <span className="reply-time" title={new Date(e.created_at * 1000).toLocaleString()}>{relativeTime(e.created_at)}</span>
      </div>
      <p className="reply-text">{renderText(e.content)}</p>
      {canAct && (
        <button className="reply-action" onClick={() => setReplyingTo(replyingTo === e.id ? null : e.id)}>Reply</button>
      )}
      {replyingTo === e.id && (
        <ReplyComposer
          placeholder={`Reply to ${name}`}
          autoFocus
          disabledReason={composerDisabled}
          onSubmit={(text) => onReply({ id: e.id, pubkey: e.pubkey, tags: e.tags }, text)}
          onCancel={() => setReplyingTo(null)}
        />
      )}
      {node.children.length > 0 && (
        <ul className={`reply-list${depth < MAX_INDENT_DEPTH ? ' reply-list--nested' : ''}`}>
          {node.children.map((child) => (
            <ReplyItem
              key={child.event.id}
              node={child}
              depth={depth + 1}
              profiles={profiles}
              canAct={canAct}
              composerDisabled={composerDisabled}
              replyingTo={replyingTo}
              setReplyingTo={setReplyingTo}
              onReply={onReply}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function collectAuthors(nodes: ReplyNode[], out: string[] = []): string[] {
  for (const n of nodes) { out.push(n.event.pubkey); collectAuthors(n.children, out); }
  return out;
}

/**
 * The thread under a cast, headed by a second like/reply bar (Medium and Substack repeat
 * theirs at the end of an article, so a reader who finished it needn't scroll back up).
 * `showLikeError`: the like error belongs beside whichever bar was clicked.
 */
export function CastReplies({ view, canAct, onToggleLike, onReply, onSignIn, sectionRef, showLikeError = false }: CastEngagementProps & {
  sectionRef?: Ref<HTMLElement>;
  showLikeError?: boolean;
}) {
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const authors = useMemo(() => collectAuthors(view.replies), [view.replies]);
  const profiles = useProfiles(authors);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const composerDisabled = view.noteId ? undefined : 'Finding this post on the relays…';

  return (
    <section className="detail-section cast-replies" ref={sectionRef} aria-label="Replies">
      <div className="detail-section-header cast-replies-bar">
        <div className="detail-section-label">Replies{view.replyCount > 0 ? ` (${view.replyCount})` : ''}</div>
        <div className="detail-actions">
          <LikeButton view={view} canAct={canAct} onToggleLike={onToggleLike} onReply={onReply} onSignIn={onSignIn} />
          <ReplyCountButton
            count={view.replyCount}
            onClick={() => (canAct ? composerRef.current?.focus() : onSignIn?.())}
          />
        </div>
      </div>
      {showLikeError && view.error && <div className="engagement-error" role="alert">{view.error}</div>}
      {canAct ? (
        <ReplyComposer placeholder="Write a reply…" onSubmit={(text) => onReply(null, text)} disabledReason={composerDisabled} inputRef={composerRef} />
      ) : (
        <div className="engagement-signin">
          <span>{SIGN_IN_HINT}</span>
          {onSignIn && <button className="btn" onClick={onSignIn}>Sign in</button>}
        </div>
      )}
      {view.replies.length > 0 ? (
        <ul className="reply-list">
          {view.replies.map((node) => (
            <ReplyItem
              key={node.event.id}
              node={node}
              depth={1}
              profiles={profiles}
              canAct={canAct}
              composerDisabled={composerDisabled}
              replyingTo={replyingTo}
              setReplyingTo={setReplyingTo}
              onReply={onReply}
            />
          ))}
        </ul>
      ) : (
        <p className="reply-empty">No replies yet.</p>
      )}
    </section>
  );
}
