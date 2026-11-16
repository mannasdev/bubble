#!/usr/bin/env node
// Stand-in for cloudflared. Appends each call's arguments to FAKE_CF_RECORD.
import fs from 'node:fs';

const args = process.argv.slice(2);
if (process.env.FAKE_CF_RECORD) fs.appendFileSync(process.env.FAKE_CF_RECORD, JSON.stringify(args) + '\n');
const mode = process.env.FAKE_CF_MODE || 'ok';
const stay = () => setInterval(() => {}, 1000);

if (args[1] === 'list') {
  process.stdout.write(process.env.FAKE_CF_LIST || '[]');
} else if (args[1] === 'create' || args[1] === 'route') {
  if (mode === 'route-fails' && args[1] === 'route') {
    process.stderr.write('zone not found\n');
    process.exitCode = 1;
  }
} else if (args.includes('run')) {
  process.stderr.write('2026-01-01T00:00:00Z INF Registered tunnel connection connIndex=0\n');
  stay();
} else if (mode === 'silent') {
  stay();
} else {
  process.stderr.write('INF |  https://calm-river-demo.trycloudflare.com  |\n');
  stay();
}
