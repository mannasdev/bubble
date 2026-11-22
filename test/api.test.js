import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApi } from '../src/api.js';
import { openState } from '../src/state.js';
import { RunError, checkPrompt } from '../src/runner.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setup(run) {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-api-'));
  const widgetPath = path.join(projectDir, 'w.js');
  fs.writeFileSync(widgetPath, '/* widget */');
  const state = openState(projectDir);
  const server = http.createServer(createApi({ state, projectDir, run, widgetPath }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = (body, raw) =>
    fetch(base + '/__bubble/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: raw ?? JSON.stringify(body),
    });
  const settled = async (count) => {
    for (let i = 0; i < 200; i++) {
      if (state.history().length >= count) return state.history();
      await sleep(10);
    }
    throw new Error(`history never reached ${count}: ${JSON.stringify(state.history())}`);
  };
  const close = () => {
    server.closeAllConnections();
    server.close();
  };
  return { projectDir, state, base, send, settled, close };
}

const okRun = async ({ text }) => ({ reply: `did: ${text}`, sessionId: 's1', files: ['index.html'] });

test('a message is accepted, answered, saved and logged', async (t) => {
  const a = await setup(okRun);
  t.after(a.close);
  const res = await a.send({ text: '  make it big  ' });
  assert.equal(res.status, 202);
  assert.equal(typeof (await res.json()).id, 'string');
  const h = await a.settled(2);
  assert.deepEqual(h.map((e) => [e.role, e.text]), [['visitor', 'make it big'], ['claude', 'did: make it big']]);
  assert.deepEqual(h[1].files, ['index.html']);
  assert.equal(a.state.session(), 's1');
  const log = fs.readFileSync(path.join(a.projectDir, '.bubble', 'log.md'), 'utf8');
  assert.match(log, /\*\*Asked:\*\* make it big/);
  assert.match(log, /\*\*Files:\*\* index\.html/);
});

test('two quick messages run one at a time, in order, sharing the session', async (t) => {
  const calls = [];
  let running = 0;
  let overlap = false;
  const a = await setup(async ({ text, sessionId }) => {
    calls.push({ text, sessionId });
    running++;
    if (running > 1) overlap = true;
    await sleep(40);
    running--;
    return { reply: 'ok ' + text, sessionId: 'sess-from-first', files: [] };
  });
  t.after(a.close);
  await Promise.all([a.send({ text: 'one' }), sleep(5).then(() => a.send({ text: 'two' }))]);
  const h = await a.settled(4);
  assert.equal(overlap, false);
  assert.deepEqual(calls, [
    { text: 'one', sessionId: null },
    { text: 'two', sessionId: 'sess-from-first' },
  ]);
  assert.deepEqual(h.filter((e) => e.role === 'claude').map((e) => e.text), ['ok one', 'ok two']);
});

test('a conversation idle for more than 12 hours starts fresh', async (t) => {
  const calls = [];
  const a = await setup(async ({ sessionId }) => {
    calls.push(sessionId);
    return { reply: 'ok', sessionId: 'new', files: [] };
  });
  t.after(a.close);
  a.state.setSession('old');
  a.state.append({ id: '0', role: 'claude', text: 'earlier', at: new Date(Date.now() - 13 * 3600_000).toISOString() });
  await a.send({ text: 'hi again' });
  await a.settled(3);
  assert.deepEqual(calls, [null]);
});

test('a stale session is retried once with a fresh one', async (t) => {
  const calls = [];
  const a = await setup(async ({ sessionId }) => {
    calls.push(sessionId);
    if (calls.length === 1) throw new RunError('stale-session');
    return { reply: 'fresh', sessionId: 'new', files: [] };
  });
  t.after(a.close);
  a.state.setSession('old');
  await a.send({ text: 'hi' });
  const h = await a.settled(2);
  assert.deepEqual(calls, ['old', null]);
  assert.equal(h[1].text, 'fresh');
  assert.equal(a.state.session(), 'new');
});

