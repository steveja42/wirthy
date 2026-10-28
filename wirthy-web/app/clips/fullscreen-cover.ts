// The exported HTML is the split view (the query is unknown at build time), so a fullscreen
// URL hides it before first paint; app/clips/page.tsx removes the style once React renders.
// A <style> in <head>, not an <html> attribute: React skips extra head nodes but reports a
// changed attribute as a hydration mismatch.
export const FULLSCREEN_COVER_ID = 'clip-fullscreen-cover';

// Mounted by the ROOT layout: it is only ever hydrated, while a <script> React creates on the
// client (a soft navigation into /clips) never runs and logs a console error.
export const FULLSCREEN_COVER_SCRIPT = `(function(){if(!/^\\/clips\\/?$/.test(location.pathname))return;var p=new URLSearchParams(location.search);if(!p.get('clip')||p.get('fullscreen')!=='1')return;var s=document.createElement('style');s.id='${FULLSCREEN_COVER_ID}';s.textContent='body{visibility:hidden}.detail--fullscreen{visibility:visible}';document.head.appendChild(s)})()`;
