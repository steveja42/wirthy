// Static server shell for the Explore feed route (/explore). Delegates all
// client behaviour (Nostr feed, auth, first-visit popover) to ExploreClient.

import type { Metadata } from 'next';
import ExploreClient from './ExploreClient';

export const metadata: Metadata = {
  title: 'Explore',
  description:
    'Public posts from Wirthy: clips people rated and published to Nostr. Filter by signal, qualifier, category, or who you follow.',
  alternates: { canonical: '/explore' },
};

export default function Explore() {
  return <ExploreClient />;
}
