import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { createCamera, findChrome } from '../src/screenshot.js';

const chrome = findChrome();

// Width and height straight from a PNG's header.
function pngSize(file) {
  const b = fs.readFileSync(file);
  assert.equal(b.subarray(1, 4).toString(), 'PNG');
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

// The colour of one pixel is not needed: size and a successful decode by
// Chrome itself are what this checks.
async function site(t) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><body style="margin:0;height:3000px">
      <div style="position:absolute;left:40px;top:1500px;width:200px;height:100px;background:red">${req.url}</div></body>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  return server.address().port;
}

test('findChrome finds a Chrome-like browser on this Mac, or says there is none', () => {
  assert.ok(chrome === null || fs.existsSync(chrome));
});

test('a shot is cropped to the area asked for, even far down the page', { skip: !chrome && 'no Chrome here' }, async (t) => {
  const port = await site(t);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-shot-'));
  const camera = createCamera({ targetPort: port, dir, chromePath: chrome });
  t.after(() => camera.close());
  const file = await camera.shoot({ path: '/pricing?x=1', width: 1000, height: 700, clip: { x: 20, y: 1480, width: 300, height: 160 }, name: 'before' });
  assert.equal(path.dirname(file), dir);
  assert.deepEqual(pngSize(file), { width: 300, height: 160 });
  const again = await camera.shoot({ path: '/', width: 800, height: 600, name: 'after' });
  assert.deepEqual(pngSize(again), { width: 800, height: 600 });
});

test('a page that cannot be reached gives no shot instead of an error', { skip: !chrome && 'no Chrome here' }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-shot-'));
  const camera = createCamera({ targetPort: 1, dir, chromePath: chrome, timeoutMs: 4000 });
  t.after(() => camera.close());
  assert.equal(await camera.shoot({ path: '/', width: 800, height: 600, name: 'x' }), null);
});

test('without Chrome there are simply no shots', async () => {
  const camera = createCamera({ targetPort: 1, dir: os.tmpdir(), chromePath: null });
  assert.equal(await camera.shoot({ path: '/', width: 800, height: 600, name: 'x' }), null);
  camera.close();
});

test('the camera says where its screenshots go', () => {
  const camera = createCamera({ targetPort: 1, dir: '/tmp/x', chromePath: null });
  assert.equal(camera.dir, '/tmp/x');
});

test('a whole-page shot fits a long page into one image', { skip: !chrome && 'no Chrome here' }, async (t) => {
  const port = await site(t);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-shot-'));
  const camera = createCamera({ targetPort: port, dir, chromePath: chrome });
  t.after(() => camera.close());
  const file = await camera.shoot({ path: '/', width: 800, height: 600, whole: true, name: 'page' });
  const size = pngSize(file);
  assert.equal(size.height, 2200); // a 3000px page, scaled down to fit
  assert.ok(size.width > 560 && size.width < 600, String(size.width));
});

// The colour of one pixel in a PNG Chrome made (8-bit RGB or RGBA).
function pixelAt(file, x, y) {
  const buf = fs.readFileSync(file);
  let o = 8;
  let w;
  let h;
  let ct;
  const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('latin1', o + 4, o + 8);
    const d = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') [w, h, ct] = [d.readUInt32BE(0), d.readUInt32BE(4), d[9]];
    if (type === 'IDAT') idat.push(d);
    o += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  for (let row = 0; row < h; row++) {
    const f = raw[row * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[row * stride + i - bpp] : 0;
      const b = row ? out[(row - 1) * stride + i] : 0;
      const c = row && i >= bpp ? out[(row - 1) * stride + i - bpp] : 0;
      let v = raw[row * (stride + 1) + 1 + i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c;
        const [pa, pb, pc] = [Math.abs(pp - a), Math.abs(pp - b), Math.abs(pp - c)];
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[row * stride + i] = v & 255;
    }
  }
  const at = y * stride + x * bpp;
  return [out[at], out[at + 1], out[at + 2]].join(',');
}

test('a shot is taken where she was scrolled to: fixed headers and scroll effects look as she saw them', { skip: !chrome && 'no Chrome here' }, async (t) => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><body style="margin:0;height:4000px;background:#fff">
      <div style="position:fixed;top:0;left:0;right:0;height:60px;background:#ff0000"></div>
      <div id="late" style="position:absolute;top:2000px;left:0;width:800px;height:200px;background:#000"></div>
      <script>new IntersectionObserver((e) => { if (e[0].isIntersecting) late.style.background = '#00ff00' }).observe(late)</script></body>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-shot-'));
  const camera = createCamera({ targetPort: server.address().port, dir, chromePath: chrome });
  t.after(() => camera.close());
  const file = await camera.shoot({
    path: '/', width: 800, height: 600, scrollX: 0, scrollY: 1950, clip: { x: 0, y: 1950, width: 800, height: 300 }, name: 'before',
  });
  assert.equal(pixelAt(file, 10, 5), '255,0,0'); // the fixed header she had on screen
  assert.equal(pixelAt(file, 10, 100), '0,255,0'); // the box that changes once scrolled into view
});
