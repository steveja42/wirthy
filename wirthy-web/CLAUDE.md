# Wirthy Web — Codebase Guide for Claude

## What this project is

Companion web app for the Wirthy Chrome extension, hosted at `wirthy.app`. It is a **read-only** surface — clipping happens only in the extension, never here.

Routes:
- `/` — product landing page (`components/landing/LandingPage.tsx`). Forwards `?signin` / `?settings` / `?popover` to `/explore`, query intact — it used to be a redirect to the feed, and those deep links may still arrive here.
- `/explore` — public Explore feed (Nostr `kind:1` + `kind:30023` events tagged `#wirthy`). Renamed from `/home` on 2026-10-07; `netlify.toml` 301s `/home` (and `/discerns`) here, and `stripWirthyCta` strips BOTH the `/home` and `/explore` cast CTAs, because published casts are permanent.
- `/about` — folded into `/`; `netlify.toml` 301s it. The extension's background signing tab opens `/` now.
- `/c/<id>` — public cast page shell (`app/c/page.tsx` → `out/c.html`). A plain route, NOT `app/c/[id]`: under `output: 'export'`, `next dev` validates the ORIGINAL path against `generateStaticParams` even after a rewrite and 500s. Dev reaches the shell through a dev-only rewrite in `next.config.ts`; production through the `share-page` function, which fetches `/c.html` itself. **There is deliberately no `/c/* → /c.html` rewrite in `netlify.toml`:** with the function's `preferStatic: true`, a rewrite onto an existing file counts as a static match, so the shell was served and the function never ran (measured live 2026-10-11: no `x-robots-tag`, the CDN's own `charset=UTF-8`). `out/c/__next.*.txt` are RSC payloads, and `preferStatic` is what keeps the function from shadowing them.
- `/p/<npub>` — publisher page: the Explore feed locked to one author. Same one-shell pattern (`app/p/page.tsx` → `out/p.html`). See "Shareable URLs" below.
- `/clips` — user's private Clips, delivered via extension postMessage bridge. `?clip=<id>` (the extension's deep link) selects that clip on load, then is stripped. Fullscreen pushes `/clips?clip=<id>&fullscreen=1` the same way a cast pushes `/c/<id>` (`DetailPanel`'s `fullscreenHref`), and landing on that URL (a reload) reopens it: `startFullscreen` rewrites the entry to `/clips` and pushes the fullscreen URL back, so Back returns to the Library rather than leaving the site. **No split-view flash on that landing** takes three pieces, because the exported `clips.html` IS the split view (`useSearchParams` sits behind a Suspense fallback; the query is unknown at build time — `next dev` renders with the real query, so dev never shows the flash): an inline script in `app/clips/layout.tsx` appends a `<style id="clip-fullscreen-cover">` to `<head>` before first paint, hiding `body` except `.detail--fullscreen` (a style node, NOT an `<html>` attribute: React 19 skips extra head nodes but logs a changed `<html>` attribute as a hydration mismatch); Library renders an empty fullscreen cover until the extension delivers clips; and the panel opens in a `useLayoutEffect`. Verify against the export (`out/`), not the dev server.

**SEO.** `layout.tsx` sets `metadataBase`, the `%s — Wirthy` title template and the default Open Graph card (`public/og/default.png`, regenerate with `pnpm gen:og`). Do NOT put a `description` inside the layout's `openGraph`: Next would use it for every page's `og:description` instead of falling back to each page's own. Client-component pages get their metadata from a sibling `layout.tsx` that only exports `metadata`. `app/robots.ts` / `app/sitemap.ts` need `dynamic = 'force-static'` under export. `/clips` and the bare `/c` shell are `noindex`. A stale `.next/dev/types/validator.ts` naming a deleted route fails both `pnpm type-check` and `pnpm build`; it is generated, so delete it (`next dev` rewrites it).

## Tech stack

```
Next.js 16.2 · App Router · TypeScript strict · Turbopack
React 19
nostr-tools 2.x
pnpm
```

No CSS framework — all styling is plain CSS custom properties defined in `app/globals.css`. The token system comes from the Editorial theme: warm cream paper, deep ink text, Wirthy blue accent (`#3B82F6`).

## Key architectural rules

- **No clip creation UI.** The `+` button must never appear. Clipping is the extension's job.
- **No backend, with two deliberate exceptions.** Everything is client-side — Nostr relays for the public feed, postMessage bridge for private clips. Server-side touches: a Netlify reverse-proxy for analytics (see Analytics), which forwards but stores nothing of ours, and **two Netlify Functions**: `netlify/functions/feedback.mts` (see Feedback function), needed because filing a GitHub issue requires holding a token, and `netlify/functions/share-page.mts` (see Shareable URLs), which injects crawler metadata into the cast/publisher shells. It is read-only and stateless, and the pages work without it.
- **WSS only** for relay connections — never `ws://`.
- **Sanitize Nostr content** before rendering — never trust raw event content as HTML. Anyone can publish a `#wirthy` event, so any event field that reaches `dangerouslySetInnerHTML` must go through `sanitizePublicHtml` (`lib/sanitize-html.ts`, DOMPurify plus the extension's `dx-*`/`tweet-*` class contract, no inline styles/forms/ids). Today that is one field — a kind-1's `quote` tag, rendered as the selection excerpt by `ExcerptHtml` in `DetailPanel.tsx` — and it was injected raw until 2026-10-12, a stored XSS on `/explore` and `/c/<id>`. The extension's capture sanitiser is no protection: a hostile event never went through the extension. `bodyHtml` is safe only because public parsing never sets it (it arrives over the origin-pinned bridge from the author's own IndexedDB); markdown is safe because `react-markdown` renders no raw HTML; React 19 blocks `javascript:` in `href`. The helper **fails closed** (returns `''` with no DOM), because DOMPurify itself returns its input unchanged there. Guarded by `tests/sanitize-html.test.tsx`, which renders a hostile signed event through `DetailPanel`.
- **Origin-pin postMessage** on the extension bridge — both sides check `e.origin`.
- **The feed's live tail must not filter on `since`.** A cast's `created_at` is its CAPTURE time (the overlay opening), which can be minutes before it is published. The signing flow even opens a fresh `/explore` tab mid-cast, and "View on Explore" only re-activates that tab. A relay drops a live event older than `since`, so with `since: now` the new cast never streamed in and only appeared after a refresh. `subscribeFeed`'s tail uses `limit: 1` instead, and the dedup discards the one replayed event. Guarded by the second test in `tests/e2e/web-feed.spec.ts`, whose mock relay applies `since`/`until` the way a real one does.
- **TypeScript strict** — no `any`.

## Analytics

Privacy-respecting traffic measurement via **GoatCounter** (cookieless, no PII, no cross-site tracking; aggregate page + download counts only). The README's "sovereignty principles" reflect this reframing — keep them in sync if the setup changes.

**Same-origin proxying (bypasses hostname-based tracker blockers).** Both the counter script and its data endpoint are first-party:
- **Script**: GoatCounter's `count.js` is **vendored** at `public/api/stats/count.js` (served at `/api/stats/count.js`). Refresh manually from `https://gc.zgo.at/count.js` if it drifts — the provenance/fetch-date is in the file header.
- **Data endpoint**: `data-goatcounter="/api/stats/count"`. Netlify reverse-proxies the **exact** path `/api/stats/count` → `https://discernedweb.goatcounter.com/count` (`status = 200`, `force = true`) in `wirthy-web/netlify.toml` (the sole Netlify config — dashboard "Package directory" = `wirthy-web`). **Match the exact path, NOT `/api/stats/*`** — a wildcard + `force` would also swallow `/api/stats/count.js` (the vendored script) and proxy it to a nonexistent `goatcounter.com/count.js`, 404-ing the loader so nothing tracks. count.js POSTs to `/api/stats/count?<query>`; the query doesn't affect path matching, so the exact rule catches the hit while `/api/stats/count.js` falls through to the static file. The site code (`discernedweb`) is a **committed literal**, never a client env var — Netlify can't interpolate env vars in redirect targets, and the browser only ever talks to same-origin `/api/stats/*` anyway.

**Code:**
- `lib/analytics.ts` — `GOATCOUNTER_ENDPOINT` / `GOATCOUNTER_SCRIPT` / `PROD_HOST` constants, the `window.goatcounter` type, `isAnalyticsHost()`, and the null-safe `countEvent(path, title)` / `countPageview(path)` helpers.
- `components/analytics/GoatCounter.tsx` (`'use client'`, mounted last in `app/layout.tsx`) — loads the script via `next/script` and reports **SPA route changes** via a `usePathname()` effect (count.js only auto-counts the initial hard load; the effect skips its first run to avoid double-counting).
- **Hostname gate**: everything is a **no-op unless `window.location.hostname === 'wirthy.app'`** — localhost and Netlify deploy previews never pollute stats. (The gate is resolved in an effect so SSR/first-render return `null` → no hydration mismatch.)
- **Extension installs**: every "Get the extension" CTA (`components/landing/LandingPage.tsx`, `components/clips/LibraryEmpty.tsx`) links to `WEB_STORE_URL` (`lib/constants.ts`) and fires `countEvent('install-extension', …)` on click (`sendBeacon`, non-blocking → the navigation still proceeds). One shared event path so the dashboard shows a single installs count. The old `/get-extension` side-load page was removed when the extension shipped to the Chrome Web Store.
- **Feedback / donate events**: `feedback-submit` (fired on the *success* transition, not on click, so the stat counts successes), `donate-lightning-copy`, `donate-paypal-complete`.

## Shareable URLs: filters, publishers, casts

**Explore filters live in the URL** (`lib/feed-url.ts`): `/explore?publisher=npub…&signal=worthwhile&category=tech&qualifier=Timeless&q=…&unread=1`. Multi-valued filters REPEAT the param (qualifier labels contain spaces and slashes, and custom ones may contain commas). `ExploreClient` owns the state, `CastFeed` is controlled, and every change is mirrored back with `history.replaceState`, keeping foreign params (`?signin`, `?settings`, `?popover`). Three things are load-bearing:
- **The URL is read in a mount effect, not a lazy initialiser**, and `useCastFeed(null)` holds off subscribing until it is: the page is prerendered without a location (a lazy read mismatches hydration), and subscribing first would send an unscoped REQ and then replace it. `web-explore-filters` asserts that no unscoped REQ is ever sent.
- **Authors and a single category narrow the REQ relay-side** (`relayScope` → NIP-01 `authors` + `#l`), because the feed only loads the newest 50 casts and "all posts by X" must not be capped by other people's activity. Signal and qualifier stay client-side: they are `l` labels too, and values within one `#l` filter are ORed. `General` is never sent relay-side, since the parser defaults an untagged cast to it.
- **A filtered view's canonical is `/explore`**, so filter permutations never compete in search.

**Publisher pages (`/p/<npub>`)** are `ExploreClient` locked to one author (path-read, never written to the query). Any change that drops that author navigates to `/explore` with the remaining filters; a malformed npub falls back to `/explore`.

**Cast pages (`/c/<naddr|note|nevent>`)**, `lib/nostr/cast-ref.ts`: a cast with a long-form companion is addressed by its kind-30023 `naddr` (matches the feed's dedup preference and survives edits); anything else by its `note` id. A kind-1 link whose long-form can be found is upgraded to it and the address bar re-written to the naddr. `fetchCast` lazy-imports the relay pool so the feed, which only builds links, doesn't pull it into prerender. `DetailPanel`'s `shareHref` adds the Share action (`ShareButton`: the system share sheet on touch devices, else a popover with a Copy link, a `nostr:` link and "Open post page") on both the feed and the cast page; `readOnly` hides delete and note editing on the cast page. **Fullscreen pushes `/c/<id>` into the address bar** (no navigation), so Back closes it and the address is shareable; every exit pops that entry. The pushed state must spread `window.history.state`: Next 16 reloads the page on a popstate whose entry lacks its `__NA` marker. That also keeps Next's `usePathname` unchanged, so GoatCounter does not count a fullscreen as a pageview.

**Crawler metadata: `netlify/functions/share-page.mts`** (`lib/share-page.ts` is the pure part). Link-preview bots and most crawlers don't run the client, so the function fetches the cast (or kind-0 profile) from `DEFAULT_RELAYS`, then injects title, description, Open Graph, canonical, robots and a short `#ssr-cast` summary into the exported shell. Rules:
- **Index only a cast with a take** (a note or a Signal), never the e2e test author. The summary carries the publisher's contribution plus a ≤300-char excerpt from the summary fields, **never the captured article markdown** (someone else's content would read as scraped). Publisher pages preview but stay `noindex`. Both shells default to `noindex`, so a function failure can't index a generic page.
- **Everything interpolated is event text**: `escapeHtml` everywhere, `<` escaped in JSON-LD, and **function replacers** in `String.replace` (a string replacement expands `$&` / `$'` from a title).
- **The verified author identity is embedded** as `<script type="application/json" id="ssr-author">` (`lib/nostr/ssr-author.ts`). Without it both the byline and the post's caster label showed an npub for ~5s: the client fetches the cast, then the kind-0, and only then checks `nostr.json` (`authorLabel` shows a NIP-05 only once verified). The function verifies the NIP-05 itself (`verifyNip05`: plain https hostname only, no IP literal or port, since the address is event text). `withSsrAuthor` uses the embedded identity until the live profile is itself verified, and only for its own pubkey.
- **Share cards:** `summary_large_image` for a post (article images are wide), `summary` for a publisher page with an avatar (square).
- **`preferStatic: true`** so `out/c/__next.*.txt` payloads are served as files. Any failure serves the unmodified shell with a 60s CDN cache; caches are 24h for a `note` (immutable) and 1h for an `naddr` / profile.
- React tolerates the injected head tags, and the placeholder is `suppressHydrationWarning` + empty `dangerouslySetInnerHTML`, so the injected summary hydrates without a mismatch. This was verified in Chromium against the real export.
- The production relays held **zero** `#t wirthy` casts on 2026-10-07, so there was nothing to index at launch.

## Feedback function

`netlify/functions/feedback.mts` turns a `/feedback` submission into a GitHub issue on the **public** `steveja42/wirthy`. It is a v2-runtime function (`.mts` → standard `Request`/`Response`) and declares `export const config = { path: '/api/feedback' }`, so it is served same-origin at that path with no `[[redirects]]` alias — `/.netlify/functions/*` is avoided because some blockers and corporate proxies filter that well-known path (same rationale as the GoatCounter proxy).

All the interesting logic lives in `lib/feedback-format.ts`, which is **pure and dependency-free** so both the browser and the function import it and it is unit-testable without a running function. Tests: `tests/feedback-format.test.ts` (the helpers) and `tests/feedback-function.test.ts` (the real handler with `fetch` stubbed — no request ever leaves the machine).

**Three spam layers, cheapest first**, so a bot never costs a network round-trip:
1. **Honeypot** — an offscreen `website` field (`position:absolute; left:-9999px`, *not* `display:none`, which some bots skip). When filled, the function returns a **fake `200 {ok:true}`** and files nothing; a 400 would teach the bot which field is the trap.
2. **Type guards + length caps + content heuristics** (≥4 URLs, or >200 chars with no whitespace).
3. **Rate limit** — in-memory, 3 per 10 min per IP. **Best-effort only**: functions are per-instance and scale horizontally. It exists for the case Turnstile does *not* cover — a human who solves challenges and submits repeatedly. Don't delete it as redundant; escalation path is Netlify Blobs.
4. **Cloudflare Turnstile**, verified last. Chosen over the reCAPTCHA key that was already on hand: reCAPTCHA fingerprints every visitor, which cuts against a privacy-preserving local-first product on precisely the page where a privacy-conscious user would notice. **Don't "simplify" back to Google.**

**Rules that must not be relaxed:**
- **Never fail open.** A missing `TURNSTILE_SECRET_KEY` returns 500 rather than skipping verification — a deploy that silently accepts everything gets discovered via spam. Guarded by a test.
- **Distinguish Turnstile outcomes.** `success:false` → 400 (client resets the widget); unreachable/timeout → 502. Conflating them tells a user holding a valid token to retry forever.
- **Neuter the message** (`neutralizeMarkdown`): `@mentions` and `#123` get a zero-width space, or a submission could mass-ping GitHub users and *close unrelated issues* via closing keywords. The `(^|[^\w])` guard keeps ordinary emails like `a@b.com` intact — that's the regex's real failure mode, and it has a test.
- **Turnstile tokens are single-use and expire (~5 min).** The form calls `turnstile.reset()` after any failed submit; without it the retry fails inexplicably. Most common integration bug — covered by a Playwright test.

**Prerequisite:** the GitHub Issues API rejects the whole request with **422 if any label does not already exist**. Seven labels are applied: `feedback`, one type label, and one `area:*`. `bug` and `enhancement` are GitHub **defaults** (present on every repo), so only these 5 need creating by hand: `feedback`, `other`, `area:extension`, `area:web`, `area:both`.

The form's `idea` maps to GitHub's `enhancement` via `GITHUB_TYPE_LABEL` in `lib/feedback-format.ts` — one fewer label to create, and `enhancement` is what anyone browsing the issue list expects. The form and the issue *title* keep saying "idea" (it reads better in the UI and the deep-link URL); only the label is translated. Covered by tests in both `feedback-format.test.ts` and `feedback-function.test.ts`, because getting it wrong is a 422 that rejects the whole submission.

**Local testing:** don't use `netlify dev` — it wants port 3000 and fights the dev server. `tests/feedback-function.test.ts` drives the real handler instead. (`tsx` mis-resolves the shared `.ts` import that Netlify's esbuild handles correctly, so a standalone tsx harness won't load it.)

**Submitting the form on `localhost:3000` fails, by design.** Netlify Functions are not part of `next dev`, so `/api/feedback` hits Next's own HTML 404 page. The function returns JSON on *every* path including errors, so **a non-JSON response means the request never reached the function** — not that GitHub or the token is misconfigured. `submitFeedback` diagnoses a local 404 explicitly rather than showing a bare "(404)", which reads misleadingly like a token problem (regression covered in `tests/support-submit.test.ts`). To exercise the real function locally, run `pnpm exec netlify functions:serve --port 9999` and set `NEXT_PUBLIC_FUNCTIONS_ORIGIN` (see `.env.example`); remember `next dev` must be **restarted** to pick up an env change.

**A 500 saying a variable "is not set"** is the never-fail-open guard, and it names the culprit (`TURNSTILE_SECRET_KEY` or `GITHUB_FEEDBACK_TOKEN`). On a deploy this almost always means one of two things: the variable was added **after** the last build (Netlify env changes don't apply to an already-built deploy — the function bundle needs a rebuild), or its **scope excludes Functions**. Both secrets must be readable in the Functions scope. `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is the opposite case — it's read at *build* time, so it must be build-scoped.

**Which account files the issues:** whoever owns `GITHUB_FEEDBACK_TOKEN` — so issues appear authored by the maintainer, not the reporter. The reporter's identity only appears in the body if they filled in the optional contact field. A **404 from GitHub** (as opposed to the local case above) means the token can't see the repo: fine-grained PATs return 404 rather than 403 so a token can't probe for private repos, so check the PAT's repository access and that it has Issues: write.

**Donate assets:** `public/support/lightning-qr.svg` is a **committed build-time artifact** — regenerate with `pnpm gen:qr` after changing `LIGHTNING_ADDRESS` in `lib/support.ts` (the script reads the address from there rather than duplicating it). Its black-on-white is baked into the SVG **on purpose**: scanners need dark modules on a light field, so it must not follow the theme into dark mode. Don't tokenise those colours.

## Design system

All tokens live in `app/globals.css` under `body.style-studio` (the active **Studio** theme — white surface, Plus Jakarta Sans, blue accent). Do not add inline colors or hardcoded hex values — always use CSS variables. Key tokens:

```css
--paper / --paper-2 / --paper-3   /* background scale (white → #f7f7f7 → #efefef) */
--ink / --ink-2 / --ink-3 / --ink-4  /* text scale (#0d0d0d → #b0b0b0) */
--accent: #2563eb                  /* Wirthy blue */
--accent-ink: #1d4ed8              /* deeper blue for links/emphasis */
--signal: #d99814                  /* signal-star gold (rating pips + stars) */
--category: #7c3aed
--serif / --sans / --mono          /* Plus Jakarta Sans / Plus Jakarta Sans / JetBrains Mono */
```

Studio also carries component-level overrides (tighter radii, upright non-italic brand/feed-title/excerpts, 12px topbar padding) under `body.style-studio .<selector>` directly below the token block.

The design prototype lives at `C:\Users\steve\Downloads\discerned web design\design_handoff_discerned\` — reference it when making UI changes.

## Captured-clip rendering (`.clip-body` + `dx-*`)

`DetailPanel.tsx` renders a clip's captured `bodyHtml` via `dangerouslySetInnerHTML` into a `.clip-body` div. The extension's capture pipeline sanitises that HTML and stamps `dx-*` class markers (the only page-origin classes that survive sanitisation, alongside `tweet-*`). All layout for captured social-post threads lives in `app/globals.css` under `.clip-body .dx-*`:

- `dx-post` / `dx-reply` — block containers with hairline separators
- `dx-reply-row` — flex row: avatar wrapper (first child) + name/body column. Missing-avatar wrappers (`:not(:has(img))`) get an inline-SVG silhouette placeholder.
- `dx-header` — avatar + name flex row (`align-items: flex-start` so name top-aligns with avatar)
- `dx-author` — inline username + verification + handle + time (one line)
- `dx-quote` — bordered embedded-note card; `dx-quote-frag` are the `<a>` fragments inside it (sites split one quote across sibling `<a>`s) — frags get underline/border stripped
- `dx-zaps-row` / `dx-stats` — horizontal icon/amount rows

The marker contract is defined extension-side in `wirthy-ext/src/content/capture.ts` (`SITE_TAGGERS` / `tagPrimal`). When adding a marker there, add its CSS here. Verify visually with the Playwright spec `tests/e2e/primal-visual.spec.ts` (writes screenshots to `test-output/`).

## File structure

```
app/
  globals.css          ← all tokens + component styles
  layout.tsx           ← body class="style-studio"
  icon.svg             ← site icon (Next file convention); cream master, generated
  favicon.ico          ← 16/32/48/256, generated
  apple-icon.png       ← 180px, generated
  page.tsx             ← root: landing page shell (metadata + JSON-LD)
  explore/page.tsx     ← feed route (mounts ExploreClient)
  explore/ExploreClient.tsx ← client: feed + popover + modal
  c/page.tsx           ← public cast page shell (served for every /c/<id>)
  robots.ts, sitemap.ts ← static SEO files
  clips/page.tsx
  feedback/page.tsx    ← feedback form + donate (Lightning / PayPal)
  not-found.tsx        ← 404
components/
  brand/               ← MiniBeacon.tsx, HeroBeacon.tsx (do not modify SVGs)
  landing/             ← LandingPage (/) — every sentence traces to a claims.md ID
  chrome/              ← TopBar.tsx, SettingsModal.tsx
  feed/                ← CastFeed, ClipRow, DetailPanel, FilterStrip
  glyph/               ← Glyph, GlyphBars, GlyphRadial, GlyphLetter
  auth/                ← SignInModal, AuthAvatar, StatusDot, PendingSignModal
  popover/             ← FirstVisitPopover
  clips/               ← Library, LibraryEmpty, ImportDialog, JsonImportDialog
  feedback/            ← FeedbackForm, DonateSection
  analytics/           ← GoatCounter.tsx
lib/
  types.ts             ← ClipData, Capture, Evaluation, AuthState
  constants.ts         ← SIGNAL_LEVELS, QUALIFIER_GROUPS, CATEGORIES, DEFAULT_RELAYS, relay mode
  support.ts           ← donation constants, feedback endpoint + submitFeedback()
  feedback-format.ts   ← PURE validation / issue formatting, shared with the function
  analytics.ts         ← countEvent / countPageview (GoatCounter)
  logger.ts · export-utils.ts · enex-parser.ts
  mockData.ts          ← seed clips shown while Nostr connects
  nostr/               ← feed.ts, parse.ts, auth.ts, profiles.ts, follows.ts
  bridge/              ← extension-bridge.ts
hooks/
  useCastFeed.ts
  useNostrAuth.ts
  useFirstVisit.ts
  useLibraryBridge.ts  ← bridge listener for /clips, 2s timeout
netlify/functions/
  feedback.mts         ← the ONLY server-side code; own tsconfig.json
scripts/
  gen-lightning-qr.mjs ← regenerates public/support/lightning-qr.svg (`pnpm gen:qr`)
art/
  icon-small.svg       ← 16px favicon-frame master; build-time input, NOT a site icon
```

## Brand mark discipline

`MiniBeacon` and `HeroBeacon` are hand-authored SVGs — do not replace them with generic icons or library components. Their visual vocabulary (tapered tower, lattice braces, lamp dome, rays) ties the topbar to the hero. `MiniBeacon` uses `currentColor`; `HeroBeacon` hardcodes its palette.

**`MiniBeacon`'s geometry is duplicated** into the icon masters (`wirthy-ext/art/icon.svg` and `app/icon.svg`) so the navbar mark and the browser-tab favicon are provably the same drawing. Change the silhouette in one place and you must change it in all of them — see `wirthy-ext/CLAUDE.md` → Icon assets.

**Colour lives in CSS, not the component.** `.brand-mark` in `globals.css` sets `color: var(--accent-ink)` (`#1d4ed8` under `body.style-studio`) — the exact navy baked into `app/icon.svg`, so the header and the tab match. Note `--accent-ink` is *also* defined at `:root` as an oklch amber; `style-studio`, which `layout.tsx` applies to every page, is what makes the effective value blue.

## Icons and favicons

`app/favicon.ico`, `app/icon.svg`, and `app/apple-icon.png` are picked up by Next's **file convention** — there is no `metadata.icons` key in `layout.tsx` and none is needed. All three are generated; run `pnpm gen:icons` from `wirthy-ext/` (the generator writes into both projects) and read that project's CLAUDE.md for the full pipeline.

All icons are **transparent and full-bleed** — no background tile (a tab strip is near-white in light mode and near-black in dark mode, so an opaque one would show as a coloured square) and the mark is scaled to its own tight bbox so there is no wasted margin.

Two things not to trip over:

- **`public/icons/*.png` is the AZURE variant**, not the navy one the favicon uses. It backs the Nostr profile avatar that `public/.well-known/nostr.json` points at, and Nostr clients are overwhelmingly dark-themed. It is deliberately **not** a byte-mirror of the site favicon.
- **`art/icon-small.svg` is a build-time source, not a site icon.** It lives outside `app/` on purpose: Next matches icons by filename convention, and a second icon-ish file in `app/` is an easy way to publish a stray one by accident.

## Common commands

```bash
pnpm dev          # start dev server (Turbopack, port 3000)
pnpm build        # production build
pnpm exec tsc --noEmit  # type-check without building
```

## localStorage keys

| Key | Value |
|---|---|
| `wirthy.seenHero` | `"1"` when first-visit popover has been dismissed |
| `wirthy.auth` | Nostr pubkey hex string |

## Extension bridge protocol

The extension content script runs on `wirthy.app/*` and sends two message types:

```ts
{ type: 'WIRTHY_BRIDGE_HELLO'; pubkey: string | null; authMethod: ... }
{ type: 'WIRTHY_BRIDGE_CLIPS'; clips: ClipData[] }
```

The web app announces readiness by posting `{ type: 'WIRTHY_WEB_READY' }`. Origin must be `window.location.origin` on both sides.

## Nostr event shape

Wirthy casts use `kind:1` with these tags:

```
['t', 'wirthy']
['l', '<value>', 'app.wirthy.signal']     # optional — omitted when unrated
['l', '<value>', 'app.wirthy.qualifier']  # repeated, one per qualifier
['l', '<value>', 'app.wirthy.category']
['r', '<url>']
['quote', '<selected text>']
['format', 'selection' | 'article' | ...]
```
