import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { createProxy } from '../src/proxy.js';
import { DENIED_HTML, cookieName } from '../src/access.js';

const KEY = 'k'.repeat(32);
const COOKIE = `${cookieName(KEY)}=${KEY}`;
const TAG = '<script src="/__bubble/widget.js" defer></script>';
const GZ = zlib.gzipSync('<body>zipped</body>');

let upstream, proxy, base, upstreamPort;
const seen = [];

const listen = (server) =>
  new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));

function get(path, headers = {}) {
  return new Promise((resolve, reject) => {
    http
      .get(base + path, { headers }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      })
      .on('error', reject);
  });
}

before(async () => {
  upstream = http.createServer((req, res) => {
    seen.push({ url: req.url, headers: req.headers });
    if (req.url === '/page') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': 24,
        'content-security-policy': "script-src 'nonce-abc'",
        'content-security-policy-report-only': "default-src 'none'",
      });
      res.end('<body><h1>é</h1></body>');
    } else if (req.url.startsWith('/moved')) {
      const to = new URL(req.url, 'http://x').searchParams.get('to').replace('PORT', upstreamPort);
      res.writeHead(302, { location: to });
      res.end();
    } else if (req.url === '/cached') {
      res.writeHead(200, { 'content-type': 'text/css', 'cache-control': 'max-age=31536000, immutable' });
      res.end('a{}');
    } else if (req.url === '/data') {
      res.writeHead(200, { 'content-type': 'application/json', 'content-security-policy': 'x' });
      res.end('{"a":"</body>"}');
    } else if (req.url === '/zipped') {
      res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
      res.end(GZ);
    } else {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('nope');
    }
  });
  upstream.on('upgrade', (req, socket) => {
    const accept = crypto
      .createHash('sha1')
      .update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.on('data', (d) => socket.write(d)); // raw echo is enough to prove the pipe
    socket.on('end', () => socket.end());
    socket.on('error', () => {});
  });
  upstreamPort = await listen(upstream);
  proxy = createProxy({
    targetPort: upstreamPort,
    key: KEY,
    handleApi: (req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('api:' + req.url);
    },
  });
  base = `http://127.0.0.1:${await listen(proxy)}`;
});

after(() => {
  proxy.closeAllConnections?.();
  proxy.close();
  upstream.closeAllConnections?.();
  upstream.close();
});

test('html gets the tag and a correct content-length', async () => {
  const r = await get('/page', { cookie: COOKIE });
  assert.equal(r.status, 200);
  assert.equal(r.body.toString(), `<body><h1>é</h1>${TAG}</body>`);
  assert.equal(Number(r.headers['content-length']), r.body.length);
});

test('html loses its content-security-policy headers', async () => {
  const r = await get('/page', { cookie: COOKIE });
  assert.equal(r.headers['content-security-policy'], undefined);
  assert.equal(r.headers['content-security-policy-report-only'], undefined);
});

test('json passes through untouched and keeps its headers', async () => {
  const r = await get('/data', { cookie: COOKIE });
  assert.equal(r.body.toString(), '{"a":"</body>"}');
  assert.equal(r.headers['content-security-policy'], 'x');
});

test('compressed html passes through byte-identical', async () => {
  const r = await get('/zipped', { cookie: COOKIE });
  assert.ok(r.body.equals(GZ));
  assert.equal(r.headers['content-encoding'], 'gzip');
});

test('upstream is asked for uncompressed responses', async () => {
  await get('/data', { cookie: COOKIE, 'accept-encoding': 'gzip, br' });
  assert.equal(seen.at(-1).headers['accept-encoding'], 'identity');
});

test('the access cookie is not passed on to the dev server', async () => {
  await get('/data', { cookie: `a=1; ${COOKIE}; b=2` });
  assert.equal(seen.at(-1).headers.cookie, 'a=1; b=2');
});