test('a failed run tells the visitor and the next message still runs', async (t) => {
  let n = 0;
  const a = await setup(async () => {
    if (++n === 1) throw new RunError('failed', 'Not logged in');
    return { reply: 'second worked', sessionId: 's', files: [] };
  });
  t.after(a.close);
  await a.send({ text: 'one' });
  await a.send({ text: 'two' });
  const h = await a.settled(4);
  assert.deepEqual(h.map((e) => [e.role, e.text]), [
    ['visitor', 'one'],
    ['error', "Something went wrong on Mannas's side. Tell him."],
    ['visitor', 'two'],
    ['claude', 'second worked'],
  ]);
});

test('an unexpected crash in the run is treated the same way', async (t) => {
  const a = await setup(async () => {
    throw new TypeError('boom');
  });
  t.after(a.close);
  await a.send({ text: 'one' });
  const h = await a.settled(2);
  assert.equal(h[1].role, 'error');
});

test('the pointed element is passed on with its html cut to 500 characters', async (t) => {
  let got;
  const a = await setup(async (job) => {
    got = job.pointed;
    return { reply: 'ok', sessionId: 's', files: [] };
  });
  t.after(a.close);
  await a.send({ text: 'this', pointed: { selector: 'h1', text: 'Hi', html: 'x'.repeat(900), extra: 1 } });
  await a.settled(2);
  assert.deepEqual(got, { selector: 'h1', text: 'Hi', html: 'x'.repeat(500) });
});

test('empty, overlong and malformed messages are refused', async (t) => {
  const a = await setup(okRun);
  t.after(a.close);
  assert.equal((await a.send({ text: '   ' })).status, 400);
  assert.equal((await a.send({ text: 'x'.repeat(2001) })).status, 400);
  assert.equal((await a.send({ text: 5 })).status, 400);
  assert.equal((await a.send(null, '{not json')).status, 400);
  assert.equal((await a.send({ text: 'x'.repeat(2000) })).status, 202);
});

test('a body over 16 KB is refused', async (t) => {
  const a = await setup(okRun);
  t.after(a.close);
  const res = await a.send({ text: 'hi', pointed: { selector: 'a', text: 'b', html: 'x'.repeat(20000) } });
  assert.equal(res.status, 413);
  assert.deepEqual(a.state.history(), []);
});

test('the widget script is served fresh', async (t) => {
  const a = await setup(okRun);
  t.after(a.close);
  const res = await fetch(a.base + '/__bubble/widget.js');
  assert.equal(await res.text(), '/* widget */');
  assert.match(res.headers.get('content-type'), /^text\/javascript/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('unknown bubble routes are 404', async (t) => {
  const a = await setup(okRun);
  t.after(a.close);
  assert.equal((await fetch(a.base + '/__bubble/nope')).status, 404);
  assert.equal((await fetch(a.base + '/__bubble/send')).status, 404);
});

test('a listener gets history first, then new entries in order, then an empty status', async (t) => {
  const a = await setup(async ({ onStatus }) => {
    onStatus('Making the change…');
    await sleep(20);
    return { reply: 'done', sessionId: 's', files: ['a.css'] };
  });
  t.after(a.close);
  a.state.append({ id: '0', role: 'visitor', text: 'earlier', at: new Date().toISOString() });
  const events = [];
  const controller = new AbortController();
  const res = await fetch(a.base + '/__bubble/events', { signal: controller.signal });
  assert.match(res.headers.get('content-type'), /^text\/event-stream/);
  (async () => {
    let buf = '';
    try {
      for await (const chunk of res.body) {
        buf += Buffer.from(chunk).toString();
        let i;
        while ((i = buf.indexOf('\n\n')) !== -1) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const name = /^event: (.*)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (name) events.push([name, JSON.parse(data)]);
        }
      }
    } catch {}
  })();
  await sleep(30);
  await a.send({ text: 'now' });
  await a.settled(3);
  await sleep(50);
  controller.abort();
  assert.equal(events[0][0], 'history');
  assert.deepEqual(events[0][1].map((e) => e.text), ['earlier']);
  assert.deepEqual(events[1], ['status', '']);
  const rest = events.slice(2).map(([n, d]) => (n === 'entry' ? `entry:${d.role}:${d.text}` : `status:${d}`));
  assert.deepEqual(rest, ['entry:visitor:now', 'status:Thinking…', 'status:Making the change…', 'entry:claude:done', 'status:']);
});

test('local-only mode tells the run that the owner is typing', async (t) => {
  let got;
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-api-'));
  const state = openState(projectDir);
  const handler = createApi({
    state, projectDir, widgetPath: '/dev/null', owner: true,
    run: async (job) => {
      got = job.owner;
      return { reply: 'ok', sessionId: 's', files: [] };
    },
  });
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  await fetch(`http://127.0.0.1:${server.address().port}/__bubble/send`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'hi' }),
  });
  for (let i = 0; i < 100 && state.history().length < 2; i++) await sleep(10);
  assert.equal(got, true);
});

