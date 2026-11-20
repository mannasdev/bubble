import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAccess, cookieName, DENIED_HTML } from '../src/access.js';

const KEY = 'k'.repeat(32);
const NAME = cookieName(KEY);
const req = (url, cookie) => ({ url, headers: cookie ? { cookie } : {} });

test('no cookie and no key is refused', () => {
  assert.deepEqual(checkAccess(req('/'), KEY), { ok: false });
});

test('wrong key is refused', () => {
  assert.equal(checkAccess(req('/?k=' + 'x'.repeat(32)), KEY).ok, false);
});

test('key of a different length is refused without throwing', () => {
  assert.equal(checkAccess(req('/?k=short'), KEY).ok, false);
  assert.equal(checkAccess(req('/', `${NAME}=short`), KEY).ok, false);
});

test('right key sets the cookie and redirects to the clean url', () => {
  const r = checkAccess(req(`/pricing?k=${KEY}&x=1`), KEY);
  assert.equal(r.ok, true);
  assert.equal(r.redirect, '/pricing?x=1');
  assert.equal(r.setCookie, `${NAME}=${KEY}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`);
});

test('right key alone redirects to the bare path', () => {
  assert.equal(checkAccess(req(`/?k=${KEY}`), KEY).redirect, '/');
});

test('right cookie is allowed with no redirect', () => {
  assert.deepEqual(checkAccess(req('/a', `other=1; ${NAME}=${KEY}`), KEY), { ok: true });
});

test('wrong cookie is refused', () => {
  assert.equal(checkAccess(req('/a', `${NAME}=${'x'.repeat(32)}`), KEY).ok, false);
});

test('denied page tells the visitor who to ask', () => {
  assert.match(DENIED_HTML, /This preview is private\. Ask Mannas for the link\./);
});

test('a local-only link sets a cookie that plain http keeps, in Safari too', () => {
  const r = checkAccess(req(`/?k=${KEY}`), KEY, { secure: false });
  assert.equal(r.setCookie, `${NAME}=${KEY}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`);
});

test('each project gets its own cookie, so two bubbles on one computer do not log each other out', () => {
  const other = 'o'.repeat(32);
  assert.match(NAME, /^bubble_[0-9a-f]{8}$/);
  assert.notEqual(cookieName(other), NAME);
  assert.equal(checkAccess(req('/a', `${cookieName(other)}=${other}; ${NAME}=${KEY}`), KEY).ok, true);
});
