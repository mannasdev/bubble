import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runClaude, buildPrompt, RunError, SETTINGS_JSON, SYSTEM_PROMPT, OWNER_PROMPT } from '../src/runner.js';

const FAKE = fileURLToPath(new URL('../fakes/claude.js', import.meta.url));
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-run-')));

async function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function run(mode, extra = {}) {
  const projectDir = tmp();
  const record = path.join(projectDir, 'record.json');
  const statuses = [];
  const promise = withEnv({ FAKE_MODE: mode, FAKE_RECORD: record }, () =>
    runClaude({ projectDir, text: 'bigger', onStatus: (s) => statuses.push(s), claudeBin: FAKE, ...extra }),
  );
  return { promise, statuses, projectDir, recorded: () => JSON.parse(fs.readFileSync(record, 'utf8')) };
}

const BASE_ARGS = [
  '-p',
  '--restricted', '--safe-mode', '--strict-mcp-config',
  '--tools', 'Read,Glob,Grep,Edit,Write',
  '--permission-mode', 'acceptEdits', '--permission-prompts', 'none',
  '--settings', SETTINGS_JSON,
  '--append-system-prompt', SYSTEM_PROMPT,
  '--output-format', 'stream-json', '--verbose',
];

test('starts claude with exactly the restricted flags', async () => {
  const r = run('ok');
  await r.promise;
  assert.deepEqual(r.recorded().argv, BASE_ARGS);
});

test('adds --resume when there is a session', async () => {
  const r = run('ok', { sessionId: 'abc' });
  await r.promise;
  assert.deepEqual(r.recorded().argv, [...BASE_ARGS, '--resume', 'abc']);
});

test('her words go in on stdin, so a message starting with a dash is not read as an option', async () => {
  const text = '- make the heading bigger\n- and blue\n--add-dir=/Users';
  const r = run('ok', { text });
  await r.promise;
  assert.equal(r.recorded().stdin, text);
  assert.equal(r.recorded().argv.includes(text), false);
});

test('a resumed run that fails early for another reason is failed, not stale', async () => {
  await assert.rejects(run('early-fail', { sessionId: 'abc' }).promise, (e) => e.kind === 'failed');
});

test('runs in the project folder', async () => {
  const r = run('ok');
  await r.promise;
  assert.equal(r.recorded().cwd, r.projectDir);
});

test('settings deny secrets and config files', () => {
  assert.deepEqual(JSON.parse(SETTINGS_JSON), {
    permissions: {
      deny: [
        'Read(./.env*)', 'Read(**/.env*)', 'Read(./.bubble/**)', 'Read(./.git/**)',
        'Edit(./package.json)', 'Edit(**/package.json)', 'Edit(./*lock*)', 'Edit(**/*lock*)',
        'Edit(./*.config.*)', 'Edit(**/*.config.*)', 'Edit(./.*)', 'Edit(**/.*)',
        'Edit(./node_modules/**)', 'Edit(**/node_modules/**)', 'Edit(./scripts/**)',
      ],
    },
  });
});

test('child environment has no CLAUDE or ANTHROPIC variables', async () => {
  const env = await withEnv({ CLAUDECODE: '1', ANTHROPIC_BASE_URL: 'x', CLAUDE_CODE_SESSION_ID: 'y' }, async () => {
    const r = run('ok');
    await r.promise;
    return r.recorded().env;
  });
  assert.deepEqual(env.filter((k) => /^(CLAUDE|ANTHROPIC)/.test(k)), []);
  assert.ok(env.includes('PATH'));
});

test('returns the reply, the session and the files it edited', async () => {
  const r = run('ok');
  assert.deepEqual(await r.promise, { reply: 'Made it bigger.', sessionId: 'sess-1', files: ['index.html'] });
});

test('reports looking and changing as it goes', async () => {
  const r = run('ok');
  await r.promise;
  assert.deepEqual(r.statuses, ['Looking at the code…', 'Making the change…', 'Making the change…']);
});

test('an error result rejects as failed', async () => {
  await assert.rejects(run('error').promise, (e) => e instanceof RunError && e.kind === 'failed');
});

test('a missing binary rejects as failed', async () => {
  await assert.rejects(
    runClaude({ projectDir: tmp(), text: 'x', onStatus() {}, claudeBin: '/nonexistent/claude' }),
    (e) => e instanceof RunError && e.kind === 'failed',
  );
});

