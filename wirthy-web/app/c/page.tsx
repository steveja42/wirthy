// Static shell for public cast pages (/c/<naddr|note|nevent>). The export emits one
// file (/c.html) that Netlify serves for every /c/* path; the client reads the id from
// the path. A plain route, not [id]: under export, `next dev` rejects unlisted params.

import type { Metadata } from 'next';
import CastPageClient from './CastPageClient';

// noindex by default: the shell alone is generic, so only the share-page function
// (which knows the cast) may upgrade a page to indexable.
export const metadata: Metadata = {
  title: 'Post',
  robots: { index: false, follow: true },
};

export default function CastPage() {
  return <CastPageClient />;
}
