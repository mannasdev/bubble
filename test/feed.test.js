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

import { createSpinner, formatElapsed } from '../src/feed.js';

function fakeStream(isTTY = true) {
  const out = [];
  return { isTTY, out, write: (s) => out.push(s), text: () => out.join('') };
}

test('formatElapsed counts seconds, then minutes and seconds', () => {
  assert.equal(formatElapsed(0), '0s');
  assert.equal(formatElapsed(12_400), '12s');
  assert.equal(formatElapsed(75_000), '1m 15s');
});

test('the spinner shows what claude is doing and for how long', () => {
  const stream = fakeStream();
  let now = 1000;
  const sp = createSpinner(stream, { color: false, clock: () => now });
  sp.set('Thinking…');
  assert.match(stream.out.at(-1), /^\r\x1b\[2K {10}\S thinking… 0s$/);
  now += 12_000;
  sp.tick();
  assert.match(stream.out.at(-1), /^\r\x1b\[2K {10}\S thinking… 12s$/);
  sp.set('Making the change…');
  assert.match(stream.out.at(-1), /making the change… 12s$/);
  sp.stop();
});

test('the spinner frame changes on each tick', () => {
  const stream = fakeStream();
  const sp = createSpinner(stream, { color: false, clock: () => 0 });
  sp.set('Thinking…');
  const a = stream.out.at(-1);
  sp.tick();
  assert.notEqual(stream.out.at(-1), a);
  sp.stop();
});

test('a printed line replaces the spinner, which then comes back under it', () => {
  const stream = fakeStream();
  const sp = createSpinner(stream, { color: false, clock: () => 0 });
  sp.set('Thinking…');
  stream.out.length = 0;
  sp.print('14:02:11          looked at index.html');
  assert.equal(stream.out[0], '\r\x1b[2K14:02:11          looked at index.html\n');
  assert.match(stream.out[1], /thinking… 0s$/);
  sp.stop();
});

test('an empty status clears the spinner and the timer starts over next time', () => {
  const stream = fakeStream();
  let now = 0;
  const sp = createSpinner(stream, { color: false, clock: () => now });
  sp.set('Thinking…');
  now = 30_000;
  sp.set('');
  assert.equal(stream.out.at(-1), '\r\x1b[2K');
  stream.out.length = 0;
  sp.print('line');
  assert.deepEqual(stream.out, ['line\n']);
  now = 40_000;
  sp.set('Thinking…');
  assert.match(stream.out.at(-1), /thinking… 0s$/);
  sp.stop();
});

test('when output is not a terminal there is no spinner, only the lines', () => {
  const stream = fakeStream(false);
  const sp = createSpinner(stream, { color: false, clock: () => 0 });
  sp.set('Thinking…');
  sp.tick();
  sp.print('line');
  sp.set('');
  assert.deepEqual(stream.out, ['line\n']);
});

test('status events are not lines of their own', () => {
  assert.equal(formatActivity({ type: 'status', text: 'Thinking…' }, { now: at, color: false }), '');
});

test('a drawn box in the feed', () => {
  assert.equal(
    f({ type: 'message', text: 'lighter', pointed: { kind: 'area', box: '420×260 at 40,380', inside: 'h2 "Selected work"', text: '' } }),
    '14:02:11  her     lighter\n                  drew a box around h2 "Selected work"',
  );
  assert.equal(
    f({ type: 'message', text: 'photo here', pointed: { kind: 'area', box: '200×100 at 0,0', inside: '', text: '' } }),
    '14:02:11  her     photo here\n                  drew a box around empty space (200×100 at 0,0)',
  );
});

test('looking at a screenshot reads as looking at the page', () => {
  assert.equal(f({ type: 'step', step: { action: 'look' } }), '14:02:11          looked at the page');
});

test('goal progress in the feed, with a bar', () => {
  assert.equal(f({ type: 'goal', event: 'planned', text: 'launch', done: 0, total: 3 }), '14:02:11  goal    "launch": planned 3 steps');
  assert.equal(
    f({ type: 'goal', event: 'step', text: 'launch', done: 1, total: 4, number: 2, step: 'Add hover states' }),
    '14:02:11  goal    ███░░░░░░░ 1/4  step 2: Add hover states',
  );
  assert.equal(f({ type: 'goal', event: 'done', text: 'launch', done: 4, total: 4 }), '14:02:11  goal    ██████████ 4/4  done: "launch"');
  assert.equal(f({ type: 'goal', event: 'stopped', text: 'launch', done: 1, total: 4 }), '14:02:11  goal    stopped at 1/4');
});

test('attached images are mentioned in the feed', () => {
  assert.equal(f({ type: 'message', text: 'like this', images: 2 }), '14:02:11  her     like this\n                  attached 2 images');
  assert.equal(f({ type: 'message', text: '', images: 1 }), '14:02:11  her     (an image)\n                  attached 1 image');
});
