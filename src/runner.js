import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

export const SETTINGS_JSON = JSON.stringify({
  permissions: {
    deny: [
      'Read(./.env*)',
      'Read(**/.env*)',
      'Read(./.bubble/**)',
      'Read(./.git/**)',
      'Edit(./package.json)',
      'Edit(**/package.json)',
      'Edit(./*lock*)',
      'Edit(**/*lock*)',
      'Edit(./*.config.*)',
      'Edit(**/*.config.*)',
      'Edit(./.*)',
      'Edit(**/.*)',
      'Edit(./node_modules/**)',
      'Edit(**/node_modules/**)',
      'Edit(./scripts/**)',
    ],
  },
});

export const SYSTEM_PROMPT =
  'You are making changes to a website for a designer who is looking at the live page and typing into a small chat box on it. ' +
  'She is not a programmer. Make the change she asks for by editing files in this project. ' +
  'Reply in one or two plain sentences with no code and no file names. ' +
  'The page refreshes by itself after you change something, so never tell her to refresh. ' +
  'If her request is unclear, ask one short question instead of guessing. ' +
  'You cannot run commands, install packages or change configuration; if a request needs that, tell her to ask Mannas.';

// Used in local-only mode, where the person typing is the project's owner.
export const OWNER_PROMPT =
  'You are making changes to a website for its developer, who is looking at the live page and typing into a small chat box on it. ' +
  'Make the change they ask for by editing files in this project. ' +
  'Reply in one or two plain sentences; name a file only when it helps. ' +
  'The page refreshes by itself after you change something, so never tell them to refresh. ' +
  'If the request is unclear, ask one short question instead of guessing. ' +
  'From this chat box you cannot run commands, install packages or change configuration; if a request needs that, say so and say what to run.';

const LOOKING = new Set(['Read', 'Glob', 'Grep']);
const CHANGING = new Set(['Edit', 'Write']);

export class RunError extends Error {
  /** @param {'failed' | 'timeout' | 'stale-session'} kind */
  constructor(kind, detail = '') {
    super(detail ? `${kind}: ${detail}` : kind);
    this.name = 'RunError';
    this.kind = kind;
  }
}

/** The text handed to Claude: her words, plus the element she pointed at. */
export function buildPrompt(text, pointed, replyTo, notes, screenshot, images) {
  const since = notes?.length ? `(Since your last reply: ${notes.join(' ')})\n\n` : '';
  const reply = replyTo ? `\n\n(She is replying to this earlier message of yours: "${replyTo}")` : '';
  const shot = screenshot
    ? `\n\n(A screenshot of what she is looking at is at ${screenshot}. Look at it with the Read tool first.)`
    : '';
  const attached = images?.length
    ? images.length === 1
      ? `\n\n(She attached an image: ${images[0]}. Look at it with the Read tool.)`
      : `\n\n(She attached ${images.length} images: ${images.join(', ')}. Look at them with the Read tool.)`
    : '';
  return since + describePointed(text, pointed) + reply + attached + shot;
}

/** Sent after a change, with a fresh screenshot, so Claude can check its own work. */
export function checkPrompt(screenshot) {
  return (
    `Here is a screenshot of the page after your change: ${screenshot}. Look at it with the Read tool. ` +
    'If anything looks wrong or does not match what was asked, fix it now. ' +
    'Then give your final reply as before: one or two plain sentences about the result.'
  );
}

function describePointed(text, pointed) {
  if (!pointed) return text;
  if (pointed.kind === 'area') {
    return (
      `${text}\n\nShe drew a box on the page around an area, not one element:\n` +
      `the box: ${pointed.box}\n` +
      `what is inside it: ${pointed.inside || '(nothing, it is empty space)'}\n` +
      `text inside it: ${pointed.text || '(none)'}`
    );
  }
  if (pointed.kind === 'space') {
    return (
      `${text}\n\nShe pointed at an empty space on the page, not at an element:\n` +
      `inside: ${pointed.selector}\n` +
      `the element before the space: ${pointed.before || '(nothing, it is at the start)'}\n` +
      `the element after the space: ${pointed.after || '(nothing, it is at the end)'}\n` +
      `size of the space: ${pointed.gap || 'unknown'}`
    );
  }
  return (
    `${text}\n\nShe pointed at this element on the page:\n` +
    `selector: ${pointed.selector}\ntext: ${pointed.text}\nhtml: ${pointed.html}`
  );
}

/**
 * The login is only found when the variables a parent Claude session sets are
 * absent, so the child gets everything except CLAUDE* and ANTHROPIC*.
 */
function cleanEnv() {
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!/^(CLAUDE|ANTHROPIC)/.test(name)) env[name] = value;
  }
  return env;
}

function relativeTo(projectDir, file) {
  let root = projectDir;
  try {
    root = fs.realpathSync(projectDir);
  } catch {}
  for (const base of [root, projectDir]) {
    const rel = path.relative(base, file);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel;
  }
  return file;
}

