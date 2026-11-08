// GoatCounter hit relay. count.js sends hits here, same-origin, so hostname-based blockers
// never see goatcounter.com; we forward each one through GoatCounter's API carrying the
// visitor's own IP + User-Agent. A plain Netlify proxy is NOT enough: GoatCounter silently
// discards hits that arrive from Netlify's IPs. See wirthy-web/CLAUDE.md → Analytics.

interface Context { ip?: string }
interface Config { path: string }

const GOATCOUNTER_API = 'https://discernedweb.goatcounter.com/api/v0/count';
const UPSTREAM_TIMEOUT_MS = 5_000;
const MAX_FIELD_CHARS = 2048;

// The 1x1 GIF count.js's <img> fallback waits for; sendBeacon ignores the body.
const GIF = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), (c) => c.charCodeAt(0));

export interface GoatCounterHit {
  path: string;
  title?: string;
  ref?: string;
  query?: string;
  event?: boolean;
  size?: number[];
  bot?: number;
  language?: string;
  ip?: string;
  user_agent?: string;
}

const field = (v: string | null) => (v ? v.slice(0, MAX_FIELD_CHARS) : undefined);

/** Map count.js's query (p, t, r, q, e, s, b) plus the request's own headers to an API hit. */
export function hitFromRequest(url: URL, headers: Headers, ip: string | undefined): GoatCounterHit | null {
  const q = url.searchParams;
  const path = field(q.get('p'));
  if (!path) return null;
  const width = Number(q.get('s'));
  const bot = Number(q.get('b'));
  return {
    path,
    title: field(q.get('t')),
    ref: field(q.get('r')),
    query: field(q.get('q')),
    event: q.get('e') === 'true' || undefined,
    size: Number.isFinite(width) && width > 0 ? [width] : undefined,
    bot: Number.isInteger(bot) && bot > 0 ? bot : undefined,
    language: headers.get('accept-language')?.split(',')[0]?.split(';')[0]?.trim() || undefined,
    ip: ip || headers.get('x-nf-client-connection-ip') || undefined,
    user_agent: field(headers.get('user-agent')),
  };
}

function gif(status: number): Response {
  return new Response(GIF, { status, headers: { 'content-type': 'image/gif', 'cache-control': 'no-store' } });
}

export default async function handler(req: Request, context: Context): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'POST') return new Response(null, { status: 405 });

  const hit = hitFromRequest(new URL(req.url), req.headers, context.ip);
  if (!hit) return gif(400);

  const token = process.env.GOATCOUNTER_API_TOKEN;
  if (!token) {
    console.error('[count] GOATCOUNTER_API_TOKEN is not set — hit dropped:', hit.path);
    return gif(500);
  }

  try {
    const res = await fetch(GOATCOUNTER_API, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ hits: [hit] }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (res.status !== 202) {
      console.error('[count] goatcounter rejected hit:', res.status, (await res.text()).slice(0, 500));
      return gif(502);
    }
    return gif(200);
  } catch (err) {
    console.error('[count] goatcounter unreachable:', err);
    return gif(502);
  }
}

export const config: Config = { path: '/api/stats/count' };
