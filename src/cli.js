import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openState } from './state.js';
import { createProxy } from './proxy.js';
import { createApi } from './api.js';
import { startTunnel } from './tunnel.js';

export const USAGE = `Usage: bubble <port> [--host name] [--fresh] [--no-tunnel]

  <port>         the port your site is running on, for example 3000
  --host name    use a fixed address on your Cloudflare domain, for example preview.example.com
  --fresh        start a new conversation with Claude
  --no-tunnel    only make a local link, for trying it on this computer
`;

export class UsageError extends Error {}

export function parseArgs(argv) {
  const out = { port: undefined, host: undefined, fresh: false, noTunnel: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--fresh') out.fresh = true;
    else if (arg === '--no-tunnel') out.noTunnel = true;
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
    console.error('cloudflared is not installed. Install it with `brew install cloudflared`, or use --no-tunnel.');
    return 1;
  }

  const projectDir = process.cwd();
  const state = openState(projectDir);
  if (args.fresh) state.clearSession();
  if (args.host) state.setHost(args.host);

  const handleApi = createApi({
    state,
    projectDir,
    widgetPath: fileURLToPath(new URL('../widget/widget.js', import.meta.url)),
  });
  const server = createProxy({ targetPort: args.port, key: state.key, handleApi });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const localPort = server.address().port;

  let base = `http://localhost:${localPort}`;
  let tunnel = null;
  let note = 'This link only works on this computer.';
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

  await new Promise((resolve) => {
    const stop = () => {
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