/** One line of code, short enough to show in the change log. */
function brief(value) {
  const line = String(value ?? '').replace(/\s+/g, ' ').trim();
  return line.length > 120 ? line.slice(0, 120) + '\u2026' : line;
}

/** What one tool call did, for the change log she sees. */
function stepFor(block, projectDir, shotsDir) {
  const input = block.input ?? {};
  if (block.name === 'Read' && shotsDir && String(input.file_path ?? '').startsWith(path.join(shotsDir, 'uploads') + path.sep)) {
    return { action: 'image' };
  }
  if (block.name === 'Read' && shotsDir && String(input.file_path ?? '').startsWith(shotsDir + path.sep)) {
    return { action: 'look' };
  }
  const file = input.file_path ? relativeTo(projectDir, input.file_path) : undefined;
  if (block.name === 'Grep' || block.name === 'Glob') return { action: 'search', query: brief(input.pattern) };
  if (block.name === 'Read') return { action: 'read', file };
  if (block.name === 'Edit') return { action: 'edit', file, before: brief(input.old_string), after: brief(input.new_string) };
  if (block.name === 'Write') return { action: 'write', file };
  return null;
}

// Every claude process bubble has started and not yet seen exit.
const live = new Set();

/** Stop all work in progress, so nothing keeps editing after bubble is stopped. */
export function stopAll() {
  for (const child of live) child.kill('SIGKILL');
}

/** Run one request through a restricted, unattended Claude Code. */
export function runClaude({
  projectDir,
  text,
  pointed,
  sessionId,
  replyTo,
  notes,
  screenshot,
  images,
  shotsDir,
  onStatus,
  onStep,
  owner = false,
  readOnly = false,
  claudeBin = 'claude',
  timeoutMs = 300000,
  lingerMs = 3000,
}) {
  const args = [
    '-p',
    '--restricted', '--safe-mode', '--strict-mcp-config',
    '--tools', readOnly ? 'Read,Glob,Grep' : 'Read,Glob,Grep,Edit,Write',
    '--permission-mode', 'acceptEdits', '--permission-prompts', 'none',
    '--settings', SETTINGS_JSON,
    '--append-system-prompt', owner ? OWNER_PROMPT : SYSTEM_PROMPT,
    '--output-format', 'stream-json', '--verbose',
  ];
  if (shotsDir) args.push('--add-dir', shotsDir);
  if (sessionId) args.push('--resume', sessionId);

  return new Promise((resolve, reject) => {
    const child = spawn(claudeBin, args, { cwd: projectDir, env: cleanEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    live.add(child);
    child.on('exit', () => live.delete(child));
    // Her words go in on stdin, never as an argument: a message that starts
    // with a dash would otherwise be read as an option.
    child.stdin.on('error', () => {});
    child.stdin.end(buildPrompt(text, pointed, replyTo, notes, screenshot, images));
    const files = [];
    let result = null;
    let sawWork = false;
    let timedOut = false;
    let stderr = '';
    let settled = false;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stderr.on('data', (d) => {
      stderr = (stderr + d).slice(-2000);
    });

    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (event.type === 'assistant') {
        sawWork = true;
        for (const block of event.message?.content ?? []) {
          if (block.type !== 'tool_use') continue;
          const step = stepFor(block, projectDir, shotsDir);
          if (step) onStep?.(step);
          if (LOOKING.has(block.name)) onStatus?.('Looking at the code…');
          if (CHANGING.has(block.name)) {
            onStatus?.('Making the change…');
            const file = block.input?.file_path;
            if (file) {
              const rel = relativeTo(projectDir, file);
              if (!files.includes(rel)) files.push(rel);
            }
          }
        }
      } else if (event.type === 'result') {
        result = event;
        finish(null);
      }
    });

    // The real CLI can stay alive after printing its result, so the result
    // line decides the outcome. The process then gets a moment to save the
    // conversation before it is stopped.
    const finish = (code) => {
      if (timedOut) return settle(reject, new RunError('timeout'));
      const ok = result && !result.is_error && typeof result.result === 'string';
      if (ok) settle(resolve, { reply: result.result, sessionId: result.session_id, files });
      else {
        const detail = (result?.result || stderr || `exit ${code}`).toString().trim();
        // Only a missing conversation counts as stale; a login or network
        // failure must not throw the conversation away.
        const stale = sessionId && !sawWork && /no conversation found/i.test(`${stderr} ${result?.result ?? ''}`);
        settle(reject, new RunError(stale ? 'stale-session' : 'failed', detail));
      }
      if (child.exitCode === null && child.signalCode === null) {
        setTimeout(() => child.kill('SIGTERM'), lingerMs).unref();
      }
    };

    child.on('error', (err) => settle(reject, new RunError('failed', err.message)));
    child.on('close', (code) => finish(code));
  });
}
