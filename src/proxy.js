import http from 'node:http';
import net from 'node:net';
import { checkAccess, DENIED_HTML } from './access.js';
import { inject } from './inject.js';

const DOWN_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Preview not running</title>
<style>body{font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;background:#fafafa;color:#222}
@media (prefers-color-scheme:dark){body{background:#161616;color:#eee}}</style></head>
<body><p>The preview isn't running right now. Try again in a minute.</p></body></html>
`;

/** Drop our own cookie so the project's server never sees the access key. */
function withoutAccessCookie(header) {
  if (!header) return undefined;
  const kept = header
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith('bubble_k='));
  return kept.length ? kept.join('; ') : undefined;
}

function upstreamHeaders(req, targetPort) {
  const headers = { ...req.headers };
  headers.host = `localhost:${targetPort}`;
  headers['accept-encoding'] = 'identity';
  const cookie = withoutAccessCookie(headers.cookie);
  if (cookie === undefined) delete headers.cookie;
  else headers.cookie = cookie;
  return headers;
}

/** A redirect to the dev server's own address would send a visitor to their own machine. */
function localRedirect(location, targetPort) {
  const match = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]):(\d+)(\/.*)?$/i.exec(String(location));
  if (!match || Number(match[2]) !== targetPort) return location;
  return match[3] || '/';
}

function sendHtml(res, status, html, extra = {}) {
  const body = Buffer.from(html);
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
    ...extra,
  });
  res.end(body);
}

function forward(req, res, targetPort) {
  const up = http.request(
    { host: 'localhost', port: targetPort, method: req.method, path: req.url, headers: upstreamHeaders(req, targetPort) },
    (upRes) => {
      const headers = { ...upRes.headers };
      if (headers.location) headers.location = localRedirect(headers.location, targetPort);
      const type = String(headers['content-type'] || '');
      const isPlainHtml = type.startsWith('text/html') && !headers['content-encoding'];
      if (!isPlainHtml) {
        res.writeHead(upRes.statusCode, headers);
        upRes.pipe(res);
        return;
      }
      const chunks = [];
      upRes.on('data', (c) => chunks.push(c));
      upRes.on('end', () => {
        const body = Buffer.from(inject(Buffer.concat(chunks).toString('utf8')));
        delete headers['content-security-policy'];
        delete headers['content-security-policy-report-only'];
        delete headers['transfer-encoding'];
        headers['content-length'] = body.length;
        res.writeHead(upRes.statusCode, headers);
        res.end(body);
      });
      upRes.on('error', () => res.destroy());
    },
  );
  up.on('error', () => {
    if (res.headersSent) res.destroy();
    else sendHtml(res, 502, DOWN_HTML);
  });
  req.pipe(up);
}

function forwardUpgrade(req, socket, head, targetPort) {
  const up = net.connect({ host: 'localhost', port: targetPort }, () => {
    const headers = upstreamHeaders(req, targetPort);
    delete headers['accept-encoding'];
    let text = `${req.method} ${req.url} HTTP/1.1\r\n`;
    for (const [name, value] of Object.entries(headers)) {
      for (const v of Array.isArray(value) ? value : [value]) text += `${name}: ${v}\r\n`;
    }
    up.write(text + '\r\n');
    if (head?.length) up.write(head);
    up.pipe(socket);
    socket.pipe(up);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
}

/**
 * The server visitors reach. Checks the access key, hands /__bubble/ to the
 * api, and passes everything else to the project's own dev server.
 */
export function createProxy({ targetPort, key, handleApi }) {
  const server = http.createServer((req, res) => {
    const access = checkAccess(req, key);
    if (!access.ok) return sendHtml(res, 403, DENIED_HTML);
    if (access.redirect) {
      res.writeHead(302, { location: access.redirect, 'set-cookie': access.setCookie, 'cache-control': 'no-store' });
      return res.end();
    }
    if (req.url.startsWith('/__bubble/')) return handleApi(req, res);
    forward(req, res, targetPort);
  });
  server.on('upgrade', (req, socket, head) => {
    const access = checkAccess(req, key);
    if (!access.ok || access.redirect) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    forwardUpgrade(req, socket, head, targetPort);
  });
  return server;
}
