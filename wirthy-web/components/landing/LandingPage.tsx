// The product landing page at /. Every claim here traces to an ID in
// marketing/copy/claims.md (noted inline); don't add a sentence without one.
//
// `/` used to be a client redirect to the feed, and the extension's ?signin=1 /
// ?settings=1 deep links (plus the dev ?popover=1 switch) may still arrive here, so
// those are forwarded to /explore with their query intact.

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import HeroBeacon from '@/components/brand/HeroBeacon';
import TopBar from '@/components/chrome/TopBar';
import SignInModal from '@/components/auth/SignInModal';
import { useNostrAuth } from '@/hooks/useNostrAuth';
import { useBridgeAuth } from '@/hooks/useBridgeAuth';
import { WEB_STORE_URL } from '@/lib/constants';
import { countEvent } from '@/lib/analytics';

// Query params that belong to the feed page, not the landing page.
const FEED_PARAMS = ['signin', 'settings', 'popover'];

const h2 = {
  fontFamily: 'var(--serif)',
  fontSize: 22,
  fontWeight: 500,
  color: 'var(--ink)',
  margin: '36px 0 12px',
  letterSpacing: '-0.015em',
} as const;

const p = { margin: '0 0 16px' } as const;

const link = { color: 'var(--accent-ink)', textDecoration: 'underline', textUnderlineOffset: 2 } as const;

function InstallButton({ event }: { event: string }) {
  return (
    <a
      href={WEB_STORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="btn primary"
      style={{ textDecoration: 'none' }}
      onClick={() => countEvent(event, 'Install from /')}
    >
      Add to Chrome — free
    </a>
  );
}

export default function LandingPage() {
  const router = useRouter();
  const { auth, signInPubkey, setNip07Connected } = useNostrAuth();
  const { extensionPresent } = useBridgeAuth();
  const [signInOpen, setSignInOpen] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (FEED_PARAMS.some((k) => params.has(k))) {
      router.replace('/explore' + window.location.search + window.location.hash);
    }
  }, [router]);

  return (
    <div style={{ height: '100%', overflow: 'auto', background: 'var(--paper)' }}>
      <TopBar
        auth={auth}
        onSignIn={() => setSignInOpen(true)}
        extensionPresent={extensionPresent}
      />

      <section className="hero">
        <div className="hero-art">
          <HeroBeacon />
        </div>
        <div className="hero-copy">
          {/* C-02 */}
          <div className="hero-eyebrow">A web clipper that keeps the layout</div>
          {/* C-01, C-04, C-09 */}
          <h1 className="hero-title">Clip anything on the web,<br /><em>rate it, keep it</em></h1>
          {/* C-02, C-04, C-06, C-09, C-10 */}
          <p className="hero-lede">
            Wirthy captures the page the way you actually read it — threads, code blocks,
            bylines and images — then lets you rate and tag what you saved. Clips stay in your
            own browser unless you choose to publish them.
          </p>
          <div className="hero-cta">
            <InstallButton event="install-extension-landing" />
            <Link href="/explore" className="btn" style={{ textDecoration: 'none' }}>
              Explore public posts
            </Link>
          </div>
        </div>
      </section>

      <section className="landing-features" aria-label="Features">
        {/* C-02, C-03 */}
        <div className="landing-feature">
          <h2>Keeps the page&apos;s structure</h2>
          <p>
            A Reddit thread stays a thread, a Stack Overflow answer keeps its code blocks, and a
            forum post keeps its attribution. Dedicated handling covers Reddit, YouTube, Hacker
            News, Stack Overflow, Bluesky, Facebook, Twitter/X and phpBB and SMF forums, with
            structure detection for everything else.
          </p>
        </div>
        {/* C-01 */}
        <div className="landing-feature">
          <h2>Four ways to capture</h2>
          <p>
            Save a text selection, a whole article, an entire page, or just a bookmark — from the
            toolbar icon, the right-click menu, or a keyboard shortcut.
          </p>
        </div>
        {/* C-04, C-05, C-06, C-07, C-08 */}
        <div className="landing-feature">
          <h2>Rate it yourself — or don&apos;t</h2>
          <p>
            A five-level signal scale from Toxic through Ordinary to Masterpiece, qualifier tags
            for tone, utility and longevity, a category, and a note. All of it is optional, and
            nothing is scored automatically.
          </p>
        </div>
        {/* C-09, C-14, C-16 */}
        <div className="landing-feature">
          <h2>Your library, in your browser</h2>
          <p>
            Clips are stored locally in your own browser, and no account is needed to start.
            Export everything as JSON, or import what you already have — including Evernote
            exports.
          </p>
        </div>
        {/* C-10, C-11, C-18 */}
        <div className="landing-feature">
          <h2>Publish your picks, if you want</h2>
          <p>
            At capture time you choose: keep a clip local, publish it to Nostr, or both. A
            published post is signed with your own key, and its rating travels as labels other
            Nostr clients can read.
          </p>
        </div>
        {/* C-15 */}
        <div className="landing-feature">
          <h2>No algorithm on Explore</h2>
          <p>
            Filter public posts by signal level, qualifier, category, or the people you follow;
            narrow to what&apos;s unread, or search. Nothing decides what you see — you do.
          </p>
        </div>
      </section>

      <section
        style={{
          maxWidth: 720,
          margin: '0 auto',
          padding: '28px 32px 80px',
          fontFamily: 'var(--serif)',
          color: 'var(--ink-2)',
          fontSize: 17,
          lineHeight: 1.65,
        }}
      >
        <h2 style={{ ...h2, margin: '0 0 16px', fontSize: 26 }}>What a post is</h2>
        {/* C-04, C-05, C-06, C-07, C-10 */}
        <p style={p}>
          A <strong>post</strong> is a clip someone chose to publish from the extension. It can
          carry their assessment — a <strong>Signal</strong> rating, <strong>Qualifier</strong>{' '}
          tags and a <strong>Category</strong> — or just the clip itself. Clips nobody publishes
          stay private, in the browser that saved them.
        </p>
        <p style={{ ...p, fontSize: 15, color: 'var(--ink-3)' }}>
          Clips are local and private, but not encrypted — that&apos;s designed and not yet built.
        </p>

        <h2 style={h2}>What&apos;s planned</h2>
        <p style={{ margin: '0 0 12px' }}>
          <strong>Tipping.</strong> Send a small amount of Bitcoin straight to someone whose post
          you valued — so praising good work can mean more than a click.
        </p>
        <p style={p}>
          <strong>Voting.</strong>{' '}Agree or disagree with someone else&apos;s assessment — turning
          one reader&apos;s rating into a shared sense of whose judgement is worth trusting.
        </p>

        {/* C-17 */}
        <h2 style={h2}>Privacy</h2>
        <p style={p}>
          There are no analytics in the extension. This website counts visits with GoatCounter,
          which uses no cookies and collects no personal data.{' '}
          <Link href="/privacy" style={link}>Privacy policy →</Link>
        </p>

        <div style={{ marginTop: 36 }}>
          <InstallButton event="install-extension-landing-footer" />
        </div>

        <p style={{ margin: '32px 0 0', paddingTop: 24, borderTop: '1px solid var(--rule)', fontSize: 15 }}>
          Chrome and Chromium browsers; Firefox, Android and iOS are planned. Free, open source,
          no ads. Wirthy is a small, independent project. If something is broken or missing,{' '}
          <Link href="/feedback" style={link}>tell us — or help keep it going →</Link>
        </p>
      </section>

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
