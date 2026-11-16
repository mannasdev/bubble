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