test('a pointed empty space is passed on with its neighbours', async (t) => {
  let got;
  const a = await setup(async (job) => {
    got = job.pointed;
    return { reply: 'ok', sessionId: 's', files: [] };
  });
  t.after(a.close);
  await a.send({
    text: 'add a section here',
    pointed: { kind: 'space', selector: 'main', before: 'p "A"', after: 'x'.repeat(900), gap: '48px tall', html: '<b>', junk: 1 },
  });
  await a.settled(2);
  assert.deepEqual(got, { kind: 'space', selector: 'main', before: 'p "A"', after: 'x'.repeat(200), gap: '48px tall' });
});

test('an unknown kind of pointing is treated as an element', async (t) => {
  let got;
  const a = await setup(async (job) => {
    got = job.pointed;
    return { reply: 'ok', sessionId: 's', files: [] };
  });
  t.after(a.close);
  await a.send({ text: 'x', pointed: { kind: 'weird', selector: 'h1', text: 'Hi', html: '<h1>Hi</h1>' } });
  await a.settled(2);
  assert.deepEqual(got, { selector: 'h1', text: 'Hi', html: '<h1>Hi</h1>' });
});

test('the steps of a change are saved with the reply and sent live', async (t) => {
  const a = await setup(async ({ onStep }) => {
    onStep({ action: 'read', file: 'index.html' });
    onStep({ action: 'edit', file: 'index.html', before: 'hello', after: 'bye' });
    await sleep(20);
    return { reply: 'done', sessionId: 's', files: ['index.html'] };
  });
  t.after(a.close);
  const events = [];
  const controller = new AbortController();
  const res = await fetch(a.base + '/__bubble/events', { signal: controller.signal });
  (async () => {
    let buf = '';
    try {
      for await (const chunk of res.body) {
        buf += Buffer.from(chunk).toString();
        let i;
        while ((i = buf.indexOf('\n\n')) !== -1) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const name = /^event: (.*)$/m.exec(block)?.[1];
          if (name === 'step') events.push(JSON.parse(/^data: (.*)$/m.exec(block)[1]));
        }
      }
    } catch {}
  })();
  await sleep(30);
  await a.send({ text: 'go' });
  const h = await a.settled(2);
  await sleep(30);
  controller.abort();
  const steps = [
    { action: 'read', file: 'index.html' },
    { action: 'edit', file: 'index.html', before: 'hello', after: 'bye' },
  ];
  assert.deepEqual(h[1].steps, steps);
  assert.deepEqual(events, steps);
});

test('a reply carries the message it answers, cut to 200 characters', async (t) => {
  let got;
  const a = await setup(async (job) => {
    got = job.replyTo;
    return { reply: 'ok', sessionId: 's', files: [] };
  });
  t.after(a.close);
  await a.send({ text: 'darker', replyTo: 'x'.repeat(900) });
  const h = await a.settled(2);
  assert.equal(got, 'x'.repeat(200));
  assert.equal(h[0].replyTo, 'x'.repeat(200));
});

test('a listener that joins mid-change is told the steps so far', async (t) => {
  let release;
  const a = await setup(async ({ onStep }) => {
    onStep({ action: 'edit', file: 'a.css', before: '1', after: '2' });
    await new Promise((r) => (release = r));
    return { reply: 'done', sessionId: 's', files: ['a.css'] };
  });
  t.after(a.close);
  await a.send({ text: 'go' });
  await sleep(30);
  const controller = new AbortController();
  const res = await fetch(a.base + '/__bubble/events', { signal: controller.signal });
  let text = '';
  for await (const chunk of res.body) {
    text += Buffer.from(chunk).toString();
    if (text.includes('event: steps')) break;
  }
  controller.abort();
  release();
  assert.match(text, /event: steps\ndata: \[\{"action":"edit","file":"a.css","before":"1","after":"2"\}\]/);
});

