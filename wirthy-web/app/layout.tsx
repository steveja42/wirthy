// Root layout — applies the Studio design system body class and project metadata.
// All pages share this shell; no navigation chrome is rendered here (TopBar lives per-page).

import type { Metadata } from 'next';
import './globals.css';
import { ClipStoreProvider } from '@/lib/bridge/ClipStoreContext';
import { NostrAuthProvider } from '@/hooks/useNostrAuth';
import PendingSignModal from '@/components/auth/PendingSignModal';
import GoatCounter from '@/components/analytics/GoatCounter';

// Site-wide defaults. Pages override title/description; the template keeps the brand suffix.
const DESCRIPTION =
  "Web clipper that keeps the page's real layout. Rate and tag what you save; publish your picks to Nostr if you want.";

export const metadata: Metadata = {
  metadataBase: new URL('https://wirthy.app'),
  title: {
    default: 'Wirthy — a web clipper that keeps the layout',
    template: '%s — Wirthy',
  },
  description: DESCRIPTION,
  openGraph: {
    // No description here: Next fills og:/twitter:description from each page's own.
    siteName: 'Wirthy',
    type: 'website',
    images: [{ url: '/og/default.png', width: 1200, height: 630, alt: 'Wirthy — clip anything on the web, rate it, keep it' }],
  },
  twitter: { card: 'summary_large_image' },
};


export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="style-studio">
<NostrAuthProvider>
          <ClipStoreProvider>{children}</ClipStoreProvider>
          <PendingSignModal />
        </NostrAuthProvider>
        <GoatCounter />
      </body>
    </html>
  );
}
