/**
 * services.js — every external HTTP call in one place.
 *
 * Anthropic and listing-fetch calls are proxied through the Cloudflare Worker
 * so no API key is ever stored in the browser. To point at a different Worker,
 * change WORKER_BASE only.
 *
 * GitHub Gist calls go directly to the GitHub API (authenticated with the
 * user's personal access token stored in localStorage).
 */

const WORKER_BASE = 'https://apt-hunter-proxy.stevebryant.workers.dev';
const GITHUB_API  = 'https://api.github.com';

// ── Anthropic (via Worker) ─────────────────────────────────────────────────

/**
 * POST a messages payload to the Anthropic API via the Worker proxy.
 * The Worker injects the API key — no key is needed in the browser.
 * Returns the full parsed response object. Throws on non-2xx.
 */
export async function callAnthropicMessages(payload) {
  const res = await fetch(`${WORKER_BASE}/anthropic`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Send plain-text listing page content to Claude and extract structured fields.
 * Returns a parsed object with keys: priceMxn, sizeSqm, bedrooms, bathrooms,
 * parking, amenities, neighborhood. Missing fields are null.
 */
export async function extractListingFromText(pageText) {
  const prompt =
    'Extract real estate listing details from the webpage text below. '
    + 'Return ONLY a JSON object with exactly these keys (null for any not found):\n'
    + '{"priceMxn":"price as plain string e.g. 15000 or 15,000/mes",'
    + '"sizeSqm":"numeric m² as string","bedrooms":"count as string",'
    + '"bathrooms":"count as string","parking":"count as string",'
    + '"amenities":"comma-separated list","neighborhood":"colonia or neighborhood name"}\n\n'
    + 'Webpage text:\n' + pageText;

  const payload = {
    model: 'claude-sonnet-4-5',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  };
  const data = await callAnthropicMessages(payload);
  const raw  = data?.content?.[0]?.text || '';
  const m    = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || raw.match(/(\{[\s\S]*\})/);
  return JSON.parse((m ? m[1] : raw).trim());
}

// ── Listing URL fetch (via Worker) ─────────────────────────────────────────

/**
 * Fetch a remote URL's raw content through the Worker edge.
 * Bypasses browser CORS restrictions. Returns the response body as text.
 */
export async function fetchUrlViaWorker(url) {
  const res = await fetch(`${WORKER_BASE}/fetch?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error(`No se pudo obtener la página (${res.status})`);
  return res.text();
}

// ── GitHub Gist (direct) ───────────────────────────────────────────────────

export function _ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };
}

/**
 * List gists for the authenticated user (100 per page).
 * Returns the parsed array of gist summary objects.
 */
export async function ghListGists(token, page = 1) {
  const res = await fetch(`${GITHUB_API}/gists?per_page=100&page=${page}`, {
    headers: _ghHeaders(token),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  return res.json();
}

/**
 * Fetch a single gist by ID.
 * Returns the full parsed gist object (including file contents).
 */
export async function ghGetGist(token, gistId) {
  const res = await fetch(`${GITHUB_API}/gists/${gistId}`, {
    headers: _ghHeaders(token),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  return res.json();
}

/**
 * Create a new secret gist with a single file.
 * Returns the created gist object (use .id for future reads/writes).
 */
export async function ghCreateGist(token, description, fileName, content) {
  const res = await fetch(`${GITHUB_API}/gists`, {
    method: 'POST',
    headers: _ghHeaders(token),
    body: JSON.stringify({
      description,
      public: false,
      files: { [fileName]: { content } },
    }),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  return res.json();
}

/**
 * Update a single file inside an existing gist.
 * Returns the updated gist object.
 */
export async function ghUpdateGist(token, gistId, fileName, content) {
  const res = await fetch(`${GITHUB_API}/gists/${gistId}`, {
    method: 'PATCH',
    headers: _ghHeaders(token),
    body: JSON.stringify({
      files: { [fileName]: { content } },
    }),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  return res.json();
}
