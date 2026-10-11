// Metadata only — the page is a client component and can't export it itself.

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: { absolute: 'Wirthy — your judgement, under your own Nostr key' },
  description:
    'Clip anything on the web, rate it yourself, and publish that evaluation to Nostr as a signed note. Private clips stay in your browser unless you cast them.',
  alternates: { canonical: '/l/nostr' },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
