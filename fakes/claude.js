#!/usr/bin/env node
// Stand-in for the claude binary. Prints canned stream-json chosen by FAKE_MODE
// and records how it was called in the file named by FAKE_RECORD.
import fs from 'node:fs';
import path from 'node:path';

const mode = process.env.FAKE_MODE || 'ok';
if (process.env.FAKE_RECORD) {
  fs.writeFileSync(
    process.env.FAKE_RECORD,
    JSON.stringify({ argv: process.argv.slice(2), env: Object.keys(process.env), cwd: process.cwd() }),
  );
}
const say = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const use = (name, file) =>
  say({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input: { file_path: file } }] } });

if (mode === 'ok') {
  const file = path.join(process.cwd(), 'index.html');
  say({ type: 'system', subtype: 'init', session_id: 'sess-1' });
  use('Read', file);
  use('Edit', file);
  use('Edit', file);
  say({ type: 'assistant', message: { content: [{ type: 'text', text: 'Done.' }] } });
  say({ type: 'result', subtype: 'success', is_error: false, result: 'Made it bigger.', session_id: 'sess-1' });
} else if (mode === 'error') {
  say({ type: 'system', subtype: 'init', session_id: 'sess-1' });
  say({ type: 'assistant', message: { content: [{ type: 'text', text: 'hm' }] } });
  say({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in', session_id: 'sess-1' });
  process.exitCode = 1;
} else if (mode === 'stale') {
  process.stderr.write('No conversation found with session ID: old\n');
  say({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: 'x' });
  process.exitCode = 1;
} else if (mode === 'linger') {
  // The real CLI prints its result and then stays alive.
  say({ type: 'system', subtype: 'init', session_id: 'sess-1' });
  use('Edit', path.join(process.cwd(), 'index.html'));
  say({ type: 'result', subtype: 'success', is_error: false, result: 'Done.', session_id: 'sess-1' });
  fs.writeFileSync(path.join(process.cwd(), 'pid'), String(process.pid));
  setInterval(() => {}, 1000);
} else if (mode === 'hang') {
  setInterval(() => {}, 1000);
}
