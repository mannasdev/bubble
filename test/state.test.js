import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openState } from '../src/state.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-state-'));
const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString();

test('key is created once and stays the same', () => {
  const dir = tmp();
  const a = openState(dir).key;
  const b = openState(dir).key;
  assert.equal(a, b);
  assert.match(a, /^[A-Za-z0-9_-]{32}$/);
});

test('adds .bubble/ to git exclude exactly once', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, '.git', 'info'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.git', 'info', 'exclude'), '# existing\n');
  openState(dir);
  openState(dir);
  const text = fs.readFileSync(path.join(dir, '.git', 'info', 'exclude'), 'utf8');
  assert.equal(text.split('\n').filter((l) => l === '.bubble/').length, 1);
  assert.ok(text.startsWith('# existing\n'));
});

test('creates git exclude file when .git exists without info/', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, '.git'));
  openState(dir);
  assert.equal(fs.readFileSync(path.join(dir, '.git', 'info', 'exclude'), 'utf8'), '.bubble/\n');
});

test('does not create .git when the project is not a repo', () => {
  const dir = tmp();
  openState(dir);
  assert.equal(fs.existsSync(path.join(dir, '.git')), false);
});

test('history round-trips through a new State', () => {
  const dir = tmp();
  const e = { id: '1', role: 'visitor', text: 'hi', at: hoursAgo(0) };
  openState(dir).append(e);
  assert.deepEqual(openState(dir).history(), [e]);
});

test('session is kept when the last message is 1 hour old', () => {
  const dir = tmp();
  const s = openState(dir);
  s.setSession('abc');
  s.append({ id: '1', role: 'visitor', text: 'hi', at: hoursAgo(1) });
  assert.equal(openState(dir).session(), 'abc');
});

test('session is dropped when the last message is 13 hours old', () => {
  const dir = tmp();
  const s = openState(dir);
  s.setSession('abc');
  s.append({ id: '1', role: 'visitor', text: 'hi', at: hoursAgo(13) });
  assert.equal(openState(dir).session(), null);
});

test('clearSession forgets the session', () => {
  const dir = tmp();
  const s = openState(dir);
  s.setSession('abc');
  s.clearSession();
  assert.equal(s.session(), null);
});

test('host is null until set and then remembered', () => {
  const dir = tmp();
  assert.equal(openState(dir).host, null);
  openState(dir).setHost('p.example.com');
  assert.equal(openState(dir).host, 'p.example.com');
});

test('log writes the request, reply and files', () => {
  const dir = tmp();
  openState(dir).log('make it big', 'Done.', ['index.html', 'a.css']);
  const text = fs.readFileSync(path.join(dir, '.bubble', 'log.md'), 'utf8');
  assert.match(text, /^## \d{4}-\d\d-\d\dT/m);
  assert.match(text, /^\*\*Asked:\*\* make it big$/m);
  assert.match(text, /^\*\*Reply:\*\* Done\.$/m);
  assert.match(text, /^\*\*Files:\*\* index\.html, a\.css$/m);
});