test('redirects that point at the dev server itself are made relative', async () => {
  const to = (t) => get('/moved?to=' + encodeURIComponent(t), { cookie: COOKIE }).then((r) => r.headers.location);
  assert.equal(await to('http://localhost:PORT/new?x=1'), '/new?x=1');
  assert.equal(await to('http://127.0.0.1:PORT/'), '/');
  assert.equal(await to('http://localhost:PORT'), '/');
  assert.equal(await to('/already/relative'), '/already/relative');
  assert.equal(await to('https://example.com/elsewhere'), 'https://example.com/elsewhere');
  assert.equal(await to('http://localhost:1/other-port'), 'http://localhost:1/other-port');
});

test('no cookie is refused on pages', async () => {
  const r = await get('/page');
  assert.equal(r.status, 403);
  assert.equal(r.body.toString(), DENIED_HTML);
});

test('no cookie is refused on bubble routes', async () => {
  const r = await get('/__bubble/events');
  assert.equal(r.status, 403);
  assert.equal(r.body.toString(), DENIED_HTML);
});

test('the right key redirects with the cookie', async () => {
  const r = await get(`/page?k=${KEY}`);
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, '/page');
  assert.ok(r.headers['set-cookie'][0].startsWith(`${cookieName(KEY)}=${KEY}; HttpOnly`));
});

test('bubble routes reach the api handler', async () => {
  const r = await get('/__bubble/x', { cookie: COOKIE });
  assert.equal(r.body.toString(), 'api:/__bubble/x');
});

function upgrade(headers) {
  return new Promise((resolve, reject) => {
    const port = Number(new URL(base).port);
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(
        'GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n' +
          headers +
          '\r\n',
      );
    });
    let text = '';
    socket.on('data', (d) => {
      text += d.toString();
      if (text.includes('101') && !text.includes('ping')) socket.write('ping');
      if (text.includes('ping') || text.includes('403')) {
        socket.destroy();
        resolve(text);
      }
    });
    socket.on('error', reject);
    socket.on('close', () => resolve(text));
  });
}

test('websocket works through the proxy with the cookie', async () => {
  const text = await upgrade(`Cookie: ${COOKIE}\r\n`);
  assert.match(text, /^HTTP\/1\.1 101/);
  assert.match(text, /ping$/);
});

test('websocket is refused without the cookie', async () => {
  const text = await upgrade('');
  assert.match(text, /^HTTP\/1\.1 403/);
});

test('dev server down gives a plain 502 and the proxy keeps working', async () => {
  const lonely = createProxy({ targetPort: 1, key: KEY, handleApi: (q, s) => s.end('api') });
  const port = await listen(lonely);
  const saved = base;
  base = `http://127.0.0.1:${port}`;
  try {
    const r = await get('/page', { cookie: COOKIE });
    assert.equal(r.status, 502);
    assert.match(r.body.toString(), /The preview isn't running right now\./);
    const again = await get('/__bubble/x', { cookie: COOKIE });
    assert.equal(again.body.toString(), 'api');
  } finally {
    base = saved;
    lonely.close();
  }
});

test('a local-only proxy hands out the cookie without Secure', async () => {
  const local = createProxy({ targetPort: upstreamPort, key: KEY, handleApi() {}, secureCookie: false });
  const port = await listen(local);
  const saved = base;
  base = `http://127.0.0.1:${port}`;
  try {
    const r = await get(`/page?k=${KEY}`);
    assert.equal(r.status, 302);
    assert.doesNotMatch(r.headers['set-cookie'][0], /Secure/);
  } finally {
    base = saved;
    local.close();
  }
});

test('responses with no caching rules are checked again on every load', async () => {
  const r = await get('/data', { cookie: COOKIE });
  assert.equal(r.headers['cache-control'], 'no-cache');
});

test("a dev server's own caching rules are kept", async () => {
  const r = await get('/cached', { cookie: COOKIE });
  assert.equal(r.headers['cache-control'], 'max-age=31536000, immutable');
});
