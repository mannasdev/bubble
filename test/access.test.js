import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAccess, DENIED_HTML } from '../src/access.js';

const KEY = 'k'.repeat(32);
const req = (url, cookie) => ({ url, headers: cookie ? { cookie } : {} });

test('no cookie and no key is refused', () => {
  assert.deepEqual(checkAccess(req('/'), KEY), { ok: false });
});

test('wrong key is refused', () => {
  assert.equal(checkAccess(req('/?k=' + 'x'.repeat(32)), KEY).ok, false);
});

test('key of a different length is refused without throwing', () => {
  assert.equal(checkAccess(req('/?k=short'), KEY).ok, false);
  assert.equal(checkAccess(req('/', 'bubble_k=short'), KEY).ok, false);
});

test('right key sets the cookie and redirects to the clean url', () => {
  const r = checkAccess(req(`/pricing?k=${KEY}&x=1`), KEY);
  assert.equal(r.ok, true);
  assert.equal(r.redirect, '/pricing?x=1');
  assert.equal(r.setCookie, `bubble_k=${KEY}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`);
});

test('right key alone redirects to the bare path', () => {
  assert.equal(checkAccess(req(`/?k=${KEY}`), KEY).redirect, '/');
});

test('right cookie is allowed with no redirect', () => {
  assert.deepEqual(checkAccess(req('/a', `other=1; bubble_k=${KEY}`), KEY), { ok: true });
});

test('wrong cookie is refused', () => {
  assert.equal(checkAccess(req('/a', `bubble_k=${'x'.repeat(32)}`), KEY).ok, false);
});

test('denied page tells the visitor who to ask', () => {
  assert.match(DENIED_HTML, /This preview is private\. Ask Mannas for the link\./);
});
