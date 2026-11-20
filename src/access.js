import crypto from 'node:crypto';

/**
 * The cookie is named after the project's key, so two bubbles running on one
 * computer (both on localhost) do not overwrite each other's login.
 */
export function cookieName(key) {
  return 'bubble_' + crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 8);
}

export const DENIED_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Private preview</title>
<style>body{font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;background:#fafafa;color:#222}
@media (prefers-color-scheme:dark){body{background:#161616;color:#eee}}</style></head>
<body><p>This preview is private. Ask Mannas for the link.</p></body></html>
`;

function same(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function cookieValue(header, name) {
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i !== -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/**
 * Decide whether a request may pass. The right ?k= sets the cookie and asks
 * for a redirect to the same address without the key in it.
 */
export function checkAccess(req, key, { secure = true } = {}) {
  const url = new URL(req.url, 'http://x');
  const given = url.searchParams.get('k');
  if (given !== null && same(given, key)) {
    url.searchParams.delete('k');
    return {
      ok: true,
      // Secure cookies are dropped on plain http://localhost by some browsers,
      // so a local-only link leaves the flag off.
      setCookie: `${cookieName(key)}=${key}; HttpOnly; ${secure ? 'Secure; ' : ''}SameSite=Lax; Path=/; Max-Age=2592000`,
      redirect: url.pathname + url.search,
    };
  }
  const cookie = cookieValue(req.headers.cookie, cookieName(key));
  if (cookie !== null && same(cookie, key)) return { ok: true };
  return { ok: false };
}
