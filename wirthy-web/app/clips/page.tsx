'use client';

import { useState, useEffect, useLayoutEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import TopBar from '@/components/chrome/TopBar';
import Library from '@/components/clips/Library';
import SignInModal from '@/components/auth/SignInModal';
import { useNostrAuth } from '@/hooks/useNostrAuth';
import { useBridgeAuth } from '@/hooks/useBridgeAuth';

function LibraryWithClipId({ searchQuery }: { searchQuery: string }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialClipId = searchParams.get('clip') ?? undefined;
  const initialFullscreen = !!initialClipId && searchParams.get('fullscreen') === '1';

  // Remove ?clip= from the URL immediately after reading it so the address bar
  // stays clean and back-button history isn't polluted. A fullscreen URL is left
  // for DetailPanel, which keeps it while the clip is open.
  useEffect(() => {
    if (initialClipId && !initialFullscreen) {
      router.replace('/clips', { scroll: false });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Library has rendered its own fullscreen cover by now; lift the pre-paint style
  // (added by app/clips/layout.tsx).
  useLayoutEffect(() => {
    document.getElementById('clip-fullscreen-cover')?.remove();
  }, []);

  return <Library initialClipId={initialClipId} initialFullscreen={initialFullscreen} searchQuery={searchQuery} />;
}

export default function LibraryPage() {
  const { auth, signInPubkey, setNip07Connected } = useNostrAuth();
  const { extensionPresent } = useBridgeAuth();
  const [signInOpen, setSignInOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <div className="feed-page">
      <TopBar
        auth={auth}
        onSignIn={() => setSignInOpen(true)}
        searchPlaceholder="Search your clips…"
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        extensionPresent={extensionPresent}
      />
      <Suspense fallback={<Library />}>
        <LibraryWithClipId searchQuery={searchQuery} />
      </Suspense>
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
