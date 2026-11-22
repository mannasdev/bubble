import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApi, parsePlan } from '../src/api.js';
import { openState } from '../src/state.js';
import { RunError } from '../src/runner.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('parsePlan reads numbered steps and ignores everything else', () => {
  assert.deepEqual(
    parsePlan('Here is the plan:\n1. Tighten the hero spacing\n2) Add hover states to the cards\n\n  3.   Make contact stand out  \nThat should do it.'),
    ['Tighten the hero spacing', 'Add hover states to the cards', 'Make contact stand out'],
  );
  assert.deepEqual(parsePlan('No numbers here.'), []);
  assert.equal(parsePlan(Array.from({ length: 12 }, (_, i) => `${i + 1}. step ${i + 1}`).join('\n')).length, 8);
});

async function setup(t, run, { dir } = {}) {
  const projectDir = dir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-goal-'));
  const state = openState(projectDir);
  const seen = [];
  const goals = [];
  const handler = createApi({ state, projectDir, widgetPath: '/dev/null', run, onActivity: (e) => seen.push(e) });
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/__bubble/`;
  const post = (route, body = {}) =>
    fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const goal = async () => (await (await fetch(base + 'poll')).json()).goal;
  const until = async (check, what) => {
    for (let i = 0; i < 300; i++) {
      const g = await goal();
      if (check(g)) return g;
      await sleep(10);
    }
    throw new Error('never reached: ' + what + ' ' + JSON.stringify(await goal()));
  };
  // Watch the live stream for goal updates, as the bubble does.
  const controller = new AbortController();
  t.after(() => controller.abort());
  fetch(base + 'events', { signal: controller.signal })
    .then(async (res) => {
      let buf = '';
      for await (const chunk of res.body) {
        buf += Buffer.from(chunk).toString();
        let i;
        while ((i = buf.indexOf('\n\n')) !== -1) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (/^event: goal$/m.test(block)) goals.push(JSON.parse(/^data: (.*)$/m.exec(block)[1]));
        }
      }
    })
    .catch(() => {});
  return { projectDir, state, post, goal, until, seen, goals };
}

const PLAN = '1. Tighten the hero spacing\n2. Add hover states\n3. Make contact stand out';

function planner(steps = PLAN, onStep) {
  const calls = [];
  const run = async (job) => {
    calls.push(job);
    if (job.readOnly) return { reply: steps, sessionId: 's', files: [] };
    if (onStep) return onStep(job, calls);
    return { reply: 'Done: ' + job.text.slice(0, 20), sessionId: 's', files: ['a.css'] };
  };
  return { run, calls };
}

test('a goal is planned by claude without changing anything, then waits for her', async (t) => {
  const p = planner();
  const a = await setup(t, p.run);
  const res = await a.post('goal', { text: 'Get the homepage ready for launch' });
  assert.equal(res.status, 202);
  const g = await a.until((g) => g?.status === 'review', 'review');
  assert.equal(g.text, 'Get the homepage ready for launch');
  assert.deepEqual(g.steps.map((s) => [s.text, s.status]), [
    ['Tighten the hero spacing', 'todo'],
    ['Add hover states', 'todo'],
    ['Make contact stand out', 'todo'],
  ]);
  assert.equal(p.calls.length, 1);
  assert.equal(p.calls[0].readOnly, true);
  assert.match(p.calls[0].text, /Get the homepage ready for launch/);
  assert.ok(a.goals.some((g) => g?.status === 'planning'));
});

test('a plan claude could not write is reported, not started', async (t) => {
  const a = await setup(t, planner('I would rather ask: which page?').run);
  await a.post('goal', { text: 'make it better' });
  const g = await a.until((g) => g?.status === 'failed', 'failed');
  assert.equal(g.error, 'I would rather ask: which page?');
});

test('autopilot runs her edited steps in order, one change each, and finishes', async (t) => {
  const p = planner();
  const a = await setup(t, p.run);
  await a.post('goal', { text: 'launch' });
  await a.until((g) => g?.status === 'review', 'review');
  const start = await a.post('goal/start', { steps: ['Tighten the hero spacing', 'Make contact stand out', 'Add a footer'] });
  assert.equal(start.status, 200);
  const g = await a.until((g) => g?.status === 'done', 'done');
  assert.deepEqual(g.steps.map((s) => s.status), ['done', 'done', 'done']);
  const work = p.calls.filter((c) => !c.readOnly).map((c) => c.text);
  assert.equal(work.length, 3);
  assert.match(work[0], /^Working toward the goal "launch", step 1 of 3: Tighten the hero spacing\./);
  assert.match(work[2], /step 3 of 3: Add a footer\./);
  const notes = a.state.history().filter((e) => e.role === 'note').map((e) => e.text);
  assert.deepEqual(notes, [
    'Goal: launch',
    'Step 1 of 3 · Tighten the hero spacing',
    'Step 2 of 3 · Make contact stand out',
    'Step 3 of 3 · Add a footer',
    'Goal done ✓',
  ]);
  assert.equal(a.state.history().filter((e) => e.role === 'claude').length, 3);
});

test('her own message during a goal runs before the next step', async (t) => {
  let release;
  const order = [];
  const p = planner(PLAN, async (job, calls) => {
    order.push(job.text.startsWith('Working') ? 'step' : 'hers');
    if (order.length === 1) await new Promise((r) => (release = r));
    return { reply: 'ok', sessionId: 's', files: ['a.css'] };
  });
  const a = await setup(t, p.run);
  await a.post('goal', { text: 'launch' });
  await a.until((g) => g?.status === 'review', 'review');
  await a.post('goal/start', { steps: ['one', 'two'] });
  await a.until((g) => g?.steps[0].status === 'doing', 'doing');
  await a.post('send', { text: 'also make the logo bigger' });
  release();
  await a.until((g) => g?.status === 'done', 'done');
  assert.deepEqual(order, ['step', 'hers', 'step']);
});

test('pause lets the current step finish and starts no more; resume carries on', async (t) => {
  let release;
  const p = planner(PLAN, async () => {
    await new Promise((r) => (release = r));
    return { reply: 'ok', sessionId: 's', files: ['a.css'] };
  });
  const a = await setup(t, p.run);
  await a.post('goal', { text: 'launch' });
  await a.until((g) => g?.status === 'review', 'review');
  await a.post('goal/start', { steps: ['one', 'two'] });
  await a.until((g) => g?.steps[0].status === 'doing', 'doing');
  assert.equal((await a.post('goal/pause')).status, 200);
  release();
  let g = await a.until((g) => g?.steps[0].status === 'done', 'first done');
  await sleep(50);
  g = await a.goal();
  assert.equal(g.status, 'paused');
  assert.equal(g.steps[1].status, 'todo');
  await a.post('goal/resume');
  await a.until((g) => g?.steps[1].status === 'doing', 'second doing');
  release();
  await a.until((g) => g?.status === 'done', 'done');
});

test('stop skips what is left', async (t) => {
  let release;
  const p = planner(PLAN, async () => {
    await new Promise((r) => (release = r));
    return { reply: 'ok', sessionId: 's', files: ['a.css'] };
  });
  const a = await setup(t, p.run);
  await a.post('goal', { text: 'launch' });
  await a.until((g) => g?.status === 'review', 'review');
  await a.post('goal/start', { steps: ['one', 'two', 'three'] });
  await a.until((g) => g?.steps[0].status === 'doing', 'doing');
  await a.post('goal/stop');
  release();
  const g = await a.until((g) => g?.status === 'stopped' && g.steps[0].status === 'done', 'stopped');
  assert.deepEqual(g.steps.map((s) => s.status), ['done', 'skipped', 'skipped']);
});

test('a step that fails pauses the goal so she can decide', async (t) => {
  const p = planner(PLAN, async (job, calls) => {
    if (calls.filter((c) => !c.readOnly).length === 1) throw new RunError('failed', 'boom');
    return { reply: 'ok', sessionId: 's', files: ['a.css'] };
  });
  const a = await setup(t, p.run);
  await a.post('goal', { text: 'launch' });
  await a.until((g) => g?.status === 'review', 'review');
  await a.post('goal/start', { steps: ['one', 'two'] });
  let g = await a.until((g) => g?.status === 'paused', 'paused');
  assert.deepEqual(g.steps.map((s) => s.status), ['failed', 'todo']);
  await a.post('goal/resume');
  g = await a.until((g) => g?.status === 'done', 'done');
  assert.deepEqual(g.steps.map((s) => s.status), ['done', 'done']);
});

test('one goal at a time; a finished goal can be cleared for a new one', async (t) => {
  const a = await setup(t, planner().run);
  await a.post('goal', { text: 'first' });
  await a.until((g) => g?.status === 'review', 'review');
  assert.equal((await a.post('goal', { text: 'second' })).status, 409);
  assert.equal((await a.post('goal/clear')).status, 200);
  assert.equal(await a.goal(), null);
  assert.equal((await a.post('goal', { text: 'second' })).status, 202);
});

test('bad goal requests are refused', async (t) => {
  const a = await setup(t, planner().run);
  assert.equal((await a.post('goal', { text: '' })).status, 400);
  assert.equal((await a.post('goal/start', { steps: ['x'] })).status, 409);
  await a.post('goal', { text: 'launch' });
  await a.until((g) => g?.status === 'review', 'review');
  assert.equal((await a.post('goal/start', { steps: [] })).status, 400);
  assert.equal((await a.post('goal/start', { steps: Array(13).fill('x') })).status, 400);
});

test('a goal survives a restart, paused rather than running on its own', async (t) => {
  let release;
  const p = planner(PLAN, async () => {
    await new Promise((r) => (release = r));
    return { reply: 'ok', sessionId: 's', files: ['a.css'] };
  });
  const a = await setup(t, p.run);
  await a.post('goal', { text: 'launch' });
  await a.until((g) => g?.status === 'review', 'review');
  await a.post('goal/start', { steps: ['one', 'two'] });
  await a.until((g) => g?.steps[0].status === 'doing', 'doing');
  const b = await setup(t, planner().run, { dir: a.projectDir });
  const g = await b.goal();
  assert.equal(g.status, 'paused');
  assert.deepEqual(g.steps.map((s) => s.status), ['todo', 'todo']);
  release();
});

test('the terminal hears about the plan, each step and the end', async (t) => {
  const a = await setup(t, planner().run);
  await a.post('goal', { text: 'launch' });
  await a.until((g) => g?.status === 'review', 'review');
  await a.post('goal/start', { steps: ['one', 'two'] });
  await a.until((g) => g?.status === 'done', 'done');
  const goalEvents = a.seen.filter((e) => e.type === 'goal').map((e) => [e.event, e.done, e.total]);
  assert.deepEqual(goalEvents, [
    ['planned', 0, 3],
    ['step', 0, 2],
    ['step', 1, 2],
    ['done', 2, 2],
  ]);
});

test('goal steps are shown the whole page, not just where she was looking', async (t) => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-goal-'));
  const state = openState(projectDir);
  const shots = [];
  const camera = { dir: '/tmp/s', shoot: async (o) => (shots.push(o), `/tmp/s/${shots.length}.png`), close() {} };
  const p = planner();
  const handler = createApi({ state, projectDir, widgetPath: '/dev/null', run: p.run, camera });
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/__bubble/`;
  const post = (route, body) => fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const view = { path: '/', width: 1000, height: 700, scrollX: 0, scrollY: 0, focus: null };
  await post('goal', { text: 'launch', view });
  for (let i = 0; i < 200 && (await (await fetch(base + 'poll')).json()).goal?.status !== 'review'; i++) await sleep(10);
  await post('goal/start', { steps: ['one'] });
  for (let i = 0; i < 200 && (await (await fetch(base + 'poll')).json()).goal?.status !== 'done'; i++) await sleep(10);
  assert.deepEqual(shots.map((s) => [s.name, s.whole === true]), [
    ['before', true], // the plan
    ['before', true], // step one
    ['after', true], // step one, checked
  ]);
});
