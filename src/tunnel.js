import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TUNNEL_NAME = 'bubble';
const LOGIN_NOTICE = 'Run `cloudflared tunnel login` once, then start bubble again. Using a temporary link for now.';

function once(bin, args) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, (err, stdout, stderr) => {
      if (err) reject(new Error(`cloudflared ${args.slice(0, 3).join(' ')} failed: ${(stderr || err.message).trim()}`));
      else resolve(stdout);
    });
  });
}

/** Start a long-running cloudflared and wait until its output shows it is up. */
function longRunning(bin, args, ready, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let text = '';
    let done = false;
    const fail = (message) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill();
      reject(new Error(message));
    };
    const timer = setTimeout(() => fail(`The tunnel did not start within ${Math.round(timeoutMs / 1000)} seconds.`), timeoutMs);
    child.stderr.on('data', (chunk) => {
      if (done) return;
      text = (text + chunk).slice(-8000);
      const found = ready(text);
      if (found) {
        done = true;
        clearTimeout(timer);
        resolve({ found, stop: () => child.kill() });
      }
    });
    child.on('error', (err) => fail(`Could not start cloudflared: ${err.message}`));
    child.on('exit', (code) => fail(`The tunnel did not start (cloudflared exited with ${code}): ${text.trim().slice(-300)}`));
  });
}

/**
 * Make the local port reachable from outside. With a host and a Cloudflare
 * login the address is fixed; otherwise it is a temporary trycloudflare one.
 */
export async function startTunnel({
  localPort,
  host,
  bin = 'cloudflared',
  certPath = path.join(os.homedir(), '.cloudflared', 'cert.pem'),
  timeoutMs = 30000,
  onNotice = console.log,
}) {
  const local = `http://127.0.0.1:${localPort}`;

  if (host && !fs.existsSync(certPath)) {
    onNotice(LOGIN_NOTICE);
    host = undefined;
  }

  if (!host) {
    const t = await longRunning(
      bin,
      ['tunnel', '--url', local],
      (text) => /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(text)?.[0],
      timeoutMs,
    );
    return { url: t.found, fixed: false, stop: t.stop };
  }

  const tunnels = JSON.parse((await once(bin, ['tunnel', 'list', '--output', 'json'])) || '[]') ?? [];
  if (!tunnels.some((t) => t.name === TUNNEL_NAME)) await once(bin, ['tunnel', 'create', TUNNEL_NAME]);
  await once(bin, ['tunnel', 'route', 'dns', '--overwrite-dns', TUNNEL_NAME, host]);
  const t = await longRunning(
    bin,
    ['tunnel', '--url', local, 'run', TUNNEL_NAME],
    (text) => /Registered tunnel connection/.test(text),
    timeoutMs,
  );
  return { url: `https://${host}`, fixed: true, stop: t.stop };
}
