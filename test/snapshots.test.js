import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createSnapshots } from '../src/snapshots.js';

function project({ git = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-snap-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<h1>hello</h1>\n');
  fs.writeFileSync(path.join(dir, 'style.css'), 'h1 { color: red; }\n');
  if (git) {
    const g = (...args) => execFileSync('git', args, { cwd: dir });
    g('init', '-q');
    g('add', '-A');
    g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
    // As bubble's state setup does for every project that uses git.
    fs.appendFileSync(path.join(dir, '.git', 'info', 'exclude'), '.bubble/\n');
  }
  const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
  const write = (f, s) => fs.writeFileSync(path.join(dir, f), s);
  return { dir, read, write };
}

test('undo puts back what one change edited and removes what it added', async () => {
  const p = project();
  const snaps = createSnapshots(p.dir);
  const before = await snaps.take();
  p.write('index.html', '<h1>bye</h1>\n');
  p.write('new.css', 'body {}\n');
  const after = await snaps.take();
  assert.notEqual(before, after);
  assert.deepEqual(await snaps.undo(before, after), { ok: true });
  assert.equal(p.read('index.html'), '<h1>hello</h1>\n');
  assert.equal(fs.existsSync(path.join(p.dir, 'new.css')), false);
});

test('undo leaves later edits to other files alone', async () => {
  const p = project();
  const snaps = createSnapshots(p.dir);
  const before = await snaps.take();
  p.write('index.html', '<h1>bye</h1>\n');
  const after = await snaps.take();
  p.write('style.css', 'h1 { color: blue; }\n');
  assert.deepEqual(await snaps.undo(before, after), { ok: true });
  assert.equal(p.read('index.html'), '<h1>hello</h1>\n');
  assert.equal(p.read('style.css'), 'h1 { color: blue; }\n');
});

test('undo refuses, and changes nothing, when the same lines were changed again since', async () => {
  const p = project();
  const snaps = createSnapshots(p.dir);
  const before = await snaps.take();
  p.write('index.html', '<h1>bye</h1>\n');
  p.write('style.css', 'h1 { color: green; }\n');
  const after = await snaps.take();
  p.write('index.html', '<h1>later</h1>\n');
  assert.deepEqual(await snaps.undo(before, after), { ok: false, reason: 'conflict' });
  assert.equal(p.read('index.html'), '<h1>later</h1>\n');
  assert.equal(p.read('style.css'), 'h1 { color: green; }\n');
});

test("the project's own git is not touched", async () => {
  const p = project({ git: true });
  const snaps = createSnapshots(p.dir);
  const status = () => execFileSync('git', ['status', '--porcelain'], { cwd: p.dir }).toString();
  const before = await snaps.take();
  p.write('index.html', '<h1>bye</h1>\n');
  const after = await snaps.take();
  assert.equal(status(), ' M index.html\n');
  await snaps.undo(before, after);
  assert.equal(status(), '');
});

test('secrets, dependencies and its own folder are left out of snapshots', async () => {
  const p = project();
  fs.mkdirSync(path.join(p.dir, 'node_modules', 'x'), { recursive: true });
  fs.writeFileSync(path.join(p.dir, 'node_modules', 'x', 'i.js'), '1');
  p.write('.env', 'SECRET=1');
  const snaps = createSnapshots(p.dir);
  const tree = await snaps.take();
  const files = execFileSync('git', ['--git-dir', path.join(p.dir, '.bubble', 'snapshots'), 'ls-tree', '-r', '--name-only', tree])
    .toString().trim().split('\n');
  assert.deepEqual(files.sort(), ['index.html', 'style.css']);
});

test('without git it reports that undo is unavailable instead of failing', async () => {
  const p = project();
  const snaps = createSnapshots(p.dir, { git: '/nonexistent/git' });
  assert.equal(await snaps.take(), null);
  assert.deepEqual(await snaps.undo('a', 'b'), { ok: false, reason: 'unavailable' });
});
