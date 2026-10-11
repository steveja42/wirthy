// Metadata only — the page is a client component and can't export it itself.

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Feedback & support',
  description: 'Report a bug or suggest an idea for the Wirthy extension or website, or help keep the project going.',
  alternates: { canonical: '/feedback' },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
