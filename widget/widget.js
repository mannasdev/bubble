// The chat bubble. Added to every page by the bubble proxy; talks to /__bubble/.
(function () {
  'use strict';
  if (window.top !== window.self) return; // not inside iframes
  if (window.__bubble) return; // only once per page

  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}',
    '.wrap{--bg:#fff;--fg:#1a1a1a;--muted:#6b6b6b;--line:#e3e3e3;--accent:#1a1a1a;--on-accent:#fff;--mine:#f1f1f1;--err:#b3261e;',
    'position:fixed;right:16px;bottom:16px;z-index:2147483647;font-size:14px;line-height:1.4;color:var(--fg)}',
    '@media (prefers-color-scheme:dark){.wrap{--bg:#1e1e1e;--fg:#f2f2f2;--muted:#a0a0a0;--line:#383838;--accent:#f2f2f2;--on-accent:#1a1a1a;--mine:#2c2c2c;--err:#ff8a80}}',
    'button{font:inherit;color:inherit;cursor:pointer;border:0;background:none;padding:0}',
    'button:focus-visible,textarea:focus-visible{outline:2px solid var(--accent);outline-offset:2px}',
    '.toggle{width:48px;height:48px;border-radius:50%;background:#1a1a1a;color:#fff;border:2px solid #fff;font-size:20px;box-shadow:0 2px 10px rgba(0,0,0,.35);display:grid;place-items:center}',
    '.panel{width:min(320px,calc(100vw - 32px));max-height:60vh;display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--line);border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.2);overflow:hidden}',
    '.head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid var(--line);font-weight:600}',
    '.close{width:28px;height:28px;border-radius:6px;font-size:18px;color:var(--muted)}',
    '.list{flex:1;min-height:60px;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px}',
    '.empty{color:var(--muted)}',
    '.msg{max-width:88%;padding:7px 10px;border-radius:10px;white-space:pre-wrap;overflow-wrap:anywhere}',
    '.msg.visitor{align-self:flex-end;background:var(--mine)}',
    '.msg.claude{align-self:flex-start;border:1px solid var(--line)}',
    '.msg.error{align-self:flex-start;color:var(--err);border:1px solid var(--err)}',
    '.status{padding:0 12px 8px;color:var(--muted);font-size:13px}',
    '.chip{margin:0 12px 8px;padding:4px 8px;border-radius:6px;background:var(--mine);font-size:12px;display:flex;gap:8px;align-items:center;justify-content:space-between}',
    '.chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.form{border-top:1px solid var(--line);padding:8px 12px 12px;display:flex;flex-direction:column;gap:8px}',
    'textarea{width:100%;min-height:56px;max-height:140px;resize:none;border:1px solid var(--line);border-radius:8px;padding:8px;font:inherit;color:var(--fg);background:var(--bg)}',
    '.row{display:flex;justify-content:space-between;gap:8px}',
    '.btn{padding:6px 12px;border-radius:8px;border:1px solid var(--line)}',
    '.btn.primary{background:var(--accent);color:var(--on-accent);border-color:var(--accent)}',
    '.btn.on{border-color:var(--accent);font-weight:600}',
    '.outline{position:fixed;pointer-events:none;border:2px solid #2f6fed;background:rgba(47,111,237,.12);border-radius:2px;z-index:2147483646}',
    '[hidden]{display:none!important}',
  ].join('\n');

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function label(node) {
    var name = node.tagName.toLowerCase();
    if (node.id) return name + '#' + node.id;
    var classes = String(node.className || '').split(/\s+/).filter(Boolean).slice(0, 2);
    return classes.length ? name + '.' + classes.join('.') : name;
  }

  // "main > section.hero.big > h1#t": the element under up to three ancestors.
  function describe(node) {
    var parts = [label(node)];
    var up = node.parentElement;
    while (up && parts.length < 4 && up.tagName !== 'BODY' && up.tagName !== 'HTML') {
      parts.unshift(label(up));
      up = up.parentElement;
    }
    return parts.join(' > ');
  }

  // Message text always goes in as text, never as markup.
  function renderEntry(entry) {
    return el('div', 'msg ' + entry.role, entry.text);
  }

  window.__bubble = { describe: describe, renderEntry: renderEntry };

  var host = el('div');
  host.id = '__bubble_root';
  var root = host.attachShadow({ mode: 'open' });
  root.appendChild(el('style', '', CSS));

  var wrap = el('div', 'wrap');
  var toggle = el('button', 'toggle', '✎');
  toggle.setAttribute('aria-label', 'Ask for a change');
  toggle.setAttribute('title', 'Ask for a change');

  var panel = el('div', 'panel');
  var head = el('div', 'head');
  var close = el('button', 'close', '×');
  close.setAttribute('aria-label', 'Close');
  head.append(el('span', '', 'Ask for a change'), close);
  var list = el('div', 'list');
  var empty = el('div', 'empty', 'Type what you want changed on this page. Use Point to pick the exact thing first.');
  var statusLine = el('div', 'status');
  var chip = el('div', 'chip');
  var chipText = el('span');
  var chipClear = el('button', '', '×');
  chipClear.setAttribute('aria-label', 'Stop pointing at this');
  chip.append(chipText, chipClear);
  var form = el('div', 'form');
  var input = el('textarea');
  input.setAttribute('placeholder', 'Make the heading bigger…');
  input.setAttribute('rows', '2');
  input.setAttribute('aria-label', 'What should change?');
  var row = el('div', 'row');
  var pointBtn = el('button', 'btn', 'Point');
  var sendBtn = el('button', 'btn primary', 'Send');
  row.append(pointBtn, sendBtn);
  form.append(input, row);
  panel.append(head, list, statusLine, chip, form);
  var outline = el('div', 'outline');
  wrap.append(toggle, panel);
  root.append(wrap, outline);
  document.documentElement.appendChild(host);

  var pointed = null;
  var pointing = false;
  var count = 0;

  function setOpen(open) {
    panel.hidden = !open;
    toggle.hidden = open;
    try {
      window.sessionStorage.setItem('bubble_open', open ? '1' : '0');
    } catch (e) {}
    if (open) {
      scrollDown();
      input.focus();
    }
  }

  function scrollDown() {
    list.scrollTop = list.scrollHeight;
  }

  function show(node) {
    if (count === 0) list.replaceChildren();
    count++;
    list.appendChild(node);
    scrollDown();
  }

  function setPointed(value) {
    pointed = value;
    chip.hidden = !value;
    // She sees the words on the thing she picked; Claude gets the selector.
    var name = value && value.text ? '\u201c' + value.text.slice(0, 40) + '\u201d' : value && value.selector;
    chipText.textContent = value ? 'Pointing at: ' + name : '';
  }

  function setPointing(on) {
    pointing = on;
    pointBtn.classList.toggle('on', on);
    pointBtn.textContent = on ? 'Click something…' : 'Point';
    outline.hidden = true;
    document.documentElement.style.cursor = on ? 'crosshair' : '';
  }

  function inBubble(event) {
    var path = event.composedPath ? event.composedPath() : [];
    return path.indexOf(host) !== -1;
  }

  function send() {
    var text = String(input.value || '').trim();
    if (!text) return;
    var body = { text: text };
    if (pointed) body.pointed = pointed;
    sendBtn.disabled = true;
    window
      .fetch('/__bubble/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      .then(function (res) {
        if (!res.ok) throw new Error('refused');
        input.value = '';
        setPointed(null);
      })
      .catch(function () {
        show(el('div', 'msg error', "That didn't send. Check your connection and try again."));
      })
      .then(function () {
        sendBtn.disabled = false;
      });
  }

  toggle.addEventListener('click', function () {
    setOpen(true);
  });
  close.addEventListener('click', function () {
    setPointing(false);
    setOpen(false);
  });
  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      send();
    }
  });
  pointBtn.addEventListener('click', function () {
    setPointing(!pointing);
  });
  chipClear.addEventListener('click', function () {
    setPointed(null);
  });

  document.addEventListener(
    'mousemove',
    function (event) {
      if (!pointing) return;
      if (inBubble(event) || !event.target || !event.target.getBoundingClientRect) {
        outline.hidden = true;
        return;
      }
      var box = event.target.getBoundingClientRect();
      outline.style.top = box.top + 'px';
      outline.style.left = box.left + 'px';
      outline.style.width = box.width + 'px';
      outline.style.height = box.height + 'px';
      outline.hidden = false;
    },
    true,
  );
  document.addEventListener(
    'click',
    function (event) {
      if (!pointing || inBubble(event)) return;
      event.preventDefault();
      event.stopPropagation();
      var target = event.target;
      setPointed({
        selector: describe(target),
        text: String(target.innerText || target.textContent || '').trim().slice(0, 120),
        html: String(target.outerHTML || '').slice(0, 500),
      });
      setPointing(false);
      input.focus();
    },
    true,
  );
  document.addEventListener(
    'keydown',
    function (event) {
      if (pointing && event.key === 'Escape') setPointing(false);
    },
    true,
  );

  var source = new window.EventSource('/__bubble/events');
  source.addEventListener('history', function (event) {
    var entries = JSON.parse(event.data);
    count = 0;
    list.replaceChildren(empty);
    entries.forEach(function (entry) {
      show(renderEntry(entry));
    });
  });
  source.addEventListener('entry', function (event) {
    var entry = JSON.parse(event.data);
    show(renderEntry(entry));
    // Show the change even when the project has no live reload of its own.
    if (entry.role === 'claude' && entry.files && entry.files.length) {
      window.setTimeout(function () {
        window.location.reload();
      }, 1500);
    }
  });
  source.addEventListener('status', function (event) {
    var text = JSON.parse(event.data);
    statusLine.textContent = text;
    statusLine.hidden = !text;
    scrollDown();
  });

  list.appendChild(empty);
  statusLine.hidden = true;
  setPointed(null);
  outline.hidden = true;
  var wasOpen = false;
  try {
    wasOpen = window.sessionStorage.getItem('bubble_open') === '1';
  } catch (e) {}
  setOpen(wasOpen);
})();
