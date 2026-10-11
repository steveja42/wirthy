// sitemap.xml for the static routes, emitted as a static file by the export.

import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

const BASE = 'https://wirthy.app';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${BASE}/`, changeFrequency: 'monthly', priority: 1 },
    { url: `${BASE}/explore`, changeFrequency: 'daily', priority: 0.8 },
    { url: `${BASE}/l/clipper`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE}/l/nostr`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE}/feedback`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${BASE}/privacy`, changeFrequency: 'yearly', priority: 0.3 },
  ];
}
