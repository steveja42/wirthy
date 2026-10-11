// Metadata only — the page is a client component and can't export it itself.

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: { absolute: 'Wirthy — a web clipper that keeps the page, not a flat copy of it' },
  description:
    'Clip Reddit threads, Stack Overflow answers, forum posts and articles with their structure intact. Rate and tag what you save; it stays in your own browser.',
  alternates: { canonical: '/l/clipper' },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
