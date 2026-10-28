// Main public Cast feed shell — the Explore page's primary content area.
// Filter state (category, signals, qualifiers, authors, unread, search) is controlled by
// the page, which mirrors it into the URL; this derives the filtered clip list and renders
// a toolbar (title, Filters widget, active pills, sort/view) above feed list / DetailPanel.

'use client';

import { useState, useMemo } from 'react';
import { npubEncode } from 'nostr-tools/nip19';
import { CATEGORIES, SIGNAL_LEVELS, deriveQualifierOptions, matchesAuthors, matchesQualifiers, matchesSignal } from '@/lib/constants';
import type { AuthState, ClipData } from '@/lib/types';
import { EMPTY_FILTERS, type FeedFilters } from '@/lib/feed-url';
import { castPath } from '@/lib/nostr/cast-ref';
import type { ClipBody } from '@/lib/bridge/ClipStoreContext';
import type { FollowProfile } from '@/lib/nostr/follows';
import { authorDisplayName, type AuthorProfile } from '@/lib/nostr/profiles';
import ClipRow from './ClipRow';
import DetailPanel from './DetailPanel';
import FilterStrip from './FilterStrip';
import FilterWidget from './FilterWidget';
import ViewControls, { type SortOrder, type ViewMode } from './ViewControls';
import ResizableLayout from '@/components/layout/ResizableLayout';
import CollapsibleSection from '@/components/layout/CollapsibleSection';
import AuthorContextMenu from '@/components/menu/AuthorContextMenu';
import { useSidebarSections } from '@/hooks/useSidebarSections';
import { useFollowMutation } from '@/hooks/useFollowMutation';
import { useCastEngagement } from '@/hooks/useCastEngagement';
import type { CastEngagementProps } from './CastEngagement';

// One publisher in the filter panel: an author present in the loaded feed, with how
// many of the loaded posts they published.
interface Publisher {
  pubkey: string;
  count: number;
}

// Filters panel body: View shortcuts, follows list, publishers list, and
// signal/qualifier/category filter controls.
interface FilterPanelProps {
  activeCat: string | null;
  setActiveCat: (c: string | null) => void;
  activeSignals: string[];
  toggleSignal: (s: string) => void;
  activeQuals: string[];
  toggleQual: (q: string) => void;
  qualOptions: string[];
  // Following and Publishers write to one shared selection set: the same person can
  // appear in both lists, so selecting them in either must mean the same thing.
  activeAuthors: string[];
  toggleAuthor: (pubkey: string) => void;
  unreadOnly: boolean;
  setUnreadOnly: (v: boolean) => void;
  clearFilters: () => void;
  count: number;
  unreadCount: number;
  follows: FollowProfile[];
  publishers: Publisher[];
  authors: Map<string, AuthorProfile>;
  isSignedIn: boolean;
  onAuthorContextMenu: (pubkey: string, x: number, y: number) => void;
}

// npub for a pubkey, used wherever the key is shown to the user (never hex).
function toNpub(pubkey: string): string {
  try { return npubEncode(pubkey); } catch { return pubkey; }
}

// Avatar letter: the name's first char, else the first char past the shared
// "npub1" prefix — never raw hex.
function avatarInitial(pubkey: string, name?: string): string {
  return (name?.trim()?.[0] ?? toNpub(pubkey)[5] ?? '·').toUpperCase();
}

