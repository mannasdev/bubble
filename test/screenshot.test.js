import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
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