test('a hung run is killed and rejects as timeout', async () => {
  const r = run('hang', { timeoutMs: 300 });
  const started = Date.now();
  await assert.rejects(r.promise, (e) => e instanceof RunError && e.kind === 'timeout');
  assert.ok(Date.now() - started < 3000);
});

test('failing before any work on a resumed session rejects as stale-session', async () => {
  await assert.rejects(run('stale', { sessionId: 'old' }).promise, (e) => e.kind === 'stale-session');
});

test('the same early failure without a session is just failed', async () => {
  await assert.rejects(run('stale').promise, (e) => e.kind === 'failed');
});

test('buildPrompt leaves plain text unchanged, markup included', () => {
  assert.equal(buildPrompt('</script><b>x</b>'), '</script><b>x</b>');
});

test('buildPrompt adds what she pointed at', () => {
  assert.equal(
    buildPrompt('make this red', { selector: 'main > h1#t', text: 'Hello', html: '<h1 id="t">Hello</h1>' }),
    'make this red\n\nShe pointed at this element on the page:\nselector: main > h1#t\ntext: Hello\nhtml: <h1 id="t">Hello</h1>',
  );
});

test('answers as soon as the result arrives even if claude stays alive, then stops it', async () => {
  const r = run('linger', { lingerMs: 100 });
  const started = Date.now();
  assert.deepEqual(await r.promise, { reply: 'Done.', sessionId: 'sess-1', files: ['index.html'] });
  assert.ok(Date.now() - started < 3000, 'did not wait for the process to exit');
  const pid = Number(fs.readFileSync(path.join(r.projectDir, 'pid'), 'utf8'));
  await new Promise((done) => setTimeout(done, 600));
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test('when the owner is the one typing, claude is told so', async () => {
  const r = run('ok', { owner: true });
  await r.promise;
  const argv = r.recorded().argv;
  const prompt = argv[argv.indexOf('--append-system-prompt') + 1];
  assert.equal(prompt, OWNER_PROMPT);
  assert.notEqual(OWNER_PROMPT, SYSTEM_PROMPT);
  assert.doesNotMatch(OWNER_PROMPT, /ask Mannas|designer/);
});

test('buildPrompt describes an empty space she pointed at', () => {
  assert.equal(
    buildPrompt('add a testimonials section here', {
      kind: 'space', selector: 'main > section.hero', before: 'p "A calmer way"', after: 'button.cta "Get started"', gap: '48px tall',
    }),
    'add a testimonials section here\n\nShe pointed at an empty space on the page, not at an element:\n' +
      'inside: main > section.hero\nthe element before the space: p "A calmer way"\n' +
      'the element after the space: button.cta "Get started"\nsize of the space: 48px tall',
  );
});

test('buildPrompt handles a space with nothing before it', () => {
  assert.equal(
    buildPrompt('less room here', { kind: 'space', selector: 'main', before: '', after: 'h1 "Hi"', gap: '' }),
    'less room here\n\nShe pointed at an empty space on the page, not at an element:\n' +
      'inside: main\nthe element before the space: (nothing, it is at the start)\n' +
      'the element after the space: h1 "Hi"\nsize of the space: unknown',
  );
});

test('reports each step with the file and what an edit replaced', async () => {
  const steps = [];
  const r = run('steps', { onStep: (s) => steps.push(s) });
  await r.promise;
  assert.deepEqual(steps, [
    { action: 'search', query: 'Get started' },
    { action: 'read', file: 'src/page.html' },
    { action: 'edit', file: 'src/page.html', before: '<h1>hello</h1> <p>old</p>', after: '<h1>bye</h1>' },
    { action: 'write', file: 'new.css' },
    { action: 'edit', file: 'src/page.html', before: 'a'.repeat(120) + '\u2026', after: '' },
  ]);
});

test('buildPrompt adds the message she is replying to', () => {
  assert.equal(
    buildPrompt('darker please', null, 'The button is now blue.'),
    'darker please\n\n(She is replying to this earlier message of yours: "The button is now blue.")',
  );
});

test('the reply context reaches claude on stdin', async () => {
  const r = run('ok', { replyTo: 'The button is now blue.' });
  await r.promise;
  assert.match(r.recorded().stdin, /She is replying to this earlier message of yours: "The button is now blue\."/);
});
