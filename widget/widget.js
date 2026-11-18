// The chat bubble. Added to every page by the bubble proxy; talks to /__bubble/.
(function () {
  'use strict';
  if (window.top !== window.self) return; // not inside iframes
  if (window.__bubble) return; // only once per page

  var EASE = 'cubic-bezier(.2,.9,.3,1)';
  var SPRING = 'cubic-bezier(.3,1.5,.5,1)';
  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}',
    // Tokens. The panel is frosted glass so it sits on any site; one accent colour.
    '.wrap,.outline,.cursor{--accent:#2f6fed;--accent-soft:rgba(47,111,237,.14);--accent-line:rgba(47,111,237,.4)}',
    '.wrap{--del:#b3261e;--del-bg:rgba(214,60,50,.1);--add:#167a4a;--add-bg:rgba(43,182,115,.14);--bg:rgba(255,255,255,.88);--field:rgba(255,255,255,.9);--fg:#16161a;--muted:#6e6e78;--line:rgba(0,0,0,.09);--mine:rgba(0,0,0,.055);--err:#b3261e;--err-soft:rgba(179,38,30,.08);',
    'position:fixed;right:16px;bottom:16px;z-index:2147483647;font-size:14px;line-height:1.4;color:var(--fg);--ox:100%;--oy:100%;--dy:14px}',
    // It can be dragged to any corner; these move it and flip how the panel opens.
    '.wrap.left{right:auto;left:16px;--ox:0%}',
    '.wrap.top{bottom:auto;top:16px;--oy:0%;--dy:-14px}',
    '.left .panel{right:auto;left:0}',
    '.top .panel{bottom:auto;top:0}',
    '.left .badge{right:auto;left:-3px}',
    '.toggle,.head{touch-action:none;-webkit-user-select:none;user-select:none}',
    '.head{cursor:grab}',
    '.dragging,.dragging .toggle,.dragging .head{cursor:grabbing}',
    '.dragging .toggle{transform:scale(1.06);box-shadow:0 20px 40px -10px rgba(0,0,0,.55)}',
    '.dragging .toggle::after{animation:none}',
    '.dragging .panel{box-shadow:0 40px 90px -16px rgba(0,0,0,.5),0 6px 16px rgba(0,0,0,.14)}',
    '@media (prefers-color-scheme:dark){.wrap,.outline,.cursor{--accent:#5b8cff;--accent-soft:rgba(91,140,255,.18);--accent-line:rgba(91,140,255,.5)}',
    '.wrap{--del:#ff9a90;--del-bg:rgba(255,120,110,.13);--add:#6fdda6;--add-bg:rgba(60,200,130,.14);--bg:rgba(24,24,28,.86);--field:rgba(255,255,255,.05);--fg:#f3f3f6;--muted:#9a9aa6;--line:rgba(255,255,255,.11);--mine:rgba(255,255,255,.08);--err:#ff8a80;--err-soft:rgba(255,138,128,.1)}}',
    'button{font:inherit;color:inherit;cursor:pointer;border:0;background:none;padding:0}',
    'button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}',
    'svg{display:block;flex:none}',

    // Launcher: a pill that lifts on hover and has a slow breathing ring.
    '.toggle{position:relative;height:44px;padding:0 16px 0 13px;border-radius:22px;background:#16161a;color:#fff;border:1px solid rgba(255,255,255,.22);font-size:13px;font-weight:600;letter-spacing:.01em;display:flex;align-items:center;gap:8px;box-shadow:0 8px 24px -6px rgba(0,0,0,.45),0 1px 3px rgba(0,0,0,.25);transition:transform .28s ' + SPRING + ',opacity .18s ease,box-shadow .2s ease}',
    '.toggle::after{content:"";position:absolute;inset:-1px;border-radius:inherit;border:2px solid var(--accent);opacity:0;animation:breathe 3.2s ease-out infinite;pointer-events:none}',
    '@keyframes breathe{0%{opacity:.55;transform:scale(1)}60%,100%{opacity:0;transform:scale(1.14,1.4)}}',
    '.toggle:hover{transform:translateY(-2px);box-shadow:0 14px 30px -8px rgba(0,0,0,.5),0 2px 4px rgba(0,0,0,.25)}',
    '.toggle:active{transform:scale(.95)}',
    '.toggle .ico{transition:transform .4s ' + SPRING + '}',
    '.toggle:hover .ico{transform:rotate(-12deg) scale(1.1)}',
    '.spin{width:16px;height:16px;border-radius:50%;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;animation:spin .8s linear infinite;display:none}',
    '@keyframes spin{to{transform:rotate(360deg)}}',
    '.working .toggle .spin{display:block}',
    '.working .toggle .ico{display:none}',
    '.working .toggle::after{animation-duration:1.4s}',
    '.badge{position:absolute;top:-3px;right:-3px;width:12px;height:12px;border-radius:50%;background:var(--accent);border:2px solid #fff;transform:scale(0);transition:transform .3s ' + SPRING + '}',
    '.unread .badge{transform:scale(1)}',
    '.open .toggle{opacity:0;transform:scale(.6);pointer-events:none}',

    // Panel: springs out of the corner the launcher sits in.
    '.panel{position:absolute;right:0;bottom:0;width:min(344px,calc(100vw - 32px));max-height:min(560px,calc(100vh - 32px));display:flex;flex-direction:column;background:var(--bg);-webkit-backdrop-filter:blur(20px) saturate(1.5);backdrop-filter:blur(20px) saturate(1.5);border:1px solid var(--line);border-radius:18px;box-shadow:0 28px 70px -14px rgba(0,0,0,.4),0 4px 12px rgba(0,0,0,.1);overflow:hidden;',
    'transform-origin:var(--ox) var(--oy);opacity:0;transform:scale(.86) translateY(var(--dy));pointer-events:none;visibility:hidden;transition:transform .2s ease,opacity .16s ease,visibility 0s linear .2s}',
    '.open .panel{opacity:1;transform:none;pointer-events:auto;visibility:visible;transition:transform .36s ' + SPRING + ',opacity .18s ease,visibility 0s}',
    '.head{display:flex;align-items:center;gap:9px;padding:13px 10px 11px 15px;border-bottom:1px solid var(--line)}',
    '.live{width:8px;height:8px;border-radius:50%;background:#2bb673;flex:none;transition:background .3s}',
    '.working .live{background:var(--accent);animation:pulse 1.1s ease-in-out infinite}',
    '@keyframes pulse{0%,100%{box-shadow:0 0 0 0 var(--accent-line)}50%{box-shadow:0 0 0 5px rgba(0,0,0,0)}}',
    '.title{flex:1;font-weight:650;font-size:13.5px;letter-spacing:.005em}',
    '.close{width:28px;height:28px;border-radius:50%;color:var(--muted);display:grid;place-items:center;transition:background .15s,color .15s,transform .3s ' + SPRING + '}',
    '.close:hover{background:var(--mine);color:var(--fg);transform:rotate(90deg)}',

    '.list{flex:1;min-height:72px;overflow-y:auto;padding:14px 12px 8px;display:flex;flex-direction:column;gap:6px;scrollbar-width:thin}',
    '.empty{margin:auto;padding:8px 14px 14px;text-align:center;color:var(--muted);font-size:13px;display:flex;flex-direction:column;align-items:center;gap:8px;animation:rise .5s ' + EASE + ' both}',
    '.empty .ring{width:36px;height:36px;border-radius:50%;background:var(--accent-soft);color:var(--accent);display:grid;place-items:center;animation:float 3s ease-in-out infinite}',
    '@keyframes float{50%{transform:translateY(-4px)}}',
    '.msg{max-width:86%;padding:8px 12px;white-space:pre-wrap;overflow-wrap:anywhere}',
    '.msg.visitor{align-self:flex-end;background:var(--accent);color:#fff;border-radius:16px 16px 5px 16px;transform-origin:100% 100%}',
    '.msg.claude{align-self:flex-start;background:var(--mine);border-radius:16px 16px 16px 5px;transform-origin:0 100%}',
    '.msg.error{align-self:flex-start;background:var(--err-soft);color:var(--err);border:1px solid var(--err);border-radius:16px 16px 16px 5px;transform-origin:0 100%}',
    '.msg.new{animation:rise .38s ' + SPRING + ' both}',
    '.msg.error.new{animation:rise .38s ' + SPRING + ' both,shake .4s .3s}',
    '@keyframes rise{from{opacity:0;transform:translateY(12px) scale(.94)}}',
    '@keyframes shake{25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}',

    // "Claude is typing": three bouncing dots and a shimmer across the words.
    // Replies and the log of what was changed.
    '.quote{margin-bottom:5px;padding-left:8px;border-left:2px solid currentColor;font-size:12px;opacity:.8;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}',
    '.acts{display:flex;gap:2px;margin:6px -5px -3px}',
    '.acts button{display:flex;align-items:center;gap:4px;padding:3px 7px;border-radius:8px;font-size:12px;font-weight:550;color:var(--muted);transition:background .15s,color .15s}',
    '.acts button:hover{background:var(--mine);color:var(--fg)}',
    '.acts .ico{transition:transform .25s ' + EASE + '}',
    '.acts .openlog .ico{transform:rotate(180deg)}',
    '.log{display:flex;flex-direction:column;gap:6px;margin-top:8px;padding-top:8px;border-top:1px solid var(--line);font-size:12px}',
    '.step{animation:rise .28s ' + EASE + ' both}',
    '.step .verb{color:var(--muted)}',
    '.step .file{font-weight:600;overflow-wrap:anywhere}',
    '.diff{margin-top:4px;border:1px solid var(--line);border-radius:8px;overflow:hidden;font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}',
    '.diff div{padding:3px 7px;white-space:pre-wrap;overflow-wrap:anywhere}',
    '.del{background:var(--del-bg);color:var(--del);text-decoration:line-through}',
    '.add{background:var(--add-bg);color:var(--add)}',
    '.status .top{display:flex;align-items:center;gap:8px}',
    '.live-log{display:flex;flex-direction:column;gap:3px;font-size:12px}',
    '.live-log:empty{display:none}',
    '.status{display:flex;flex-direction:column;align-items:flex-start;gap:6px;max-width:86%;margin:0 12px 10px;padding:8px 12px;align-self:flex-start;background:var(--mine);border-radius:16px 16px 16px 5px;font-size:13px;animation:rise .3s ' + EASE + ' both}',
    '.dots{display:flex;gap:3px}',
    '.dots i{width:5px;height:5px;border-radius:50%;background:var(--accent);animation:hop 1.1s ease-in-out infinite}',
    '.dots i:nth-child(2){animation-delay:.14s}',
    '.dots i:nth-child(3){animation-delay:.28s}',
    '@keyframes hop{0%,60%,100%{transform:none;opacity:.45}30%{transform:translateY(-4px);opacity:1}}',
    '.what{background:linear-gradient(90deg,var(--muted) 35%,var(--fg) 50%,var(--muted) 65%);background-size:220% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:shimmer 1.8s linear infinite}',
    '@keyframes shimmer{from{background-position:120% 0}to{background-position:-100% 0}}',

    '.chip{margin:0 12px 8px;padding:6px 6px 6px 10px;border-radius:11px;background:var(--accent-soft);border:1px solid var(--accent-line);font-size:12px;display:flex;gap:8px;align-items:center;animation:rise .28s ' + SPRING + ' both}',
    '.chip .ico{color:var(--accent)}',
    '.chip span{flex:1;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}',
    '.chip button{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;color:var(--muted);transition:background .15s,color .15s}',
    '.chip button:hover{background:var(--mine);color:var(--fg)}',

    '.form{padding:0 12px 12px}',
    '.composer{border:1px solid var(--line);border-radius:15px;background:var(--field);transition:border-color .18s,box-shadow .18s}',
    '.composer:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}',
    'textarea{display:block;width:100%;height:42px;max-height:132px;resize:none;border:0;outline:0;background:none;padding:11px 12px 2px;font:inherit;color:var(--fg)}',
    'textarea::placeholder{color:var(--muted)}',
    '.row{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px}',
    '.point{display:flex;align-items:center;gap:6px;padding:6px 10px 6px 8px;border-radius:10px;font-size:12.5px;font-weight:550;color:var(--muted);transition:background .15s,color .15s,transform .15s}',
    '.point:hover{background:var(--mine);color:var(--fg)}',
    '.point:active{transform:scale(.96)}',
    '.point.on{background:var(--accent-soft);color:var(--accent);animation:nudge 1.2s ease-in-out infinite}',
    '@keyframes nudge{50%{box-shadow:0 0 0 4px var(--accent-soft)}}',
    '.send{width:32px;height:32px;border-radius:50%;background:var(--accent);color:#fff;display:grid;place-items:center;overflow:hidden;transition:transform .2s ' + SPRING + ',opacity .2s,filter .2s}',
    '.send:hover{transform:scale(1.08)}',
    '.send:active{transform:scale(.9)}',
    '.send:disabled{opacity:.32;filter:grayscale(1);cursor:default;transform:none}',
    '.send.sent svg{animation:fly .45s ' + EASE + '}',
    '@keyframes fly{45%{transform:translateY(-26px);opacity:0}46%{transform:translateY(26px);opacity:0}100%{transform:none;opacity:1}}',

    // On the page: the hover outline, the changed-here glow, and Claude's pointer.
    '.outline{position:fixed;pointer-events:none;border:1.5px solid var(--accent);background:var(--accent-soft);border-radius:5px;z-index:2147483646;transition:top .09s ease-out,left .09s ease-out,width .09s ease-out,height .09s ease-out}',
    '.outline b{position:absolute;left:-1.5px;bottom:100%;margin-bottom:3px;background:var(--accent);color:#fff;font-size:11px;font-weight:600;line-height:1;padding:4px 7px;border-radius:6px;white-space:nowrap}',
    '.outline.low b{bottom:auto;top:4px;left:4px;margin:0}',
    '.glow{transition:none;background:none;border-width:2px}',
    '.flash{animation:flash 1.7s ease-out forwards}',
    '@keyframes flash{0%{opacity:0;transform:scale(1.04)}14%{opacity:1;transform:none;box-shadow:0 0 0 0 var(--accent-line)}55%{opacity:1;box-shadow:0 0 0 12px rgba(0,0,0,0)}100%{opacity:0;box-shadow:0 0 0 12px rgba(0,0,0,0)}}',
    '.cursor{position:fixed;left:0;top:0;z-index:2147483646;pointer-events:none;display:flex;align-items:flex-start;color:var(--accent);opacity:0;transition:transform .8s cubic-bezier(.2,.8,.2,1),opacity .3s}',
    '.cursor.on{opacity:1}',
    '.arrow{filter:drop-shadow(0 2px 3px rgba(0,0,0,.3))}',
    '.arrow.plain{width:18px;height:22px;background:var(--accent);clip-path:polygon(0 0,0 78%,24% 60%,40% 100%,56% 93%,40% 55%,72% 55%);filter:none}',
    '.tag{margin:17px 0 0 -3px;background:var(--accent);color:#fff;font-size:11px;font-weight:600;line-height:1;padding:5px 8px;border-radius:3px 10px 10px 10px;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.2)}',
    '.tag.pop{animation:pop .4s ' + SPRING + '}',
    '@keyframes pop{from{transform:scale(.6)}}',
    '.cursor.busy .arrow{animation:bob 1s ease-in-out infinite}',
    '@keyframes bob{50%{transform:translateY(-4px)}}',
    '.ping{position:absolute;left:-13px;top:-13px;width:26px;height:26px;border-radius:50%;border:2px solid var(--accent);opacity:0}',
    '.ping.go{animation:ping .7s ease-out}',
    '@keyframes ping{from{opacity:.9;transform:scale(.2)}to{opacity:0;transform:scale(1.5)}}',

    '@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}',
    '[hidden]{display:none!important}',
  ].join('\n');

  var ICONS = {
    chat: 'M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20l1.3-4.6A8.5 8.5 0 1 1 21 11.5z',
    close: 'M18 6 6 18M6 6l12 12',
    send: 'M12 19V5M5 12l7-7 7 7',
    point: 'M4 4l6.5 15.5 2.3-6.7 6.7-2.3L4 4z',
    spark: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z',
    reply: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 6 6v3',
    down: 'M6 9l6 6 6-6',
  };

  // Icons are built node by node, like everything else here: no markup strings.
  function icon(name, size, filled) {
    if (!document.createElementNS) return el('span', 'ico');
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    var attrs = {
      class: 'ico', width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': 'true',
      fill: filled ? 'currentColor' : 'none', stroke: filled ? '#fff' : 'currentColor',
      'stroke-width': filled ? 1.5 : 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    };
    for (var key in attrs) svg.setAttribute(key, attrs[key]);
    var path = document.createElementNS(NS, 'path');
    path.setAttribute('d', ICONS[name]);
    svg.appendChild(path);
    return svg;
  }

  // A plain word for what she is hovering, shown on the outline.
  var KINDS = {
    h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
    p: 'text', span: 'text', em: 'text', strong: 'text', b: 'text', i: 'text', small: 'text', blockquote: 'quote',
    a: 'link', button: 'button', img: 'image', picture: 'image', svg: 'icon', video: 'video',
    ul: 'list', ol: 'list', li: 'list item', nav: 'menu', header: 'header', footer: 'footer',
    section: 'section', form: 'form', input: 'field', textarea: 'field', select: 'field', label: 'label',
    table: 'table', td: 'cell', th: 'cell',
  };

  function kindOf(node) {
    return KINDS[String(node.tagName || '').toLowerCase()] || 'block';
  }

  function restart(node, cls) {
    node.classList.remove(cls);
    void node.offsetWidth; // lets the same animation play again
    node.classList.add(cls);
  }

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

  // Which corner the bubble snaps to when dropped at this point.
  function cornerFor(x, y, width, height) {
    return (y < height / 2 ? 't' : 'b') + (x < width / 2 ? 'l' : 'r');
  }

  // Message text always goes in as text, never as markup.
  var VERBS = { search: 'Searched for', read: 'Looked at', edit: 'Edited', write: 'Wrote' };

  // One line of the change log; edits can show what was replaced with what.
  function stepNode(step, withDiff) {
    var node = el('div', 'step');
    node.append(
      el('span', 'verb', (VERBS[step.action] || 'Did') + ' '),
      el('span', 'file', step.file || '\u201c' + (step.query || '') + '\u201d'),
    );
    if (withDiff && step.action === 'edit' && (step.before || step.after)) {
      var diff = el('div', 'diff');
      if (step.before) diff.append(el('div', 'del', step.before));
      if (step.after) diff.append(el('div', 'add', step.after));
      node.append(diff);
    }
    return node;
  }

  function changeCount(steps) {
    var n = 0;
    for (var i = 0; i < (steps || []).length; i++) {
      if (steps[i].action === 'edit' || steps[i].action === 'write') n++;
    }
    return n;
  }

  function renderEntry(entry) {
    if (entry.role !== 'claude' && !entry.replyTo) return el('div', 'msg ' + entry.role, entry.text);
    var node = el('div', 'msg ' + entry.role);
    if (entry.replyTo) node.append(el('div', 'quote', entry.replyTo));
    node.append(el('div', 'body', entry.text));
    if (entry.role !== 'claude') return node;

    var acts = el('div', 'acts');
    var replyBtn = el('button');
    replyBtn.append(icon('reply', 13), el('span', '', 'Reply'));
    replyBtn.addEventListener('click', function () {
      setReply(entry.text);
    });
    acts.append(replyBtn);
    node.append(acts);

    var changes = changeCount(entry.steps);
    if (changes) {
      var log = el('div', 'log');
      log.hidden = true;
      var logBtn = el('button');
      logBtn.append(el('span', '', changes === 1 ? '1 change' : changes + ' changes'), icon('down', 13));
      logBtn.setAttribute('aria-expanded', 'false');
      logBtn.addEventListener('click', function () {
        var opening = log.hidden;
        if (opening && !log.children.length) {
          entry.steps.forEach(function (step) {
            log.append(stepNode(step, true));
          });
        }
        log.hidden = !opening;
        logBtn.classList.toggle('openlog', opening);
        logBtn.setAttribute('aria-expanded', String(opening));
        if (opening && node.scrollIntoView) node.scrollIntoView({ block: 'nearest' });
      });
      acts.append(logBtn);
      node.append(log);
    }
    return node;
  }

  window.__bubble = { describe: describe, renderEntry: renderEntry, pathTo: pathTo, clampPoint: clampPoint, gapAt: gapAt, kindOf: kindOf, cornerFor: cornerFor };

  var host = el('div');
  host.id = '__bubble_root';
  var root = host.attachShadow({ mode: 'open' });
  root.appendChild(el('style', '', CSS));

  var wrap = el('div', 'wrap');
  var toggle = el('button', 'toggle');
  toggle.setAttribute('aria-label', 'Ask for a change');
  toggle.append(icon('chat', 18), el('span', 'spin'), el('span', '', 'Ask for a change'), el('span', 'badge'));

  var panel = el('div', 'panel');
  var head = el('div', 'head');
  var close = el('button', 'close');
  close.setAttribute('aria-label', 'Close');
  close.append(icon('close', 16));
  head.append(el('span', 'live'), el('span', 'title', 'Ask for a change'), close);
  var list = el('div', 'list');
  var empty = el('div', 'empty');
  var emptyRing = el('div', 'ring');
  emptyRing.append(icon('spark', 18));
  empty.append(
    emptyRing,
    el('div', '', 'Type what you want changed on this page. Use Point to pick the exact thing, or an empty space, first.'),
  );
  var statusLine = el('div', 'status');
  var dots = el('span', 'dots');
  dots.append(el('i'), el('i'), el('i'));
  var statusText = el('span', 'what');
  var statusTop = el('div', 'top');
  statusTop.append(dots, statusText);
  var liveLog = el('div', 'live-log');
  statusLine.append(statusTop, liveLog);
  var chip = el('div', 'chip');
  var chipText = el('span');
  var chipClear = el('button');
  chipClear.setAttribute('aria-label', 'Stop pointing at this');
  chipClear.append(icon('close', 12));
  chip.append(icon('point', 14), chipText, chipClear);
  var replyChip = el('div', 'chip');
  var replyChipText = el('span');
  var replyClear = el('button');
  replyClear.setAttribute('aria-label', 'Stop replying to this');
  replyClear.append(icon('close', 12));
  replyChip.append(icon('reply', 14), replyChipText, replyClear);
  var form = el('div', 'form');
  var composer = el('div', 'composer');
  var input = el('textarea');
  input.setAttribute('placeholder', 'Make the heading bigger…');
  input.setAttribute('rows', '1');
  input.setAttribute('aria-label', 'What should change?');
  var row = el('div', 'row');
  var pointBtn = el('button', 'point');
  var pointLabel = el('span', '', 'Point');
  pointBtn.append(icon('point', 15), pointLabel);
  var sendBtn = el('button', 'send');
  sendBtn.setAttribute('aria-label', 'Send');
  sendBtn.append(icon('send', 16));
  sendBtn.disabled = true;
  row.append(pointBtn, sendBtn);
  composer.append(input, row);
  form.append(composer);
  panel.append(head, list, statusLine, replyChip, chip, form);
  var outline = el('div', 'outline');
  var outlineLabel = el('b');
  outline.append(outlineLabel);
  var flashBox = el('div', 'outline glow');
  var cursor = el('div', 'cursor');
  var arrow = icon('point', 22, true);
  arrow.setAttribute('class', document.createElementNS ? 'arrow' : 'arrow plain');
  var ping = el('div', 'ping');
  var tag = el('div', 'tag', 'Claude');
  cursor.append(ping, arrow, tag);
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
  var replyTo = null; // the message of Claude's she is answering
  var liveSteps = [];
  var isOpen = false;
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

  function setTag(text) {
    if (tag.textContent === text) return;
    tag.textContent = text;
    restart(tag, 'pop');
  }

  function cursorTo(node) {
    var box = node.getBoundingClientRect();
    placeCursor(box.left + Math.min(box.width / 2, 120), box.top + Math.min(box.height / 2, 40));
    // A click ripple as the pointer lands.
    window.setTimeout(function () {
      restart(ping, 'go');
    }, 650);
  }

  function flash(node) {
    var box = node.getBoundingClientRect();
    flashBox.style.top = box.top + 'px';
    flashBox.style.left = box.left + 'px';
    flashBox.style.width = box.width + 'px';
    flashBox.style.height = box.height + 'px';
    flashBox.hidden = false;
    restart(flashBox, 'flash');
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
    setTag('Claude');
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
    setTag('Done \u2713');
    cursorTo(node);
    flash(node);
    window.setTimeout(hideCursor, 2400);
  }

  function setOpen(open) {
    isOpen = open;
    wrap.classList.toggle('open', open);
    if (open) toggle.classList.remove('unread');
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

  function show(node, fresh) {
    if (count === 0) list.replaceChildren();
    count++;
    if (fresh) node.classList.add('new');
    list.appendChild(node);
    scrollDown();
  }

  // The box grows with what she types, up to a limit, and Send wakes up.
  function fit() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 132) + 'px';
    sendBtn.disabled = !String(input.value || '').trim();
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

  function setReply(text) {
    replyTo = text ? String(text).slice(0, 200) : null;
    replyChip.hidden = !replyTo;
    replyChipText.textContent = replyTo ? 'Replying to: \u201c' + replyTo.slice(0, 60) + (replyTo.length > 60 ? '\u2026' : '') + '\u201d' : '';
    if (replyTo) input.focus();
  }

  // While Claude works, the last few things it did show under the status.
  function showLive() {
    liveLog.replaceChildren();
    liveSteps.slice(-4).forEach(function (step) {
      liveLog.append(stepNode(step, false));
    });
    scrollDown();
  }

  function setPointing(on) {
    pointing = on;
    pointBtn.classList.toggle('on', on);
    pointLabel.textContent = on ? 'Click something…' : 'Point';
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
    if (replyTo) body.replyTo = replyTo;
    sendBtn.disabled = true;
    restart(sendBtn, 'sent');
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
        setReply(null);
      })
      .catch(function () {
        show(el('div', 'msg error', "That didn't send. Check your connection and try again."), true);
      })
      .then(fit);
  }

  function setCorner(corner) {
    wrap.classList.toggle('top', corner.charAt(0) === 't');
    wrap.classList.toggle('left', corner.charAt(1) === 'l');
    try {
      window.localStorage.setItem('bubble_corner', corner);
    } catch (e) {}
  }

  // Drag by the launcher or the panel's header; it snaps to the nearest corner.
  var drag = null;
  var justDragged = false;

  function visibleBox() {
    return (isOpen ? panel : toggle).getBoundingClientRect();
  }

  function dragStart(event) {
    if (event.button || (event.target && event.target.closest && event.target.closest('.close'))) return;
    drag = { x: event.clientX, y: event.clientY, moved: false, id: event.pointerId };
    // Follow the pointer across the whole page: a quick drag leaves the bubble at once.
    document.addEventListener('pointermove', dragMove, true);
    document.addEventListener('pointerup', dragEnd, true);
    document.addEventListener('pointercancel', dragEnd, true);
  }

  function dragMove(event) {
    if (!drag || event.pointerId !== drag.id) return;
    var dx = event.clientX - drag.x;
    var dy = event.clientY - drag.y;
    if (!drag.moved) {
      if (Math.abs(dx) + Math.abs(dy) < 6) return;
      drag.moved = true;
      wrap.classList.add('dragging');
      wrap.style.transition = 'none';
    }
    event.preventDefault();
    wrap.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
  }

  function dragEnd(event) {
    if (!drag || event.pointerId !== drag.id) return;
    var moved = drag.moved;
    drag = null;
    document.removeEventListener('pointermove', dragMove, true);
    document.removeEventListener('pointerup', dragEnd, true);
    document.removeEventListener('pointercancel', dragEnd, true);
    if (!moved) return;
    justDragged = true;
    window.setTimeout(function () {
      justDragged = false;
    }, 0);
    // Slide from where it was dropped into the corner it now belongs to.
    var from = visibleBox();
    setCorner(cornerFor(from.left + from.width / 2, from.top + from.height / 2, window.innerWidth, window.innerHeight));
    wrap.style.transform = '';
    var to = visibleBox();
    wrap.style.transform = 'translate(' + (from.left - to.left) + 'px,' + (from.top - to.top) + 'px)';
    void wrap.offsetWidth;
    wrap.classList.remove('dragging');
    wrap.style.transition = 'transform .45s ' + SPRING;
    wrap.style.transform = '';
  }

  toggle.addEventListener('pointerdown', dragStart);
  head.addEventListener('pointerdown', dragStart);

  toggle.addEventListener('click', function () {
    if (justDragged) return;
    setOpen(true);
  });
  close.addEventListener('click', function () {
    setPointing(false);
    setOpen(false);
  });
  sendBtn.addEventListener('click', send);
  input.addEventListener('input', fit);
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
  replyClear.addEventListener('click', function () {
    setReply(null);
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
      outlineLabel.textContent = space ? 'space \u00b7 ' + space.payload.gap : kindOf(event.target);
      outline.classList.toggle('low', box.top < 26);
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
      show(renderEntry(entry), false);
    });
  });
  source.addEventListener('entry', function (event) {
    var entry = JSON.parse(event.data);
    show(renderEntry(entry), true);
    if (entry.role === 'visitor') return;
    liveSteps = [];
    showLive();
    if (!isOpen) toggle.classList.add('unread');
    // Show the change even when the project has no live reload of its own.
    if (entry.role === 'claude' && entry.files && entry.files.length) {
      try {
        window.sessionStorage.setItem('bubble_flash', changedPath || workPath || '');
      } catch (e) {}
      setTag('Done \u2713');
      window.setTimeout(function () {
        window.location.reload();
      }, 1500);
    } else {
      hideCursor();
    }
    workPath = null;
  });
  source.addEventListener('step', function (event) {
    liveSteps.push(JSON.parse(event.data));
    showLive();
  });
  source.addEventListener('steps', function (event) {
    liveSteps = JSON.parse(event.data);
    showLive();
  });
  source.addEventListener('status', function (event) {
    var text = JSON.parse(event.data);
    statusText.textContent = text;
    statusLine.hidden = !text;
    wrap.classList.toggle('working', !!text);
    scrollDown();
    if (text && !working) startWork();
    if (!text && working) stopWork();
  });

  list.appendChild(empty);
  statusLine.hidden = true;
  setPointed(null);
  setReply(null);
  outline.hidden = true;
  flashBox.hidden = true;
  // Park the pointer by the bubble without animating, so its first glide
  // starts from there and not from the top-left corner.
  cursor.style.transition = 'none';
  var savedCorner = null;
  try {
    savedCorner = window.localStorage.getItem('bubble_corner');
  } catch (e) {}
  if (/^[tb][lr]$/.test(savedCorner || '')) setCorner(savedCorner);
  var home = toggle.getBoundingClientRect();
  placeCursor(home.left + home.width / 2, home.top + home.height / 2);
  void cursor.offsetWidth;
  cursor.style.transition = '';
  showAfterReload();
  var wasOpen = false;
  try {
    wasOpen = window.sessionStorage.getItem('bubble_open') === '1';
  } catch (e) {}
  setOpen(wasOpen);
})();
