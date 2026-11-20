import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const CODE = fs.readFileSync(new URL('../widget/widget.js', import.meta.url), 'utf8');

// A DOM just big enough for the widget to start and for its helpers to run.
class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.style = {};
    this.attrs = {};
    this.listeners = {};
    this.id = '';
    this.className = '';
    this._text = '';
    this.shadowRoot = null;
    this.classList = {
      add: (...c) => (this.className = [...new Set([...this._classes(), ...c])].join(' ')),
      remove: (...c) => (this.className = this._classes().filter((x) => !c.includes(x)).join(' ')),
      toggle: (c, on) => (on ? this.classList.add(c) : this.classList.remove(c)),
      contains: (c) => this._classes().includes(c),
    };
  }
  _classes() {
    return this.className.split(/\s+/).filter(Boolean);
  }
  set textContent(v) {
    this._text = String(v);
    this.children = [];
  }
  get textContent() {
    return this._text + this.children.map((c) => c.textContent).join('');
  }
  set innerHTML(v) {
    throw new Error('innerHTML must not be used');
  }
  append(...kids) {
    for (const k of kids) this.appendChild(k);
  }
  appendChild(k) {
    k.parentElement = this;
    this.children.push(k);
    return k;
  }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((c) => c !== this);
  }
  replaceChildren(...kids) {
    this.children = [];
    this.append(...kids);
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  getAttribute(k) {
    return this.attrs[k] ?? null;
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  removeEventListener() {}
  attachShadow() {
    this.shadowRoot = new El('#shadow');
    return this.shadowRoot;
  }
  getBoundingClientRect() {
    return { top: 0, left: 0, width: 0, height: 0 };
  }
  focus() {}
  scrollIntoView() {}
}

function boot() {
  const html = new El('html');
  const body = html.appendChild(new El('body'));
  const document = {
    documentElement: html,
    body,
    createElement: (t) => new El(t),
    addEventListener() {},
    removeEventListener() {},
  };
  const store = {};
  const w = {
    document,
    sessionStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => (store[k] = String(v)) },
    EventSource: class {
      addEventListener() {}
    },
    fetch: async () => ({ ok: true }),
    location: { reload() {} },
    matchMedia: () => ({ matches: false }),
    setTimeout,
    clearTimeout,
    console,
  };
  w.window = w;
  w.top = w;
  w.self = w;
  vm.createContext(w);
  vm.runInContext(CODE, w);
  return { w, html, body };
}

test('describes an element by tag, id or two classes, under up to three ancestors', () => {
  const { w, body } = boot();
  const main = body.appendChild(new El('main'));
  const section = main.appendChild(new El('section'));
  section.className = 'hero big x';
  const h1 = section.appendChild(new El('h1'));
  h1.id = 't';
  h1.className = 'ignored';
  assert.equal(w.__bubble.describe(h1), 'main > section.hero.big > h1#t');
  const span = h1.appendChild(new El('span'));
  assert.equal(w.__bubble.describe(span), 'main > section.hero.big > h1#t > span');
  const deep = span.appendChild(new El('em'));
  assert.equal(w.__bubble.describe(deep), 'section.hero.big > h1#t > span > em');
});

test('renders a message as plain text with no child elements', () => {
  const { w } = boot();
  const text = '<b>x</b></script>';
  const node = w.__bubble.renderEntry({ role: 'visitor', text });
  assert.equal(node.textContent, text);
  assert.equal(node.children.length, 0);
  assert.ok(node.className.includes('visitor'));
});

test('loading the script twice creates only one bubble', () => {
  const { w, html } = boot();
  const count = () => html.children.filter((c) => c.id === '__bubble_root').length;
  assert.equal(count(), 1);
  vm.runInContext(CODE, w);
  assert.equal(count(), 1);
});

test('does nothing inside an iframe', () => {
  const html = new El('html');
  const w = { document: { documentElement: html, createElement: (t) => new El(t), addEventListener() {} } };
  w.window = w;
  w.self = w;
  w.top = {};
  vm.createContext(w);
  vm.runInContext(CODE, w);
  assert.equal(html.children.length, 0);
  assert.equal(w.__bubble, undefined);
});

test('pathTo gives an exact route from the body that survives a reload', () => {
  const { w, body } = boot();
  const main = body.appendChild(new El('main'));
  main.appendChild(new El('p'));
  const section = main.appendChild(new El('section'));
  section.appendChild(new El('button'));
  section.appendChild(new El('p'));
  const second = section.appendChild(new El('button'));
  assert.equal(
    w.__bubble.pathTo(second),
    'body > main:nth-of-type(1) > section:nth-of-type(1) > button:nth-of-type(2)',
  );
  assert.equal(w.__bubble.pathTo(main), 'body > main:nth-of-type(1)');
  assert.equal(w.__bubble.pathTo(body), 'body');
});

test('clampPoint keeps the pointer inside the visible page', () => {
  const { w } = boot();
  const c = (x, y) => {
    const p = w.__bubble.clampPoint(x, y, 800, 600);
    return [p.x, p.y];
  };
  assert.deepEqual(c(400, 300), [400, 300]);
  assert.deepEqual(c(-50, 9000), [12, 588]);
  assert.deepEqual(c(5000, -1), [788, 12]);
});

test('gapAt finds the space between two stacked things', () => {
  const { w } = boot();
  const rects = [
    { top: 0, bottom: 50, left: 0, right: 300 },
    { top: 98, bottom: 150, left: 0, right: 300 },
  ];
  const g = w.__bubble.gapAt(rects, 150, 70);
  assert.deepEqual({ ...g }, { axis: 'y', before: 0, after: 1, start: 50, end: 98 });
});

