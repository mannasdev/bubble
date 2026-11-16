import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inject } from '../src/inject.js';

const TAG = '<script src="/__bubble/widget.js" defer></script>';

test('puts the tag before the last closing body tag', () => {
  const html = '<body><pre></body></pre>x</BODY></html>';
  assert.equal(inject(html), `<body><pre></body></pre>x${TAG}</BODY></html>`);
});

test('appends the tag when there is no closing body tag', () => {
  assert.equal(inject('<h1>hi</h1>'), '<h1>hi</h1>' + TAG);
});