function ExploreFilterPanel({
  activeCat, setActiveCat,
  activeSignals, toggleSignal,
  activeQuals, toggleQual, qualOptions,
  activeAuthors, toggleAuthor,
  unreadOnly, setUnreadOnly,
  clearFilters,
  count,
  unreadCount,
  follows,
  publishers,
  authors,
  isSignedIn,
  onAuthorContextMenu,
}: FilterPanelProps) {
  const { open, toggle } = useSidebarSections();

  return (
    <div className="filter-panel">
      <CollapsibleSection title="View" open={open.view} onToggle={() => toggle('view')}>
        <ul className="nav-list">
          <li
            className={`nav-item ${activeCat === null && activeAuthors.length === 0 && !unreadOnly ? 'active' : ''}`}
            onClick={clearFilters}
          >
            All wirthy <span className="nav-count">{count}</span>
          </li>
          <li
            className={`nav-item ${unreadOnly ? 'active' : ''}`}
            onClick={() => setUnreadOnly(!unreadOnly)}
          >
            Unread <span className="nav-count">{unreadCount}</span>
          </li>
        </ul>
      </CollapsibleSection>

      <CollapsibleSection
        title="Following"
        badge={<span className="count">{follows.length}</span>}
        open={open.following}
        onToggle={() => toggle('following')}
      >
        {!isSignedIn ? (
          <div className="follows-empty">Sign in to see who you follow.</div>
        ) : follows.length === 0 ? (
          <div className="follows-empty">No follows yet.</div>
        ) : (
          <div className="follows">
            {follows.map((f) => (
              <div
                key={f.pubkey}
                className={`follow ${activeAuthors.includes(f.pubkey) ? 'active' : ''}`}
                onClick={() => toggleAuthor(f.pubkey)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onAuthorContextMenu(f.pubkey, e.clientX, e.clientY);
                }}
                title={toNpub(f.pubkey)}
                role="checkbox"
                aria-checked={activeAuthors.includes(f.pubkey)}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleAuthor(f.pubkey); }
                }}
              >
                {f.picture
                  ? <img className="av av-img" src={f.picture} alt="" />
                  : <span className="av">{avatarInitial(f.pubkey, f.name)}</span>}
                <span className="name">{f.name || `${toNpub(f.pubkey).slice(0, 12)}…`}</span>
              </div>
            ))}
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title="Publishers"
        badge={<span className="count">{publishers.length}</span>}
        open={open.publishers}
        onToggle={() => toggle('publishers')}
      >
        {publishers.length === 0 ? (
          <div className="follows-empty">No publishers yet.</div>
        ) : (
          <div className="follows">
            {publishers.map((p) => {
              const profile = authors.get(p.pubkey);
              const label = authorDisplayName(p.pubkey, profile);
              const selected = activeAuthors.includes(p.pubkey);
              return (
                <div
                  key={p.pubkey}
                  className={`follow ${selected ? 'active' : ''}`}
                  onClick={() => toggleAuthor(p.pubkey)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onAuthorContextMenu(p.pubkey, e.clientX, e.clientY);
                  }}
                  title={toNpub(p.pubkey)}
                  role="checkbox"
                  aria-checked={selected}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleAuthor(p.pubkey); }
                  }}
                >
                  <span className="av">{avatarInitial(p.pubkey, profile?.name)}</span>
                  <span className="name">{label}</span>
                  <span className="pub-count">{p.count}</span>
                </div>
              );
            })}
          </div>
        )}
      </CollapsibleSection>

      <div className="filters">
        <CollapsibleSection
          title="Signal"
          open={open.signal}
          onToggle={() => toggle('signal')}
        >
          <div className="axis-range">
            {SIGNAL_LEVELS.map((lvl) => (
              <div
                key={lvl}
                className={`pip ${activeSignals.includes(lvl) ? 'active signal' : ''}`}
                onClick={() => toggleSignal(lvl)}
                title={lvl}
              >
                {lvl[0]}
              </div>
            ))}
          </div>
        </CollapsibleSection>

        {qualOptions.length > 0 && (
          <CollapsibleSection
            title="Qualifiers"
            open={open.qualifiers}
            onToggle={() => toggle('qualifiers')}
          >
            <div className="cat-filter">
              {qualOptions.map((qual) => (
                <button
                  key={qual}
                  className={`cat-chip ${activeQuals.includes(qual) ? 'active' : ''}`}
                  onClick={() => toggleQual(qual)}
                >
                  {qual}
                </button>
              ))}
            </div>
          </CollapsibleSection>
        )}

        <CollapsibleSection
          title="Category"
          open={open.category}
          onToggle={() => toggle('category')}
        >
          <div className="cat-filter">
            {Object.entries(CATEGORIES).map(([key, cat]) => (
              <button
                key={key}
                className={`cat-chip ${activeCat === key ? 'active' : ''}`}
                onClick={() => setActiveCat(activeCat === key ? null : key)}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </CollapsibleSection>
      </div>
    </div>
  );
}

// One cast's full detail view (the single detail pane, and each card of the Stream view).
// Read-only: a public cast can't be deleted or have its note edited from here.
function StreamCard({
  clip,
  author,
  onAuthorContextMenu,
  engagement,
}: {
  clip: ClipData | null;
  author?: AuthorProfile;
  onAuthorContextMenu?: (pubkey: string, x: number, y: number) => void;
  engagement?: CastEngagementProps;
}) {
  return (
    <DetailPanel
      clip={clip}
      author={author}
      onDelete={() => {}}
      onUpdateNote={() => {}}
      bodies={EMPTY_BODIES}
      onBodyFetched={() => {}}
      onAuthorContextMenu={onAuthorContextMenu}
      shareHref={clip ? castPath(clip) : null}
      engagement={engagement}
      readOnly
    />
  );
}

interface CastFeedProps {
  clips: ClipData[];
  /** Controlled filter state (the page mirrors it into the URL). `q` is the top-bar search. */
  filters: FeedFilters;
  onFiltersChange: (f: FeedFilters) => void;
  /** Toolbar heading; defaults to "Explore" (a publisher page passes "Posts by …"). */
  title?: string;
  follows?: FollowProfile[];
  authors?: Map<string, AuthorProfile>;
  isSignedIn?: boolean;
  read?: Set<string>;
  markRead?: (id: string) => void;
  // Whether the Wirthy extension bridge is connected — Follow needs it to
  // sign+publish the kind:3 mutation (the web app has no reliable signer on
  // its own for most auth modes). Defaults false so call sites that don't
  // pass it (Library's Stream reuse, tests) simply disable the menu action.
  extensionPresent?: boolean;
  // The signed-in identity. Liking and replying need a NIP-07 wallet session.
  auth?: AuthState;
  // The page has a NIP-07 wallet, so a restored (read-only) session can still sign.
  walletAvailable?: boolean;
  onSignIn?: () => void;
}

const GUEST: AuthState = { status: 'guest', pubkey: null };

const EMPTY_READ: Set<string> = new Set();

const EMPTY_AUTHORS: Map<string, AuthorProfile> = new Map();

// The public Explore feed has no owned clips to fetch bodies for (bodyHtml/
// markdown/bodyText already arrive with the clip from Nostr) — DetailPanel's
// body-cache plumbing is unused here, so every instance shares one empty map
// rather than each allocating its own on every render.
const EMPTY_BODIES: Map<string, ClipBody> = new Map();

// Add `value` if absent, remove it if present.
function toggled(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

export default function CastFeed({ clips, filters, onFiltersChange, title, follows = [], authors = EMPTY_AUTHORS, isSignedIn = false, read, markRead, extensionPresent = false, auth = GUEST, walletAvailable = false, onSignIn }: CastFeedProps) {
  const readSet = read ?? EMPTY_READ;
  const { isFollowing, toggleFollow } = useFollowMutation(follows, extensionPresent);
  // All loaded casts, not the filtered list, so changing a filter doesn't re-subscribe.
  const engagement = useCastEngagement(clips, auth, walletAvailable);
  const engagementFor = (clip: ClipData): CastEngagementProps => ({
    view: engagement.get(clip),
    canAct: engagement.canAct,
    onToggleLike: () => engagement.toggleLike(clip),
    onReply: (parent, text) => engagement.reply(clip, parent, text),
    onSignIn,
  });
  const rowEngagement = (clip: ClipData) => {
    const v = engagement.get(clip);
    return { likes: v.likes, replies: v.replyCount, liked: v.liked };
  };
  const [authorMenu, setAuthorMenu] = useState<{ pubkey: string; x: number; y: number } | null>(null);
  const openAuthorMenu = (pubkey: string, x: number, y: number) => setAuthorMenu({ pubkey, x, y });
  // Filter state is owned by the page (it lives in the URL); these are its views.
  // activeAuthors holds pubkeys selected in EITHER the Following or Publishers list —
  // one shared set, since a person can be listed in both.
  const { category: activeCat, signals: activeSignals, qualifiers: activeQuals, authors: activeAuthors, unreadOnly } = filters;
  const update = (patch: Partial<FeedFilters>) => onFiltersChange({ ...filters, ...patch });
  const setActiveCat = (category: string | null) => update({ category });
  const setUnreadOnly = (v: boolean) => update({ unreadOnly: v });
  const searchQuery = filters.q;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>('recent');
  // 'list' shows feed list + detail; 'focus' hides the feed list so the
  // detail/reading panel fills the remaining width.
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  // Phone layout only: whether the opened item replaces the list.
  const [detailOpen, setDetailOpen] = useState(false);

  const q = searchQuery?.trim().toLowerCase() ?? '';

  const qualOptions = useMemo(() => deriveQualifierOptions(clips), [clips]);

  // Every author present in the loaded feed, most-published first. Derived from all
  // clips rather than the filtered list — deriving from `filtered` would shrink the
  // list to the selected publisher, leaving no way to switch to a different one.
  const publishers = useMemo<Publisher[]>(() => {
    const counts = new Map<string, number>();
    for (const c of clips) {
      const pk = c.capture.authorPubkey;
      if (pk) counts.set(pk, (counts.get(pk) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([pubkey, count]) => ({ pubkey, count }))
      .sort((a, b) => b.count - a.count);
  }, [clips]);

  const toggleSignal = (sig: string) => update({ signals: toggled(activeSignals, sig) });
  const toggleQual = (qual: string) => update({ qualifiers: toggled(activeQuals, qual) });
  const toggleAuthor = (pubkey: string) => update({ authors: toggled(activeAuthors, pubkey) });

  // Search is the top bar's, so "All" leaves it alone.
  const clearFilters = () => update({ ...EMPTY_FILTERS, q: filters.q });

  // Pill labels for the selected authors. A follow carries its own kind-3 name, which
  // is the better label when the author has no kind-0 in the feed's profile map.
  const activeAuthorPills = useMemo(
    () => activeAuthors.map((pubkey) => {
      const followName = follows.find((f) => f.pubkey === pubkey)?.name?.trim();
      return {
        pubkey,
        label: followName || authorDisplayName(pubkey, authors.get(pubkey)),
      };
    }),
    [activeAuthors, authors, follows],
  );

  const unreadCount = useMemo(
    () => clips.reduce((n, c) => (readSet.has(c.capture.id) ? n : n + 1), 0),
    [clips, readSet],
  );

  const filtered = useMemo(() => clips.filter((c) => {
    if (activeCat && c.evaluation.category !== activeCat) return false;
    if (!matchesSignal(c.evaluation.signal, activeSignals)) return false;
    if (!matchesQualifiers(c.evaluation.qualifiers, activeQuals)) return false;
    if (unreadOnly && readSet.has(c.capture.id)) return false;
    if (!matchesAuthors(c.capture.authorPubkey, activeAuthors)) return false;
    if (q) {
      const hay = [
        c.capture.title,
        c.capture.selectionText,
        c.capture.selectionContext,
        c.capture.bodyText,
        c.capture.note,
        c.capture.url,
      ].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }), [clips, activeCat, activeSignals, activeQuals, activeAuthors, unreadOnly, q, readSet]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => sortOrder === 'recent'
      ? b.capture.timestamp - a.capture.timestamp
      : a.capture.timestamp - b.capture.timestamp);
    return copy;
  }, [filtered, sortOrder]);

  const selected = sorted.find((c) => c.capture.id === selectedId) ?? sorted[0] ?? null;

  const handleSelectClip = (id: string) => {
    setSelectedId(id);
    setDetailOpen(true);
    markRead?.(id);
  };

  const filterStrip = (
    <FilterStrip
      activeSignals={activeSignals}
      activeQuals={activeQuals}
      activeCat={activeCat}
      activeAuthors={activeAuthorPills}
      onClearSignal={(sig) => update({ signals: activeSignals.filter((x) => x !== sig) })}
      onClearQual={(qual) => update({ qualifiers: activeQuals.filter((x) => x !== qual) })}
      onClearCat={() => setActiveCat(null)}
      onClearAuthor={toggleAuthor}
      onClearAll={clearFilters}
    />
  );

  const activeCount = activeSignals.length + activeQuals.length + (activeCat ? 1 : 0)
    + activeAuthors.length + (unreadOnly ? 1 : 0);

  const feedContent = (
    <main className="feed-col">
      <div className="feed-scroll">
        <div className="feed-list">
          {sorted.length === 0 ? (
            <div className="feed-empty">
              {q ? `No casts match "${searchQuery}".` : 'No clips match these filters.'}
            </div>
          ) : (
            sorted.map((clip) => (
              <ClipRow
                key={clip.capture.id}
                clip={clip}
                selected={selected?.capture.id === clip.capture.id}
                onClick={() => handleSelectClip(clip.capture.id)}
                author={clip.capture.authorPubkey ? authors.get(clip.capture.authorPubkey) : undefined}
                onAuthorContextMenu={openAuthorMenu}
                engagement={rowEngagement(clip)}
              />
            ))
          )}
        </div>
      </div>
    </main>
  );

  const streamContent = (
    <div className="detail-stream">
      <div className="detail-stream-scroll">
        {sorted.length === 0 ? (
          <div className="feed-empty">
            {q ? `No casts match "${searchQuery}".` : 'No clips match these filters.'}
          </div>
        ) : (
          sorted.map((clip) => (
            <StreamCard
              key={clip.capture.id}
              clip={clip}
              author={clip.capture.authorPubkey ? authors.get(clip.capture.authorPubkey) : undefined}
              onAuthorContextMenu={openAuthorMenu}
              engagement={engagementFor(clip)}
            />
          ))
        )}
      </div>
    </div>
  );

  return (
    <div className="app feed-shell">
      <div className="feed-toolbar">
        <h1 className="feed-title"><em>{title ?? 'Explore'}</em></h1>
        <FilterWidget activeCount={activeCount}>
          <ExploreFilterPanel
            activeCat={activeCat} setActiveCat={setActiveCat}
            activeSignals={activeSignals} toggleSignal={toggleSignal}
            activeQuals={activeQuals} toggleQual={toggleQual} qualOptions={qualOptions}
            activeAuthors={activeAuthors} toggleAuthor={toggleAuthor}
            unreadOnly={unreadOnly} setUnreadOnly={setUnreadOnly}
            clearFilters={clearFilters}
            count={clips.length}
            unreadCount={unreadCount}
            follows={follows}
            publishers={publishers}
            authors={authors}
            isSignedIn={isSignedIn}
            onAuthorContextMenu={openAuthorMenu}
          />
        </FilterWidget>
        {filterStrip}
        <ViewControls sortOrder={sortOrder} setSortOrder={setSortOrder} viewMode={viewMode} setViewMode={setViewMode} />
      </div>
      <ResizableLayout
        feed={feedContent}
        detail={viewMode === 'focus'
          ? streamContent
          : (
            <StreamCard
              clip={selected}
              author={selected?.capture.authorPubkey ? authors.get(selected.capture.authorPubkey) : undefined}
              onAuthorContextMenu={openAuthorMenu}
              engagement={selected ? engagementFor(selected) : undefined}
            />
          )}
        showFeed={viewMode === 'list'}
        detailOpen={detailOpen}
        onBack={() => setDetailOpen(false)}
      />

      {authorMenu && (
        <AuthorContextMenu
          x={authorMenu.x}
          y={authorMenu.y}
          isFollowing={isFollowing(authorMenu.pubkey)}
          canFollow={extensionPresent}
          disabledReason="Install the Wirthy extension to follow publishers."
          onFollow={() => toggleFollow(authorMenu.pubkey)}
          onUnfollow={() => toggleFollow(authorMenu.pubkey)}
          onClose={() => setAuthorMenu(null)}
        />
      )}
    </div>
  );
}