test('everything that happens is reported for the owner to watch', async (t) => {
  const seen = [];
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-api-'));
  const state = openState(projectDir);
  let n = 0;
  const handler = createApi({
    state, projectDir, widgetPath: '/dev/null',
    onActivity: (e) => seen.push(e),
    run: async ({ onStep }) => {
      if (++n === 2) throw new RunError('failed', 'Not logged in');
      onStep({ action: 'edit', file: 'a.css', before: '1', after: '2' });
      return { reply: 'done', sessionId: 's', files: ['a.css'] };
    },
  });
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const post = (body) =>
    fetch(`http://127.0.0.1:${server.address().port}/__bubble/send`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
  await post({ text: 'one', pointed: { selector: 'h1', text: 'Hi', html: '<h1>' }, replyTo: 'earlier' });
  await post({ text: 'two' });
  for (let i = 0; i < 100 && state.history().length < 4; i++) await sleep(10);
  assert.deepEqual(seen.filter((e) => e.type === 'status').map((e) => e.text), ['Thinking…', '', 'Thinking…', '']);
  assert.deepEqual(seen.filter((e) => e.type !== 'status'), [
    { type: 'message', text: 'one', pointed: { selector: 'h1', text: 'Hi', html: '<h1>' }, replyTo: 'earlier' },
    { type: 'step', step: { action: 'edit', file: 'a.css', before: '1', after: '2' } },
    { type: 'reply', text: 'done', files: ['a.css'] },
    { type: 'message', text: 'two', pointed: undefined, replyTo: undefined },
    { type: 'error', detail: 'failed: Not logged in' },
  ]);
});

function fakeSnapshots(results = {}) {
  let n = 0;
  const undos = [];
  return {
    undos,
    take: async () => `tree${++n}`,
    undo: async (before, after) => {
      undos.push([before, after]);
      return results.undo ?? { ok: true };
    },
  };
}

async function undoSetup(t, { run = okRun, snapshots = fakeSnapshots() } = {}) {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-api-'));
  const state = openState(projectDir);
  const seen = [];
  const handler = createApi({ state, projectDir, widgetPath: '/dev/null', run, snapshots, onActivity: (e) => seen.push(e) });
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/__bubble/`;
  const post = (route, body) =>
    fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const settled = async (count) => {
    for (let i = 0; i < 200 && state.history().length < count; i++) await sleep(10);
    return state.history();
  };
  return { state, post, settled, seen, snapshots, projectDir };
}

test('a change that edited files can be undone', async (t) => {
  const a = await undoSetup(t);
  await a.post('send', { text: 'make it big' });
  const h = await a.settled(2);
  assert.equal(typeof h[1].change, 'string');
  const res = await a.post('undo', { id: h[1].change });
  assert.equal(res.status, 200);
  assert.deepEqual(a.snapshots.undos, [['tree1', 'tree2']]);
  const after = await a.settled(3);
  assert.deepEqual(
    { role: after[2].role, text: after[2].text, undid: after[2].undid },
    { role: 'note', text: 'Undid “make it big”', undid: h[1].change },
  );
  assert.deepEqual(a.seen.filter((e) => e.type === 'undo'), [{ type: 'undo', text: 'make it big', files: ['index.html'] }]);
  assert.match(fs.readFileSync(path.join(a.projectDir, '.bubble', 'log.md'), 'utf8'), /\*\*Asked:\*\* \(undo\) make it big/);
});

test('a change can only be undone once', async (t) => {
  const a = await undoSetup(t);
  await a.post('send', { text: 'x' });
  const h = await a.settled(2);
  assert.equal((await a.post('undo', { id: h[1].change })).status, 200);
  const again = await a.post('undo', { id: h[1].change });
  assert.equal(again.status, 409);
  assert.deepEqual(await again.json(), { error: 'done' });
});

test('an answer that changed nothing has nothing to undo', async (t) => {
  const snapshots = { take: async () => 'same', undo: async () => ({ ok: true }) };
  const a = await undoSetup(t, { run: async () => ({ reply: 'nothing to do', sessionId: 's', files: [] }), snapshots });
  await a.post('send', { text: 'x' });
  const h = await a.settled(2);
  assert.equal(h[1].change, undefined);
});

test('undo is refused while claude is working, for an unknown change, and when it would clash', async (t) => {
  let release;
  const a = await undoSetup(t, {
    snapshots: fakeSnapshots({ undo: { ok: false, reason: 'conflict' } }),
    run: async () => {
      if (release === undefined) return { reply: 'ok', sessionId: 's', files: ['a'] };
      await new Promise((r) => (release = r));
      return { reply: 'ok', sessionId: 's', files: ['a'] };
    },
  });
  await a.post('send', { text: 'first' });
  const h = await a.settled(2);
  assert.equal((await a.post('undo', { id: 'nope' })).status, 404);
  const clash = await a.post('undo', { id: h[1].change });
  assert.equal(clash.status, 409);
  assert.deepEqual(await clash.json(), { error: 'conflict' });
  release = null;
  await a.post('send', { text: 'second' });
  await sleep(30);
  const busy = await a.post('undo', { id: h[1].change });
  assert.equal(busy.status, 409);
  assert.deepEqual(await busy.json(), { error: 'busy' });
  release();
});

test('a drawn box is passed on, trimmed', async (t) => {
  let got;
  const a = await setup(async (job) => {
    got = job.pointed;
    return { reply: 'ok', sessionId: 's', files: [] };
  });
  t.after(a.close);
  await a.send({ text: 'x', pointed: { kind: 'area', box: '1×1 at 0,0', inside: 'y'.repeat(900), text: 'z'.repeat(900), html: '<b>' } });
  await a.settled(2);
  assert.deepEqual(got, { kind: 'area', box: '1×1 at 0,0', inside: 'y'.repeat(600), text: 'z'.repeat(300) });
});

test('after an undo, the next request tells claude what was undone, once', async (t) => {
  const seenNotes = [];
  const a = await undoSetup(t, {
    run: async ({ notes }) => {
      seenNotes.push(notes);
      return { reply: 'ok', sessionId: 's', files: ['style.css'] };
    },
  });
  await a.post('send', { text: 'blue gradient on the card' });
  const h = await a.settled(2);
  await a.post('undo', { id: h[1].change });
  await a.post('send', { text: 'do it again but darker' });
  await a.settled(5);
  await a.post('send', { text: 'thanks' });
  await a.settled(7);
  assert.deepEqual(seenNotes, [
    undefined,
    ['Your change for "blue gradient on the card" was undone. The files it touched (style.css) are back to how they were before that change.'],
    undefined,
  ]);
});

test('a page that cannot listen can ask for the news instead', async (t) => {
  let release;
  const a = await setup(async ({ onStatus, onStep }) => {
    onStatus('Making the change…');
    onStep({ kind: 'read', text: 'looked at index.html' });
    await new Promise((r) => (release = r));
    return { reply: 'done', sessionId: 's', files: ['index.html'] };
  });
  t.after(a.close);
  const poll = async (after) => (await fetch(`${a.base}/__bubble/poll?after=${after}`)).json();
  assert.deepEqual(await poll(0), { total: 0, after: 0, entries: [], status: '', steps: [] });

  await a.send({ text: 'make it big' });
  for (let i = 0; i < 200 && !release; i++) await sleep(5);
  const during = await poll(0);
  assert.equal(during.total, 1);
  assert.deepEqual(during.entries.map((e) => [e.role, e.text]), [['visitor', 'make it big']]);
  assert.equal(during.status, 'Making the change…');
  assert.deepEqual(during.steps, [{ kind: 'read', text: 'looked at index.html' }]);

  release();
  await a.settled(2);
  const done = await poll(1);
  assert.equal(done.total, 2);
  assert.equal(done.after, 1);
  assert.deepEqual(done.entries.map((e) => [e.role, e.text]), [['claude', 'done']]);
  for (let i = 0; i < 200 && (await poll(2)).status; i++) await sleep(5);
  assert.deepEqual(await poll(2), { total: 2, after: 2, entries: [], status: '', steps: [] });

  // A count the server does not recognise gets the whole conversation again.
  assert.equal((await poll(99)).after, 0);
  assert.equal((await poll(99)).entries.length, 2);
  assert.equal((await poll('x')).entries.length, 2);
});

function fakeCamera() {
  const shots = [];
  return {
    shots,
    dir: '/tmp/bubble-shots/test',
    shoot: async (opts) => {
      shots.push(opts);
      return `/tmp/bubble-shots/test/${shots.length}-${opts.name}.png`;
    },
    close() {},
  };
}

async function cameraSetup(t, run) {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-api-'));
  const state = openState(projectDir);
  const camera = fakeCamera();
  const handler = createApi({ state, projectDir, widgetPath: '/dev/null', run, camera });
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const post = (body) =>
    fetch(`http://127.0.0.1:${server.address().port}/__bubble/send`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
  const settled = async (count) => {
    for (let i = 0; i < 200 && state.history().length < count; i++) await sleep(10);
    return state.history();
  };
  return { camera, post, settled };
}

const VIEW = { path: '/pricing', width: 1200, height: 800, scrollX: 0, scrollY: 300, focus: { x: 100, y: 500, width: 200, height: 50 } };

test('claude gets a screenshot of what she sees, then checks its change against a second one', async (t) => {
  const calls = [];
  const a = await cameraSetup(t, async (job) => {
    calls.push(job);
    if (calls.length === 1) {
      job.onStep({ action: 'edit', file: 'a.css', before: '1', after: '2' });
      return { reply: 'Made it red.', sessionId: 's1', files: ['a.css'] };
    }
    job.onStep({ action: 'look' });
    job.onStep({ action: 'edit', file: 'b.css', before: '3', after: '4' });
    return { reply: 'Made it red and fixed the overlap.', sessionId: 's1', files: ['b.css'] };
  });
  await a.post({ text: 'make it red', view: VIEW });
  const h = await a.settled(2);
  assert.deepEqual(a.camera.shots, [
    { path: '/pricing', width: 1200, height: 800, clip: { x: 40, y: 440, width: 320, height: 170 }, name: 'before' },
    { path: '/pricing', width: 1200, height: 800, clip: { x: 0, y: 380, width: 440, height: 290 }, name: 'after' },
  ]);
  assert.equal(calls[0].screenshot, '/tmp/bubble-shots/test/1-before.png');
  assert.equal(calls[0].shotsDir, '/tmp/bubble-shots/test');
  assert.equal(calls[1].text, checkPrompt('/tmp/bubble-shots/test/2-after.png'));
  assert.equal(calls[1].sessionId, 's1');
  assert.equal(h[1].text, 'Made it red and fixed the overlap.');
  assert.deepEqual(h[1].files, ['a.css', 'b.css']);
  assert.deepEqual(h[1].steps.map((s) => s.action), ['edit', 'look', 'edit']);
});

test('with nothing to focus on, the shot is what she can see', async (t) => {
  const a = await cameraSetup(t, async () => ({ reply: 'ok', sessionId: 's', files: [] }));
  await a.post({ text: 'hi', view: { ...VIEW, focus: null } });
  await a.settled(2);
  assert.deepEqual(a.camera.shots, [{ path: '/pricing', width: 1200, height: 800, clip: { x: 0, y: 300, width: 1200, height: 800 }, name: 'before' }]);
});

test('no change means no second look; a failed check keeps the first answer', async (t) => {
  let n = 0;
  const a = await cameraSetup(t, async () => {
    n++;
    if (n === 1) return { reply: 'Which button?', sessionId: 's', files: [] };
    if (n === 2) return { reply: 'Done.', sessionId: 's', files: ['a.css'] };
    throw new RunError('failed', 'boom');
  });
  await a.post({ text: 'one', view: VIEW });
  await a.settled(2);
  assert.equal(a.camera.shots.length, 1);
  await a.post({ text: 'two', view: VIEW });
  const h = await a.settled(4);
  assert.equal(h[3].role, 'claude');
  assert.equal(h[3].text, 'Done.');
});

test('a view that is not well formed is ignored', async (t) => {
  const a = await cameraSetup(t, async () => ({ reply: 'ok', sessionId: 's', files: [] }));
  await a.post({ text: 'x', view: { path: 'javascript:alert(1)', width: 'wide' } });
  await a.settled(2);
  assert.deepEqual(a.camera.shots, []);
});
