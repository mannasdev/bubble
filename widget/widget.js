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
    '.chip span{overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}',
    '.form{border-top:1px solid var(--line);padding:8px 12px 12px;display:flex;flex-direction:column;gap:8px}',
    'textarea{width:100%;min-height:56px;max-height:140px;resize:none;border:1px solid var(--line);border-radius:8px;padding:8px;font:inherit;color:var(--fg);background:var(--bg)}',
    '.row{display:flex;justify-content:space-between;gap:8px}',
    '.btn{padding:6px 12px;border-radius:8px;border:1px solid var(--line)}',
    '.btn.primary{background:var(--accent);color:var(--on-accent);border-color:var(--accent)}',
    '.btn.on{border-color:var(--accent);font-weight:600}',
    '.outline{position:fixed;pointer-events:none;border:2px solid #2f6fed;background:rgba(47,111,237,.12);border-radius:2px;z-index:2147483646}',
    '.flash{animation:flash 1.4s ease-out forwards}',
    '@keyframes flash{0%,40%{opacity:1}100%{opacity:0}}',
    '.cursor{position:fixed;left:0;top:0;z-index:2147483646;pointer-events:none;display:flex;align-items:flex-start;opacity:0;transition:transform .8s cubic-bezier(.2,.8,.2,1),opacity .3s}',
    '.cursor.on{opacity:1}',
    '.arrow{width:18px;height:22px;background:#2f6fed;clip-path:polygon(0 0,0 78%,24% 60%,40% 100%,56% 93%,40% 55%,72% 55%)}',
    '.tag{margin:16px 0 0 -4px;background:#2f6fed;color:#fff;font-size:11px;font-weight:600;line-height:1;padding:4px 7px;border-radius:9px;white-space:nowrap}',
    '.cursor.busy .arrow{animation:bob 1s ease-in-out infinite}',
    '@keyframes bob{50%{transform:translateY(-4px)}}',
    '@media (prefers-reduced-motion:reduce){.cursor{transition:opacity .3s}.cursor.busy .arrow{animation:none}}',
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

  // An exact route from <body>, so the same element can be found again after
  // the page reloads or the framework swaps it for a new copy.
  function pathTo(node) {
    var parts = [];
    while (node && node.parentElement && node.tagName !== 'BODY' && node.tagName !== 'HTML') {
      var siblings = node.parentElement.children;
      var index = 0;
      for (var i = 0; i < siblings.length; i++) {
        if (siblings[i].tagName === node.tagName) index++;
        if (siblings[i] === node) break;
      }
      parts.unshift(node.tagName.toLowerCase() + ':nth-of-type(' + index + ')');
      node = node.parentElement;
    }
    return ['body'].concat(parts).join(' > ');
  }

  // Is the point on empty space between these boxes? Says which boxes sit
  // just before and after it (-1 for none) and where the space starts and ends.
  function gapAt(rects, x, y) {
    var i;
    for (i = 0; i < rects.length; i++) {
      var r = rects[i];
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return null;
    }
    var sideways = false;
    for (i = 0; i < rects.length; i++) {
      if (y >= rects[i].top && y <= rects[i].bottom) sideways = true;
    }
    var lo = sideways ? 'left' : 'top';
    var hi = sideways ? 'right' : 'bottom';
    var at = sideways ? x : y;
    var gap = { axis: sideways ? 'x' : 'y', before: -1, after: -1, start: null, end: null };
    for (i = 0; i < rects.length; i++) {
      var box = rects[i];
      if (sideways && !(y >= box.top && y <= box.bottom)) continue;
      if (box[hi] <= at && (gap.start === null || box[hi] > gap.start)) {
        gap.before = i;
        gap.start = box[hi];
      }
      if (box[lo] >= at && (gap.end === null || box[lo] < gap.end)) {
        gap.after = i;
        gap.end = box[lo];
      }
    }
    return gap;
  }

  // Keep the fake pointer on screen, a little in from the edges.
  function clampPoint(x, y, width, height) {
    var edge = 12;
    return {
      x: Math.min(Math.max(x, edge), width - edge),
      y: Math.min(Math.max(y, edge), height - edge),
    };
  }

  // Message text always goes in as text, never as markup.
  function renderEntry(entry) {
    return el('div', 'msg ' + entry.role, entry.text);
  }

  window.__bubble = { describe: describe, renderEntry: renderEntry, pathTo: pathTo, clampPoint: clampPoint, gapAt: gapAt };

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
  var empty = el('div', 'empty', 'Type what you want changed on this page. Use Point to pick the exact thing, or an empty space, first.');
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
  var flashBox = el('div', 'outline');
  var cursor = el('div', 'cursor');
  cursor.append(el('div', 'arrow'), el('div', 'tag', 'Claude'));
  wrap.append(toggle, panel);
  root.append(wrap, outline, flashBox, cursor);
  document.documentElement.appendChild(host);

  var pointed = null;
  var pointedPath = null; // where she pointed, for the next message
  var pointedLabel = ''; // how an empty space she pointed at is described to her
  var workPath = null; // where she pointed, for the message being worked on
  var changedPath = null; // the last thing seen changing on the page
  var working = false;
  var observer = null;
  var pointing = false;
  var count = 0;

  function words(node) {
    return String(node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // 'h1#title "Wheelhouse"': what Claude is told about a neighbour.
  function nameFor(node) {
    var text = words(node).slice(0, 60);
    return describe(node) + (text ? ' "' + text + '"' : '');
  }

  // "Wheelhouse": what she is shown.
  function shortFor(node) {
    var text = words(node).slice(0, 28);
    return text ? '\u201c' + text + '\u201d' : 'the ' + node.tagName.toLowerCase();
  }

  function onOwnText(node, x, y) {
    if (!document.createRange) return false;
    for (var i = 0; i < node.childNodes.length; i++) {
      var child = node.childNodes[i];
      if (child.nodeType !== 3 || !child.nodeValue.trim()) continue;
      var range = document.createRange();
      range.selectNodeContents(child);
      var boxes = range.getClientRects();
      for (var j = 0; j < boxes.length; j++) {
        var b = boxes[j];
        if (x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) return true;
      }
    }
    return false;
  }

  // If the pointer is over empty space inside `node`, describe that space.
  function spaceAt(node, x, y) {
    if (!node.children || !node.children.length || onOwnText(node, x, y)) return null;
    var kids = [];
    var rects = [];
    for (var i = 0; i < node.children.length; i++) {
      var kid = node.children[i];
      if (kid === host || /^(SCRIPT|STYLE|LINK|META|HEAD)$/.test(kid.tagName)) continue;
      var r = kid.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      kids.push(kid);
      rects.push(r);
    }
    var gap = gapAt(rects, x, y);
    if (!gap) return null;
    var outer = node.getBoundingClientRect();
    var before = gap.before < 0 ? null : kids[gap.before];
    var after = gap.after < 0 ? null : kids[gap.after];
    var start = gap.start === null ? (gap.axis === 'y' ? outer.top : outer.left) : gap.start;
    var end = gap.end === null ? (gap.axis === 'y' ? outer.bottom : outer.right) : gap.end;
    var size = Math.max(Math.round(end - start), 0);
    var box =
      gap.axis === 'y'
        ? { left: outer.left, width: outer.width, top: start, height: Math.max(size, 6) }
        : { top: outer.top, height: outer.height, left: start, width: Math.max(size, 6) };
    var label;
    if (before && after) label = 'the space between ' + shortFor(before) + ' and ' + shortFor(after);
    else if (after) label = 'the space ' + (gap.axis === 'y' ? 'above ' : 'left of ') + shortFor(after);
    else if (before) label = 'the space ' + (gap.axis === 'y' ? 'below ' : 'right of ') + shortFor(before);
    else label = 'this empty space';
    return {
      box: box,
      label: label,
      near: after || before || node,
      payload: {
        kind: 'space',
        selector: describe(node),
        before: before ? nameFor(before) : '',
        after: after ? nameFor(after) : '',
        gap: size + (gap.axis === 'y' ? 'px tall' : 'px wide'),
      },
    };
  }

  function find(path) {
    try {
      return path && document.querySelector ? document.querySelector(path) : null;
    } catch (e) {
      return null;
    }
  }

  function placeCursor(x, y) {
    var point = clampPoint(x, y, window.innerWidth, window.innerHeight);
    cursor.style.transform = 'translate(' + point.x + 'px,' + point.y + 'px)';
  }

  function cursorTo(node) {
    var box = node.getBoundingClientRect();
    placeCursor(box.left + Math.min(box.width / 2, 120), box.top + Math.min(box.height / 2, 40));
  }

  function flash(node) {
    var box = node.getBoundingClientRect();
    flashBox.style.top = box.top + 'px';
    flashBox.style.left = box.left + 'px';
    flashBox.style.width = box.width + 'px';
    flashBox.style.height = box.height + 'px';
    flashBox.hidden = false;
    flashBox.classList.remove('flash');
    void flashBox.offsetWidth; // restart the fade
    flashBox.classList.add('flash');
  }

  function onScreen(node) {
    var box = node.getBoundingClientRect();
    return box.bottom > 0 && box.top < window.innerHeight;
  }

  // The page changed under us while Claude is working: show where.
  function sawChanges(mutations) {
    var node = null;
    for (var i = mutations.length - 1; i >= 0 && !node; i--) {
      var target = mutations[i].target;
      if (target && target.nodeType === 3) target = target.parentElement;
      if (!target || target.nodeType !== 1 || target === host || target === document.body) continue;
      if (/^(SCRIPT|STYLE|LINK|HEAD|META)$/.test(target.tagName)) continue;
      node = target;
    }
    if (!node) return;
    changedPath = pathTo(node);
    if (onScreen(node)) {
      cursorTo(node);
      flash(node);
    }
  }

  function startWork() {
    working = true;
    changedPath = null;
    cursor.classList.add('on', 'busy');
    var target = find(workPath);
    if (target && onScreen(target)) cursorTo(target);
    else placeCursor(window.innerWidth * 0.5, window.innerHeight * 0.4);
    if (window.MutationObserver && document.body) {
      observer = new window.MutationObserver(sawChanges);
      observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    }
  }

  function stopWork() {
    working = false;
    if (observer) observer.disconnect();
    observer = null;
    cursor.classList.remove('busy');
  }

  function hideCursor() {
    cursor.classList.remove('on', 'busy');
  }

  // After the page reloads with her change in it, point at what changed.
  function showAfterReload() {
    var path = null;
    try {
      path = window.sessionStorage.getItem('bubble_flash');
      window.sessionStorage.setItem('bubble_flash', '');
    } catch (e) {}
    var node = find(path);
    if (!node) return;
    if (!onScreen(node) && node.scrollIntoView) node.scrollIntoView({ block: 'center' });
    cursor.classList.add('on');
    cursorTo(node);
    flash(node);
    window.setTimeout(hideCursor, 2200);
  }

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
    if (!value) pointedPath = null;
    chip.hidden = !value;
    // She sees the words on the thing she picked; Claude gets the selector.
    var name = value && value.text ? '\u201c' + value.text.slice(0, 40) + '\u201d' : value && value.selector;
    if (value && value.kind === 'space') name = pointedLabel;
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
    // Set before sending: the "working" signal can arrive before the reply.
    if (!working) workPath = pointedPath;
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
      var space = spaceAt(event.target, event.clientX, event.clientY);
      var box = space ? space.box : event.target.getBoundingClientRect();
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
      var space = spaceAt(target, event.clientX, event.clientY);
      if (space) {
        pointedLabel = space.label;
        setPointed(space.payload);
        pointedPath = pathTo(space.near);
      } else {
        setPointed({
          selector: describe(target),
          text: String(target.innerText || target.textContent || '').trim().slice(0, 120),
          html: String(target.outerHTML || '').slice(0, 500),
        });
        pointedPath = pathTo(target);
      }
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
    if (entry.role === 'visitor') return;
    // Show the change even when the project has no live reload of its own.
    if (entry.role === 'claude' && entry.files && entry.files.length) {
      try {
        window.sessionStorage.setItem('bubble_flash', changedPath || workPath || '');
      } catch (e) {}
      window.setTimeout(function () {
        window.location.reload();
      }, 1500);
    } else {
      hideCursor();
    }
    workPath = null;
  });
  source.addEventListener('status', function (event) {
    var text = JSON.parse(event.data);
    statusLine.textContent = text;
    statusLine.hidden = !text;
    scrollDown();
    if (text && !working) startWork();
    if (!text && working) stopWork();
  });

  list.appendChild(empty);
  statusLine.hidden = true;
  setPointed(null);
  outline.hidden = true;
  flashBox.hidden = true;
  // Park the pointer by the bubble without animating, so its first glide
  // starts from there and not from the top-left corner.
  cursor.style.transition = 'none';
  placeCursor(window.innerWidth - 60, window.innerHeight - 60);
  void cursor.offsetWidth;
  cursor.style.transition = '';
  showAfterReload();
  var wasOpen = false;
  try {
    wasOpen = window.sessionStorage.getItem('bubble_open') === '1';
  } catch (e) {}
  setOpen(wasOpen);
})();
