// Drives the REAL GoatCounter relay (netlify/functions/count.mts) with fetch stubbed. The
// branches that matter: the visitor's IP + UA reach the API, and a failure is never a 200.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };
let upstream: number | 'unreachable' = 202;
let sent: { url: string; init?: RequestInit }[] = [];

async function load() {
  const mod = await import('../netlify/functions/count.mts');
  return mod.default;
}

function hitReq(query: string, method = 'POST') {
  return new Request(`https://wirthy.app/api/stats/count?${query}`, {
    method,
    headers: { 'user-agent': 'Mozilla/5.0 TestBrowser', 'accept-language': 'en-GB,en;q=0.9' },
  });
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, GOATCOUNTER_API_TOKEN: 'test-token' };
  upstream = 202;
  sent = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(input), init });
    if (upstream === 'unreachable') throw new Error('simulated network failure');
    return new Response(upstream === 202 ? null : '{"error":"nope"}', { status: upstream });
  }));
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

describe('count relay', () => {
  it('forwards the hit with the visitor IP and User-Agent', async () => {
    const handler = await load();
    const res = await handler(hitReq('p=%2Fexplore&t=Explore&r=https%3A%2F%2Fexample.com%2F&q=%3Fx%3D1&e=false&s=1280&b=0&rnd=abc'), { ip: '203.0.113.7' });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/gif');
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('https://discernedweb.goatcounter.com/api/v0/count');
    expect(new Headers(sent[0].init?.headers).get('authorization')).toBe('Bearer test-token');
    const body = JSON.parse(String(sent[0].init?.body));
    expect(body.hits).toEqual([{
      path: '/explore', title: 'Explore', ref: 'https://example.com/', query: '?x=1',
      size: '1280', language: 'en-GB', ip: '203.0.113.7', user_agent: 'Mozilla/5.0 TestBrowser',
    }]);
  });

  it('passes events and bot hints through', async () => {
    const handler = await load();
    await handler(hitReq('p=install-extension&t=Install&e=true&b=153', 'GET'), { ip: '203.0.113.7' });
    const [hit] = JSON.parse(String(sent[0].init?.body)).hits;
    expect(hit.event).toBe(true);
    expect(hit.bot).toBe(153);
  });

  it('rejects a hit with no path without calling GoatCounter', async () => {
    const handler = await load();
    expect((await handler(hitReq('t=x'), {})).status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it('never fails open: a missing token is a 500, not a 200', async () => {
    delete process.env.GOATCOUNTER_API_TOKEN;
    const handler = await load();
    expect((await handler(hitReq('p=%2F'), {})).status).toBe(500);
    expect(sent).toHaveLength(0);
  });

  it('reports an upstream rejection or outage as a 502', async () => {
    const handler = await load();
    upstream = 401;
    expect((await handler(hitReq('p=%2F'), {})).status).toBe(502);
    upstream = 'unreachable';
    expect((await handler(hitReq('p=%2F'), {})).status).toBe(502);
  });

  it('refuses other methods', async () => {
    const handler = await load();
    expect((await handler(hitReq('p=%2F', 'PUT'), {})).status).toBe(405);
  });
});
