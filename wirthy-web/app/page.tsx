// Root route (/) — the product landing page. A server shell so the metadata and
// JSON-LD ship in the static HTML; the page body lives in LandingPage.

import type { Metadata } from 'next';
import LandingPage from '@/components/landing/LandingPage';
import { WEB_STORE_URL } from '@/lib/constants';

export const metadata: Metadata = {
  title: { absolute: 'Wirthy — a web clipper that keeps the layout, with optional publishing to Nostr' },
  description:
    "Clip anything on the web with its real layout intact, rate it yourself, and keep it in your own browser — or publish your picks to Nostr, signed with your key.",
  alternates: { canonical: '/' },
};

const JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Wirthy',
  applicationCategory: 'BrowserApplication',
  operatingSystem: 'Chrome',
  description:
    "Web clipper that keeps the page's real layout. Rate and tag what you save; publish your picks to Nostr if you want.",
  url: 'https://wirthy.app/',
  downloadUrl: WEB_STORE_URL,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        // Static, trusted content — but escape `<` anyway so the pattern is safe to copy.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD).replace(/</g, '\\u003c') }}
      />
      <LandingPage />
    </>
  );
}
