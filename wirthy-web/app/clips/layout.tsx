// Metadata only — the page is a client component and can't export it itself.

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'My Clips',
  // A private, per-browser library: nothing in it is public, so keep it out of search.
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
