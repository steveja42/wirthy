// Static shell for publisher pages (/p/<npub>): the Explore feed locked to one publisher.
// One exported file (/p.html) serves every /p/* path, exactly like the /c cast shell.

import type { Metadata } from 'next';
import ExploreClient from '@/app/explore/ExploreClient';

// noindex by default: the shell alone is generic, so only the share-page function
// (which knows the publisher) may upgrade a page to indexable.
export const metadata: Metadata = {
  title: 'Publisher',
  robots: { index: false, follow: true },
};

export default function PublisherPage() {
  return <ExploreClient />;
}
