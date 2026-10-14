// Metadata only — the page is a client component and can't export it itself.

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'My Clips',
  // A private, per-browser library: nothing in it is public, so keep it out of search.
  robots: { index: false, follow: false },
};

// The exported HTML is the split view (the query is unknown at build time), so a fullscreen
// URL hides it before first paint; app/clips/page.tsx removes the style once React renders.
// A <style> in <head>, not an <html> attribute: React skips extra head nodes but reports a
// changed attribute as a hydration mismatch.
const FULLSCREEN_COVER_ID = 'clip-fullscreen-cover';
const FULLSCREEN_MARKER = `(function(){var p=new URLSearchParams(location.search);if(!p.get('clip')||p.get('fullscreen')!=='1')return;var s=document.createElement('style');s.id='${FULLSCREEN_COVER_ID}';s.textContent='body{visibility:hidden}.detail--fullscreen{visibility:visible}';document.head.appendChild(s)})()`;

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: FULLSCREEN_MARKER }} />
      {children}
    </>
  );
}
