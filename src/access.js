import crypto from 'node:crypto';

const COOKIE = 'bubble_k';

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
export function checkAccess(req, key) {
  const url = new URL(req.url, 'http://x');
  const given = url.searchParams.get('k');
  if (given !== null && same(given, key)) {
    url.searchParams.delete('k');
    return {
      ok: true,
      setCookie: `${COOKIE}=${key}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`,
      redirect: url.pathname + url.search,
    };
  }
  const cookie = cookieValue(req.headers.cookie, COOKIE);
  if (cookie !== null && same(cookie, key)) return { ok: true };
  return { ok: false };
}
