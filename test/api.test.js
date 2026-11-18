import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApi } from '../src/api.js';
import { openState } from '../src/state.js';
import { RunError } from '../src/runner.js';

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
