import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatActivity } from '../src/feed.js';

const at = new Date(2026, 0, 5, 14, 2, 11);
const f = (event, extra = {}) => formatActivity(event, { now: at, color: false, who: 'her', ...extra });

test('her message, with what she pointed at', () => {
  assert.equal(f({ type: 'message', text: 'make this purple' }), '14:02:11  her     make this purple');
  assert.equal(
    f({ type: 'message', text: 'make this purple', pointed: { selector: 'button.cta', text: 'Get started', html: '' } }),
    '14:02:11  her     make this purple\n                  pointing at "Get started"',
  );
  assert.equal(
    f({ type: 'message', text: 'add a row', pointed: { kind: 'space', selector: 'main', before: 'p "A"', after: 'div.row "B"', gap: '60px tall' } }),
    '14:02:11  her     add a row\n                  pointing at the space between p "A" and div.row "B" (60px tall)',
  );
});

test('a reply shows what it answers', () => {
  assert.equal(
    f({ type: 'message', text: 'lighter', replyTo: 'The heading is now dark green.' }),
    '14:02:11  her     lighter\n                  replying to "The heading is now dark green."',
  );
});

test('in local mode the person typing is you', () => {
  assert.equal(f({ type: 'message', text: 'hi' }, { who: 'you' }), '14:02:11  you     hi');
});

test('steps: searches, reads, writes, and edits with before and after', () => {
  assert.equal(f({ type: 'step', step: { action: 'search', query: '*.css' } }), '14:02:11          searched for "*.css"');
  assert.equal(f({ type: 'step', step: { action: 'read', file: 'index.html' } }), '14:02:11          looked at index.html');
  assert.equal(f({ type: 'step', step: { action: 'write', file: 'new.css' } }), '14:02:11          wrote new.css');
  assert.equal(
    f({ type: 'step', step: { action: 'edit', file: 'index.html', before: 'a', after: 'b' } }),
    '14:02:11          edited index.html\n                    - a\n                    + b',
  );
  assert.equal(
    f({ type: 'step', step: { action: 'edit', file: 'index.html', before: 'a', after: '' } }),
    '14:02:11          edited index.html\n                    - a',
  );
});

test("claude's answer and a failure", () => {
  assert.equal(f({ type: 'reply', text: 'Done.\nAnything else?' }), '14:02:11  claude  Done. Anything else?');
  assert.equal(f({ type: 'error', detail: 'Not logged in' }), '14:02:11  failed  Not logged in');
});

test('colour adds escape codes only when asked', () => {
  assert.doesNotMatch(f({ type: 'reply', text: 'x' }), /\x1b/);
  assert.match(f({ type: 'reply', text: 'x' }, { color: true }), /\x1b\[/);
});
