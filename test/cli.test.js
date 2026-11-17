import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, UsageError } from '../src/cli.js';

test('a port alone', () => {
  assert.deepEqual(parseArgs(['3000']), { port: 3000, host: undefined, fresh: false, noTunnel: false });
});

test('every option', () => {
  assert.deepEqual(parseArgs(['--fresh', '5173', '--host', 'p.example.com', '--no-tunnel']), {
    port: 5173, host: 'p.example.com', fresh: true, noTunnel: true,
  });
});

test('a missing port is a usage error', () => {
  assert.throws(() => parseArgs([]), UsageError);
});

test('a port that is not a number is a usage error', () => {
  for (const bad of ['abc', '0', '70000', '30.5', '-1']) assert.throws(() => parseArgs([bad]), UsageError, bad);
});

test('an unknown option, a missing host value and a host with a scheme are usage errors', () => {
  assert.throws(() => parseArgs(['3000', '--nope']), UsageError);
  assert.throws(() => parseArgs(['3000', '--host']), UsageError);
  assert.throws(() => parseArgs(['3000', '--host', 'https://p.example.com']), UsageError);
});

test('--local is the friendly name for a link that only works on this computer', () => {
  assert.deepEqual(parseArgs(['3000', '--local']), { port: 3000, host: undefined, fresh: false, noTunnel: true });
});
