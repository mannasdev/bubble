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
export function buildPrompt(text, pointed) {
  if (!pointed) return text;
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

/** Run one request through a restricted, unattended Claude Code. */
export function runClaude({
  projectDir,
  text,
  pointed,
  sessionId,
  onStatus,
  owner = false,
  claudeBin = 'claude',
  timeoutMs = 300000,
  lingerMs = 3000,
}) {
  const args = [
    '-p',
    '--restricted', '--safe-mode', '--strict-mcp-config',
    '--tools', 'Read,Glob,Grep,Edit,Write',
    '--permission-mode', 'acceptEdits', '--permission-prompts', 'none',
    '--settings', SETTINGS_JSON,
    '--append-system-prompt', owner ? OWNER_PROMPT : SYSTEM_PROMPT,
    '--output-format', 'stream-json', '--verbose',
  ];
  if (sessionId) args.push('--resume', sessionId);

  return new Promise((resolve, reject) => {
    const child = spawn(claudeBin, args, { cwd: projectDir, env: cleanEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    // Her words go in on stdin, never as an argument: a message that starts
    // with a dash would otherwise be read as an option.
    child.stdin.on('error', () => {});
    child.stdin.end(buildPrompt(text, pointed));
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
