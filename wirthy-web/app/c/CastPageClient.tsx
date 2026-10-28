// One public cast at /c/<naddr|note|nevent>. Reads the id from the path (the export serves
// one shell for every id), fetches the event from the active relays and renders it with the
// feed's DetailPanel. A note that has a long-form companion is re-addressed to its naddr.

'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { npubEncode } from 'nostr-tools/nip19';
import TopBar from '@/components/chrome/TopBar';
import DetailPanel from '@/components/feed/DetailPanel';
import SignInModal from '@/components/auth/SignInModal';
import { useNostrAuth } from '@/hooks/useNostrAuth';
import { useBridgeAuth } from '@/hooks/useBridgeAuth';
import { useAuthorProfiles } from '@/hooks/useAuthorProfiles';
import { useCastEngagement } from '@/hooks/useCastEngagement';
import { authorDisplayName, type AuthorProfile } from '@/lib/nostr/profiles';
import { readSsrAuthor, withSsrAuthor } from '@/lib/nostr/ssr-author';
import { WEB_STORE_URL } from '@/lib/constants';
import { castPath } from '@/lib/nostr/cast-ref';
import { countEvent } from '@/lib/analytics';
import type { ClipData } from '@/lib/types';
import type { ClipBody } from '@/lib/bridge/ClipStoreContext';

type PageState =
  | { status: 'loading' }
  | { status: 'invalid' }
  | { status: 'missing' }
  | { status: 'found'; clip: ClipData; ssrAuthor: AuthorProfile | null };

// A public cast carries its body in the event, so DetailPanel's private body cache is unused.
const EMPTY_BODIES: Map<string, ClipBody> = new Map();
const NO_CLIPS: ClipData[] = [];

export default function CastPageClient() {
  const { auth, nip07Available, signInPubkey, setNip07Connected } = useNostrAuth();
  const { extensionPresent } = useBridgeAuth();
  const [signInOpen, setSignInOpen] = useState(false);
  const [state, setState] = useState<PageState>({ status: 'loading' });
  const clips = useMemo(() => (state.status === 'found' ? [state.clip] : NO_CLIPS), [state]);
  const liveAuthors = useAuthorProfiles(clips);
  const ssrAuthor = state.status === 'found' ? state.ssrAuthor : null;
  const authors = useMemo(() => withSsrAuthor(liveAuthors, ssrAuthor), [liveAuthors, ssrAuthor]);
  const engagement = useCastEngagement(clips, auth, nip07Available);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ decodeCastRef, encodeCastRef, fetchCast }, { parseEvent }, { getActiveRelays }] = await Promise.all([
        import('@/lib/nostr/cast-ref'),
        import('@/lib/nostr/parse'),
        import('@/lib/constants'),
      ]);
      const segment = decodeURIComponent(window.location.pathname.split('/')[2] ?? '');
      const ref = decodeCastRef(segment);
      if (!ref) { if (!cancelled) setState({ status: 'invalid' }); return; }
      const found = await fetchCast(ref, getActiveRelays(), 4000).catch(() => null);
      if (cancelled) return;
      if (!found) { setState({ status: 'missing' }); return; }
      const canonical = encodeCastRef(found.canonical);
      if (canonical !== segment) {
        window.history.replaceState(window.history.state, '', `/c/${canonical}${window.location.search}${window.location.hash}`);
      }
      setState({ status: 'found', clip: parseEvent(found.event), ssrAuthor: readSsrAuthor() });
    })();
    return () => { cancelled = true; };
  }, []);

  const clip = state.status === 'found' ? state.clip : null;
  const pubkey = clip?.capture.authorPubkey;
  const author = pubkey ? authors.get(pubkey) : undefined;
  const authorName = pubkey ? authorDisplayName(pubkey, author) : '';

  useEffect(() => {
    if (clip) document.title = `${clip.capture.title} — Wirthy`;
  }, [clip]);

  return (
    <div style={{ height: '100%', overflow: 'auto', background: 'var(--paper)' }}>
      <TopBar auth={auth} onSignIn={() => setSignInOpen(true)} extensionPresent={extensionPresent} />

      <main className="cast-page">
        {/* Filled with a crawler-readable summary by the share-page function; dropped once the live cast renders. */}
        {state.status === 'loading' && (
          <div id="ssr-cast" suppressHydrationWarning dangerouslySetInnerHTML={{ __html: '' }} />
        )}

        {state.status === 'loading' && <p className="cast-page-status">Loading post…</p>}

        {(state.status === 'invalid' || state.status === 'missing') && (
          <div className="cast-page-status">
            <h1>{state.status === 'invalid' ? 'That isn’t a post link.' : 'Post not found.'}</h1>
            <p>
              {state.status === 'invalid'
                ? 'The address doesn’t name a Wirthy post.'
                : 'None of the relays this site reads returned it. It may have been deleted, or published to relays we don’t read.'}
            </p>
            <Link href="/explore" className="btn" style={{ textDecoration: 'none' }}>Explore public posts</Link>
          </div>
        )}

        {clip && (
          <>
            {pubkey && (
              <div className="cast-page-byline">
                <Link href={`/p/${npubEncode(pubkey)}`}>More posts from {authorName} →</Link>
              </div>
            )}
            <DetailPanel
              clip={clip}
              author={author}
              onDelete={() => {}}
              onUpdateNote={() => {}}
              bodies={EMPTY_BODIES}
              onBodyFetched={() => {}}
              shareHref={castPath(clip)}
              readOnly
              engagement={{
                view: engagement.get(clip),
                canAct: engagement.canAct,
                onToggleLike: () => engagement.toggleLike(clip),
                onReply: (parent, text) => engagement.reply(clip, parent, text),
                onSignIn: () => setSignInOpen(true),
              }}
            />
          </>
        )}

        {!extensionPresent && state.status !== 'loading' && (
          <aside className="cast-page-cta">
            <p>Clip anything on the web, rate it yourself, and keep it — or publish your picks like this one.</p>
            <a
              href={WEB_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn primary"
              style={{ textDecoration: 'none' }}
              onClick={() => countEvent('install-extension-cast', 'Install from a cast page')}
            >
              Add to Chrome — free
            </a>
          </aside>
        )}
      </main>

      {signInOpen && (
        <SignInModal
          onClose={() => setSignInOpen(false)}
          onSignedIn={(pk) => signInPubkey(pk)}
          onNip07SignedIn={(pk) => setNip07Connected(pk)}
        />
      )}
    </div>
  );
}
