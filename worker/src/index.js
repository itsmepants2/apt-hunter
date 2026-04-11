/**
 * apt-hunter-proxy — Cloudflare Worker
 *
 * Routes:
 *   POST /anthropic          Proxy to Anthropic API, injecting ANTHROPIC_API_KEY
 *   GET  /fetch?url=<url>    Fetch a remote URL server-side (solves browser CORS)
 *
 * Required Worker secret (set via `wrangler secret put ANTHROPIC_API_KEY`):
 *   ANTHROPIC_API_KEY
 *
 * Optional environment variable (wrangler.toml [vars] or dashboard):
 *   ALLOWED_ORIGIN  — restricts CORS to a specific origin (defaults to *)
 */

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

// ── CORS helpers ──────────────────────────────────────────────────────────────

function corsHeaders(env, req) {
  const allowed = env.ALLOWED_ORIGIN || '*';
  const origin  = allowed === '*' ? '*' : (req.headers.get('Origin') === allowed ? allowed : null);
  if (!origin) return null; // origin not permitted
  return {
    'Access-Control-Allow-Origin':  origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key, anthropic-version',
    'Access-Control-Max-Age':       '86400',
  };
}

function withCors(response, headers) {
  const r = new Response(response.body, response);
  for (const [k, v] of Object.entries(headers)) r.headers.set(k, v);
  return r;
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

function err(message, status = 400, extraHeaders = {}) {
  return json({ error: message }, status, extraHeaders);
}

// ── Route handlers ────────────────────────────────────────────────────────────

/**
 * POST /anthropic
 * Accepts the same JSON body as POST /v1/messages.
 * Injects ANTHROPIC_API_KEY from the Worker secret so the client never
 * needs to hold the key.
 */
async function handleAnthropic(req, env) {
  if (!env.ANTHROPIC_API_KEY) {
    return err('ANTHROPIC_API_KEY secret not configured', 500);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return err('Invalid JSON body');
  }

  const upstream = await fetch(ANTHROPIC_API, {
    method:  'POST',
    headers: {
      'Content-Type':       'application/json',
      'x-api-key':          env.ANTHROPIC_API_KEY,
      'anthropic-version':  req.headers.get('anthropic-version') || '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  // Stream the upstream response back, preserving status code
  return new Response(upstream.body, {
    status:  upstream.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * GET /fetch?url=<url>
 * Fetches the given URL from the Worker edge (no browser CORS restrictions)
 * and returns the response body as plain text.
 * Only allows http/https schemes.
 */
async function handleFetch(req) {
  const { searchParams } = new URL(req.url);
  const target = searchParams.get('url');

  if (!target) return err('Missing ?url= parameter');

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return err('Invalid URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return err('Only http and https URLs are allowed');
  }

  let upstream;
  try {
    upstream = await fetch(target, {
      headers: {
        // Mimic a real browser to avoid bot-detection on listing sites
        'User-Agent': 'Mozilla/5.0 (compatible; AptHunterBot/1.0)',
        'Accept':     'text/html,application/xhtml+xml,*/*',
      },
      redirect: 'follow',
    });
  } catch (e) {
    return err(`Failed to fetch URL: ${e.message}`, 502);
  }

  const contentType = upstream.headers.get('Content-Type') || '';
  const text = await upstream.text();

  return new Response(text, {
    status: upstream.status,
    headers: { 'Content-Type': contentType || 'text/plain;charset=UTF-8' },
  });
}

// ── Main entry point ──────────────────────────────────────────────────────────

export default {
  async fetch(req, env) {
    const cors = corsHeaders(env, req);

    // Reject disallowed origins (when ALLOWED_ORIGIN is set and doesn't match)
    if (cors === null) {
      return new Response('Forbidden', { status: 403 });
    }

    // Handle preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const { pathname } = new URL(req.url);

    let response;
    if (pathname === '/anthropic' && req.method === 'POST') {
      response = await handleAnthropic(req, env);
    } else if (pathname === '/fetch' && req.method === 'GET') {
      response = await handleFetch(req);
    } else {
      response = err(`Unknown route: ${req.method} ${pathname}`, 404);
    }

    return withCors(response, cors);
  },
};
