import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTunnel } from '../src/tunnel.js';

const FAKE = fileURLToPath(new URL('../fakes/cloudflared.js', import.meta.url));

async function withFake(env, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-cf-'));
  const record = path.join(dir, 'calls');
  const vars = { FAKE_CF_RECORD: record, FAKE_CF_MODE: 'ok', FAKE_CF_LIST: '[]', ...env };
  const saved = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    process.env[k] = vars[k];
  }
  const calls = () =>
    fs.existsSync(record) ? fs.readFileSync(record, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  try {
    return await fn({ dir, calls });
  } finally {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test('a temporary tunnel resolves with the trycloudflare address', async () => {
  await withFake({}, async ({ calls }) => {
    const t = await startTunnel({ localPort: 4321, bin: FAKE });
    t.stop();
    assert.equal(t.url, 'https://calm-river-demo.trycloudflare.com');
    assert.equal(t.fixed, false);
    assert.deepEqual(calls(), [['tunnel', '--url', 'http://127.0.0.1:4321']]);
  });
});

test('a tunnel that never reports an address is stopped and rejected', async () => {
  await withFake({ FAKE_CF_MODE: 'silent' }, async () => {
    await assert.rejects(startTunnel({ localPort: 1, bin: FAKE, timeoutMs: 300 }), /did not start/);
  });
});

test('a missing cloudflared rejects', async () => {
  await assert.rejects(startTunnel({ localPort: 1, bin: '/nonexistent/cloudflared', timeoutMs: 300 }));
});

test('a fixed address without a Cloudflare login falls back to a temporary one and says why', async () => {
  await withFake({}, async ({ dir, calls }) => {
    const notices = [];
    const t = await startTunnel({
      localPort: 5, host: 'p.example.com', bin: FAKE,
      certPath: path.join(dir, 'missing.pem'), onNotice: (m) => notices.push(m),
    });
    t.stop();
    assert.equal(t.url, 'https://calm-river-demo.trycloudflare.com');
    assert.equal(t.fixed, false);
    assert.deepEqual(notices, ['Run `cloudflared tunnel login` once, then start bubble again. Using a temporary link for now.']);
    assert.deepEqual(calls(), [['tunnel', '--url', 'http://127.0.0.1:5']]);
  });
});

test('a fixed address creates the tunnel when missing, routes the name, then runs it', async () => {
  await withFake({ FAKE_CF_LIST: '[{"name":"other"}]' }, async ({ dir, calls }) => {
    const cert = path.join(dir, 'cert.pem');
    fs.writeFileSync(cert, 'x');
    const t = await startTunnel({ localPort: 7, host: 'p.example.com', bin: FAKE, certPath: cert });
    t.stop();
    assert.equal(t.url, 'https://p.example.com');
    assert.equal(t.fixed, true);
    assert.deepEqual(calls(), [
      ['tunnel', 'list', '--output', 'json'],
      ['tunnel', 'create', 'bubble'],
      ['tunnel', 'route', 'dns', '--overwrite-dns', 'bubble', 'p.example.com'],
      ['tunnel', '--url', 'http://127.0.0.1:7', 'run', 'bubble'],
    ]);
  });
});

test('an existing tunnel is not created again', async () => {
  await withFake({ FAKE_CF_LIST: '[{"name":"bubble"}]' }, async ({ dir, calls }) => {
    const cert = path.join(dir, 'cert.pem');
    fs.writeFileSync(cert, 'x');
    const t = await startTunnel({ localPort: 7, host: 'p.example.com', bin: FAKE, certPath: cert });
    t.stop();
    assert.deepEqual(calls().map((c) => c[1]), ['list', 'route', '--url']);
  });
});

test('a failing setup step rejects with what cloudflared said', async () => {
  await withFake({ FAKE_CF_MODE: 'route-fails', FAKE_CF_LIST: '[{"name":"bubble"}]' }, async ({ dir }) => {
    const cert = path.join(dir, 'cert.pem');
    fs.writeFileSync(cert, 'x');
    await assert.rejects(
      startTunnel({ localPort: 7, host: 'p.example.com', bin: FAKE, certPath: cert }),
      /zone not found/,
    );
  });
});
