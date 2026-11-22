import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openState } from './state.js';
import { createProxy } from './proxy.js';
import { createApi } from './api.js';
import { startTunnel } from './tunnel.js';
import { formatActivity, createSpinner } from './feed.js';
import { stopAll } from './runner.js';
import { createSnapshots } from './snapshots.js';
import { createCamera, findChrome } from './screenshot.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const USAGE = `Usage: bubble <port> [--local] [--host name] [--fresh]

  <port>         the port your site is running on, for example 3000
  --host name    use a fixed address on your Cloudflare domain, for example preview.example.com
  --fresh        start a new conversation with Claude
  --local        just for you: no public link, opens the page in your browser
`;

export class UsageError extends Error {}

export function parseArgs(argv) {
  const out = { port: undefined, host: undefined, fresh: false, noTunnel: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--fresh') out.fresh = true;
    else if (arg === '--local' || arg === '--no-tunnel') out.noTunnel = true;
    else if (arg === '--host') {
      const value = argv[++i];
      if (!value || !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(value)) {
        throw new UsageError('--host needs a name like preview.example.com');
      }
      out.host = value;
    } else if (/^\d+$/.test(arg) && out.port === undefined) {
      out.port = Number(arg);
    } else {
      throw new UsageError(`Did not understand "${arg}".`);
    }
  }
  if (out.port === undefined || out.port < 1 || out.port > 65535) {
    throw new UsageError('Give the port your site is running on, for example: bubble 3000');
  }
  return out;
}

function installed(bin) {
  return !spawnSync(bin, ['--version'], { stdio: 'ignore' }).error;
}

export async function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(`${err.message}\n\n${USAGE}`);
    return 1;
  }
  if (!installed('claude')) {
    console.error('Claude Code is not installed, or `claude` is not on your PATH.');
    return 1;
  }
  if (!args.noTunnel && !installed('cloudflared')) {
    console.error('cloudflared is not installed. Install it with `brew install cloudflared`, or use --local.');
    return 1;
  }

  const projectDir = process.cwd();
  const state = openState(projectDir);
  if (args.fresh) state.clearSession();
  if (args.host) state.setHost(args.host);

  // Screenshots of the page for Claude, kept outside the project. Each start
  // begins with an empty folder.
  const chrome = findChrome();
  const shotsDir = path.join(os.tmpdir(), 'bubble-shots', crypto.createHash('sha256').update(projectDir).digest('hex').slice(0, 10));
  // Old screenshots go; images she attached stay, so the chat can still show them.
  fs.mkdirSync(shotsDir, { recursive: true });
  for (const name of fs.readdirSync(shotsDir)) if (name.endsWith('.png')) fs.rmSync(path.join(shotsDir, name), { force: true });
  const camera = chrome ? createCamera({ targetPort: args.port, dir: shotsDir, chromePath: chrome }) : null;
  const spinner = createSpinner(process.stdout, { color: process.stdout.isTTY });
  const handleApi = createApi({
    state,
    projectDir,
    widgetPath: fileURLToPath(new URL('../widget/widget.js', import.meta.url)),
    owner: args.noTunnel,
    snapshots: createSnapshots(projectDir),
    camera,
    mediaDir: shotsDir,
    // Everything that happens in the bubble is printed here as it happens.
    onActivity: (event) => {
      // While Claude works, a spinner with a timer sits under the last line.
      if (event.type === 'status') return spinner.set(event.text);
      const line = formatActivity(event, { color: process.stdout.isTTY, who: args.noTunnel ? 'you' : 'her' });
      if (line) spinner.print(line);
    },
  });
  const server = createProxy({ targetPort: args.port, key: state.key, handleApi, secureCookie: !args.noTunnel });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const localPort = server.address().port;

  let base = `http://localhost:${localPort}`;
  let tunnel = null;
  let note = 'Opened in your browser. This link only works on this computer.';
  if (!args.noTunnel) {
    try {
      tunnel = await startTunnel({ localPort, host: state.host ?? undefined });
    } catch (err) {
      console.error(err.message);
      server.close();
      return 1;
    }
    base = tunnel.url;
    note = tunnel.fixed
      ? 'Send this to her. Treat it like a password.'
      : 'Send this to her. Treat it like a password. It changes each time you start bubble.';
  }

  console.log(`\n  ${base}/?k=${state.key}\n\n  ${note} Ctrl+C to stop.\n`);
  if (!camera) console.log('  Screenshots are off: no Chrome found. Claude will work from the code alone.\n');
  if (args.noTunnel && process.platform === 'darwin' && !process.env.BUBBLE_NO_OPEN) {
    spawn('open', [`${base}/?k=${state.key}`], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  }

  await new Promise((resolve) => {
    const stop = () => {
      spinner.stop();
      stopAll();
      camera?.close();
      tunnel?.stop();
      server.closeAllConnections();
      server.close();
      resolve();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  return 0;
}