test('gapAt finds the space above the first thing and below the last', () => {
  const { w } = boot();
  const rects = [
    { top: 40, bottom: 50, left: 0, right: 300 },
    { top: 100, bottom: 150, left: 0, right: 300 },
  ];
  assert.deepEqual({ ...w.__bubble.gapAt(rects, 10, 20) }, { axis: 'y', before: -1, after: 0, start: null, end: 40 });
  assert.deepEqual({ ...w.__bubble.gapAt(rects, 10, 400) }, { axis: 'y', before: 1, after: -1, start: 150, end: null });
});

test('gapAt finds the space between two things side by side', () => {
  const { w } = boot();
  const rects = [
    { top: 0, bottom: 40, left: 0, right: 40 },
    { top: 0, bottom: 40, left: 100, right: 140 },
  ];
  assert.deepEqual({ ...w.__bubble.gapAt(rects, 70, 20) }, { axis: 'x', before: 0, after: 1, start: 40, end: 100 });
});

test('gapAt says a point on a thing is not empty space', () => {
  const { w } = boot();
  assert.equal(w.__bubble.gapAt([{ top: 0, bottom: 50, left: 0, right: 300 }], 10, 10), null);
});

test('kindOf names what she is hovering in plain words', () => {
  const { w } = boot();
  assert.equal(w.__bubble.kindOf(new El('h2')), 'heading');
  assert.equal(w.__bubble.kindOf(new El('button')), 'button');
  assert.equal(w.__bubble.kindOf(new El('img')), 'image');
  assert.equal(w.__bubble.kindOf(new El('div')), 'block');
  assert.equal(w.__bubble.kindOf(new El('my-widget')), 'block');
});

test('cornerFor snaps to whichever corner the bubble was dropped nearest', () => {
  const { w } = boot();
  const c = (x, y) => w.__bubble.cornerFor(x, y, 1000, 800);
  assert.equal(c(900, 700), 'br');
  assert.equal(c(100, 700), 'bl');
  assert.equal(c(900, 100), 'tr');
  assert.equal(c(100, 100), 'tl');
  assert.equal(c(500, 400), 'br');
});

test('a reply from Claude with a change log still shows its words as plain text', () => {
  const { w } = boot();
  const text = '<img src=x onerror=alert(1)>';
  const node = w.__bubble.renderEntry({
    role: 'claude', text,
    steps: [{ action: 'read', file: 'a.html' }, { action: 'edit', file: 'a.html', before: '<b>', after: '<i>' }],
  });
  const body = node.children.find((c) => c.className === 'body');
  assert.equal(body.textContent, text);
  assert.equal(body.children.length, 0);
  const labels = node.children.find((c) => c.className === 'acts').children.map((b) => b.textContent);
  assert.deepEqual(labels, ['Reply', '1 change']);
});

test('her reply shows the message it answers as a quote', () => {
  const { w } = boot();
  const node = w.__bubble.renderEntry({ role: 'visitor', text: 'darker', replyTo: 'The button is blue.' });
  assert.deepEqual(node.children.map((c) => [c.className, c.textContent]), [['quote', 'The button is blue.'], ['body', 'darker']]);
});

test('an answer that changed files offers Undo', () => {
  const { w } = boot();
  const node = w.__bubble.renderEntry({ role: 'claude', text: 'done', change: 'c1', steps: [{ action: 'edit', file: 'a', before: '1', after: '2' }] });
  const labels = node.children.find((c) => c.className === 'acts').children.map((b) => b.textContent);
  assert.deepEqual(labels, ['Reply', '1 change', 'Undo']);
});

test('an undo note is shown as a quiet line', () => {
  const { w } = boot();
  const node = w.__bubble.renderEntry({ role: 'note', text: 'Undid “x”', undid: 'c1' });
  assert.equal(node.className, 'msg note');
  assert.equal(node.textContent, 'Undid “x”');
});

test('mostlyInside picks the things a drawn box covers', () => {
  const { w } = boot();
  const box = { left: 100, top: 100, right: 400, bottom: 300 };
  const rects = [
    { left: 110, top: 110, right: 390, bottom: 290 }, // fully inside
    { left: 90, top: 120, right: 200, bottom: 200 }, // 91% inside
    { left: 350, top: 250, right: 500, bottom: 350 }, // a corner only
    { left: 600, top: 600, right: 700, bottom: 700 }, // elsewhere
    { left: 150, top: 150, right: 150, bottom: 150 }, // has no size
  ];
  assert.deepEqual([...w.__bubble.mostlyInside(rects, box)], [0, 1]);
});

test('boxBetween turns a drag in any direction into a box', () => {
  const { w } = boot();
  assert.deepEqual({ ...w.__bubble.boxBetween(300, 250, 100, 50) }, { left: 100, top: 50, right: 300, bottom: 250 });
});

test('boxLabel names what a drawn box covers in plain words', () => {
  const { w } = boot();
  const make = (tag, text) => {
    const n = new El(tag);
    if (text) n.textContent = text;
    return n;
  };
  const L = (nodes) => w.__bubble.boxLabel(nodes);
  assert.equal(L([]), 'around empty space');
  assert.equal(L([make('div'), make('div')]), 'around 2 blocks');
  assert.equal(L([make('img')]), 'around 1 image');
  assert.equal(L([make('h2', 'Selected work'), make('div'), make('div')]), 'around \u201cSelected work\u201d and 2 more');
  assert.equal(L([make('h2', 'A'), make('p', 'B')]), 'around \u201cA\u201d and \u201cB\u201d');
});
