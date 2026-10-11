// Client root for the Explore feed page (/explore). Wires together auth state,
// the live Cast feed, the first-visit popover, and the sign-in modal. Brand clicks
// dismiss the popover; "Learn more" opens the landing page (/).

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { EMPTY_FILTERS, applyFeedQuery, npubToHex, parseFeedQuery, relayScope, scopeKey, type FeedFilters } from '@/lib/feed-url';
import { authorDisplayName } from '@/lib/nostr/profiles';
import TopBar from '@/components/chrome/TopBar';
import CastFeed from '@/components/feed/CastFeed';
import SignInModal from '@/components/auth/SignInModal';
import FirstVisitPopover from '@/components/popover/FirstVisitPopover';
import { useNostrAuth } from '@/hooks/useNostrAuth';
import { useFirstVisit } from '@/hooks/useFirstVisit';
import { useCastFeed } from '@/hooks/useCastFeed';
import { useBridgeAuth } from '@/hooks/useBridgeAuth';
import { useFollowList } from '@/hooks/useFollowList';
import { useAuthorProfiles } from '@/hooks/useAuthorProfiles';
import { useReadCasts } from '@/hooks/useReadCasts';

// The feed's view as read from the URL. On a publisher page (/p/<npub>) the path names
// the publisher, so `locked` holds that pubkey and it is never written to the query.
interface UrlView {
  filters: FeedFilters;
  locked: string | null;
}

export default function ExploreClient() {
  const router = useRouter();
  const { auth, signInPubkey, setNip07Connected, autoSigninError, clearAutoSigninError } = useNostrAuth();
  const { showPopover, dismiss: dismissPopover } = useFirstVisit();
  // Null until the URL has been read. The page is prerendered without a location, so
  // reading it in a mount effect (not a lazy initialiser) avoids a hydration mismatch,
  // and the feed holds off subscribing so an unscoped REQ isn't sent and then replaced.
  const [view, setView] = useState<UrlView | null>(null);
  const filters = view?.filters ?? EMPTY_FILTERS;
  const locked = view?.locked ?? null;
  const { clips } = useCastFeed(view ? scopeKey(relayScope(view.filters)) : null);
  const { extensionPresent } = useBridgeAuth();
  const follows = useFollowList(auth.pubkey);
  const authors = useAuthorProfiles(clips);
  const { read, markRead } = useReadCasts();
  const [signInOpen, setSignInOpen] = useState(false);
  const publisherName = locked ? authorDisplayName(locked, authors.get(locked)) : null;

  useEffect(() => {
    const { pathname, search } = window.location;
    const pathNpub = /^\/p\/([^/]+)/.exec(pathname)?.[1];
    const lockedHex = pathNpub ? npubToHex(decodeURIComponent(pathNpub)) : null;
    if (pathNpub && !lockedHex) { router.replace('/explore' + search); return; }
    const parsed = parseFeedQuery(search);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of the URL, unavailable at prerender
    setView({ filters: lockedHex ? { ...parsed, authors: [lockedHex] } : parsed, locked: lockedHex });
  }, [router]);

  // Mirror every filter change into the address bar so the view is a shareable link.
  // replaceState, not push: a filter tweak shouldn't add a Back-button step.
  useEffect(() => {
    if (!view) return;
    const { pathname, search, hash } = window.location;
    const next = applyFeedQuery(search, view.locked ? { ...view.filters, authors: [] } : view.filters);
    if (next !== search) window.history.replaceState(window.history.state, '', pathname + next + hash);
  }, [view]);

  useEffect(() => {
    if (publisherName) document.title = `Posts by ${publisherName} — Wirthy`;
  }, [publisherName]);

  // On a publisher page, any change to who is selected leaves it for the general feed.
  const setFilters = (next: FeedFilters) => {
    if (locked && (next.authors.length !== 1 || next.authors[0] !== locked)) {
      router.push('/explore' + applyFeedQuery('', next));
      return;
    }
    setView({ filters: next, locked });
  };

  // The brand mark is a <Link> to /explore in TopBar, so this only handles the
  // side effect — navigation is the link's job.
  const handleBrandClick = () => dismissPopover();

  const handleLearnMore = () => {
    dismissPopover();
    router.push('/');
  };

  return (
    <div style={{ position: 'relative' }}>
      <TopBar
        auth={auth}
        onSignIn={() => setSignInOpen(true)}
        brandHasPopover={showPopover}
        onBrandClick={handleBrandClick}
        extensionPresent={extensionPresent}
        searchPlaceholder="Search posts…"
        searchValue={filters.q}
        onSearchChange={(q) => setFilters({ ...filters, q })}
      />

      {showPopover && (
        <FirstVisitPopover
          onDismiss={dismissPopover}
          onLearnMore={handleLearnMore}
        />
      )}

      {autoSigninError && auth.status !== 'connected' && (
        <div className="signin-error-banner" role="alert">
          <span className="signin-error-icon" aria-hidden="true">!</span>
          <span className="signin-error-text">
            <strong>Sign-in didn&apos;t complete</strong>
            {autoSigninError}
          </span>
          <button className="signin-error-retry" onClick={() => { clearAutoSigninError(); setSignInOpen(true); }}>
            Try again
          </button>
          <button className="signin-error-dismiss" onClick={clearAutoSigninError} aria-label="Dismiss">✕</button>
        </div>
      )}

      <CastFeed
        clips={clips}
        filters={filters}
        onFiltersChange={setFilters}
        title={publisherName ? `Posts by ${publisherName}` : undefined}
        follows={follows}
        authors={authors}
        isSignedIn={auth.status !== 'guest'}
        read={read}
        markRead={markRead}
        extensionPresent={extensionPresent}
      />

      {signInOpen && (
        <SignInModal
          onClose={() => setSignInOpen(false)}
          onSignedIn={(pubkey) => signInPubkey(pubkey)}
          onNip07SignedIn={(pubkey) => setNip07Connected(pubkey)}
        />
      )}
    </div>
  );
}
