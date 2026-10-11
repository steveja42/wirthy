// robots.txt, emitted as a static file by the export.
// /clips is a private per-browser library. /c/* stays crawlable on purpose: each cast
// page declares its own index/noindex, and a disallow would hide that from crawlers.

import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/clips'] }],
    sitemap: 'https://wirthy.app/sitemap.xml',
  };
}
