import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApi } from '../src/api.js';
import { openState } from '../src/state.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d5a4c40000000049454e44ae426082', 'hex');
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40)]);

async function setup(t, run = async () => ({ reply: 'ok', sessionId: 's', files: [] })) {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-img-'));
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-media-'));
  const state = openState(projectDir);
  const calls = [];
  const seen = [];
  const handler = createApi({
    state, projectDir, widgetPath: '/dev/null', mediaDir, onActivity: (e) => seen.push(e),
    run: async (job) => (calls.push(job), run(job)),
  });
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/__bubble/`;
  const upload = (bytes, type = 'image/png') => fetch(base + 'upload', { method: 'POST', headers: { 'content-type': type }, body: bytes });
  const send = (body) => fetch(base + 'send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const settled = async (n) => {
    for (let i = 0; i < 200 && state.history().length < n; i++) await sleep(10);
    return state.history();
  };
  return { base, mediaDir, upload, send, settled, calls, seen };
}

test('an image is uploaded, kept outside the project, and served back', async (t) => {
  const a = await setup(t);
  const res = await a.upload(PNG);
  assert.equal(res.status, 200);
  const { id } = await res.json();
  assert.match(id, /^[0-9a-f-]{36}\.png$/);
  assert.ok(fs.readFileSync(path.join(a.mediaDir, 'uploads', id)).equals(PNG));
  const back = await fetch(a.base + 'media/' + id);
  assert.equal(back.headers.get('content-type'), 'image/png');
  assert.equal(back.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(Buffer.from(await back.arrayBuffer()).equals(PNG));
});

test('the image type comes from its bytes, not from what the upload claims', async (t) => {
  const a = await setup(t);
  const { id } = await (await a.upload(JPG, 'image/png')).json();
  assert.match(id, /\.jpg$/);
});

test('only real images are accepted, and not too big', async (t) => {
  const a = await setup(t);
  assert.equal((await a.upload(Buffer.from('<svg onload=alert(1)>'), 'image/svg+xml')).status, 415);
  assert.equal((await a.upload(Buffer.from('hello'), 'image/png')).status, 415);
  assert.equal((await a.upload(Buffer.concat([PNG, Buffer.alloc(11 * 1024 * 1024)]))).status, 413);
  assert.equal((await fetch(a.base + 'media/../key')).status, 404);
  assert.equal((await fetch(a.base + 'media/nope.png')).status, 404);
});

test('images attached to a message reach claude and show in the chat', async (t) => {
  const a = await setup(t);
  const one = (await (await a.upload(PNG)).json()).id;
  const two = (await (await a.upload(JPG)).json()).id;
  assert.equal((await a.send({ text: 'make it look like this', images: [one, two] })).status, 202);
  const h = await a.settled(2);
  assert.deepEqual(h[0].images, [one, two]);
  assert.deepEqual(a.calls[0].images, [path.join(a.mediaDir, 'uploads', one), path.join(a.mediaDir, 'uploads', two)]);
  assert.equal(a.calls[0].shotsDir, a.mediaDir);
  assert.deepEqual(a.seen.find((e) => e.type === 'message').images, 2);
});

test('an image alone is a message too', async (t) => {
  const a = await setup(t);
  const id = (await (await a.upload(PNG)).json()).id;
  assert.equal((await a.send({ text: '', images: [id] })).status, 202);
  const h = await a.settled(2);
  assert.equal(h[0].text, '');
  assert.equal(a.calls[0].text, 'Take a look at the attached image.');
});

test('made-up, too many, or missing images are refused', async (t) => {
  const a = await setup(t);
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push((await (await a.upload(PNG)).json()).id);
  assert.equal((await a.send({ text: 'x', images: ids })).status, 400);
  assert.equal((await a.send({ text: 'x', images: ['../../key'] })).status, 400);
  assert.equal((await a.send({ text: 'x', images: ['00000000-0000-4000-8000-000000000000.png'] })).status, 400);
  assert.equal((await a.send({ text: '', images: [] })).status, 400);
});
