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
    '.wrap,.outline,.cursor,.box,.sheet{--accent:#2f6fed;--accent-soft:rgba(47,111,237,.14);--accent-line:rgba(47,111,237,.4)}',
    '.wrap{--del:#b3261e;--del-bg:rgba(214,60,50,.1);--add:#167a4a;--add-bg:rgba(43,182,115,.14);--bg:rgba(255,255,255,.4);--field:rgba(255,255,255,.42);--fg:#141418;--muted:#4c4c58;--btn:rgba(255,255,255,.72);--btn-hover:#fff;--btn-line:rgba(0,0,0,.1);--line:rgba(255,255,255,.55);--edge:rgba(255,255,255,.6);--mine:rgba(255,255,255,.55);--sheen:.32;--err:#b3261e;--err-soft:rgba(179,38,30,.08);',
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
    '@media (prefers-color-scheme:dark){.wrap,.outline,.cursor,.box,.sheet{--accent:#5b8cff;--accent-soft:rgba(91,140,255,.18);--accent-line:rgba(91,140,255,.5)}',
    '.wrap{--del:#ff9a90;--del-bg:rgba(255,120,110,.13);--add:#6fdda6;--add-bg:rgba(60,200,130,.14);--bg:rgba(26,26,34,.6);--field:rgba(255,255,255,.07);--fg:#f6f6f8;--muted:#c9c9d3;--btn:rgba(255,255,255,.16);--btn-hover:rgba(255,255,255,.26);--btn-line:rgba(255,255,255,.2);--line:rgba(255,255,255,.13);--edge:rgba(255,255,255,.2);--mine:rgba(255,255,255,.11);--sheen:.14;--err:#ff8a80;--err-soft:rgba(255,138,128,.1)}}',
    'button{font:inherit;color:inherit;cursor:pointer;border:0;background:none;padding:0}',
    'button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}',
    'svg{display:block;flex:none}',

    // Launcher: a pill that lifts on hover and has a slow breathing ring.
    '.toggle{position:relative;height:44px;padding:0 16px 0 13px;border-radius:22px;background:rgba(22,22,30,.5);-webkit-backdrop-filter:blur(18px) saturate(1.8);backdrop-filter:blur(18px) saturate(1.8);color:#fff;border:1px solid rgba(255,255,255,.32);font-size:13px;font-weight:600;letter-spacing:.01em;display:flex;align-items:center;gap:8px;box-shadow:0 8px 24px -6px rgba(0,0,0,.4),0 1px 3px rgba(0,0,0,.2),inset 0 1px 0 rgba(255,255,255,.28);transition:transform .28s ' + SPRING + ',opacity .18s ease,box-shadow .2s ease}',
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
    '.panel{position:absolute;right:0;bottom:0;width:min(344px,calc(100vw - 32px));max-height:min(560px,calc(100vh - 32px));display:flex;flex-direction:column;background:var(--bg);-webkit-backdrop-filter:blur(30px) saturate(1.9) brightness(1.05);backdrop-filter:blur(30px) saturate(1.9) brightness(1.05);border:1px solid var(--edge);border-radius:22px;box-shadow:0 30px 80px -20px rgba(0,0,0,.38),0 6px 16px -6px rgba(0,0,0,.14),inset 0 1px 0 rgba(255,255,255,.5),inset 0 -1px 0 rgba(255,255,255,.08);overflow:hidden;',
    'transform-origin:var(--ox) var(--oy);opacity:0;transform:scale(.86) translateY(var(--dy));pointer-events:none;visibility:hidden;transition:transform .2s ease,opacity .16s ease,visibility 0s linear .2s}',
    // The liquid sheen: light catching the top-left edge of the glass.
    '.panel::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(140deg,rgba(255,255,255,var(--sheen)) 0%,rgba(255,255,255,0) 32%,rgba(255,255,255,0) 72%,rgba(255,255,255,calc(var(--sheen) / 2)) 100%)}',
    '.panel>*{position:relative}',
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
    '.acts{gap:6px!important;margin:8px 0 0!important;flex-wrap:wrap}',
    '.acts button{white-space:nowrap}',
    '.msg.claude{max-width:92%}',
    '.acts button{display:flex;align-items:center;gap:5px;padding:5px 10px;border-radius:9px;font-size:12px;font-weight:600;color:var(--fg);background:var(--btn);border:1px solid var(--btn-line);box-shadow:0 1px 2px rgba(0,0,0,.08),inset 0 1px 0 rgba(255,255,255,.18);transition:background .15s,color .15s,transform .15s}',
    '.acts button:hover{background:var(--btn-hover)}',
    '.acts button:active{transform:scale(.96)}',
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
    '.msg.note{align-self:center;max-width:none;padding:2px 10px;font-size:12px;color:var(--muted);animation:rise .3s ' + EASE + ' both}',
    '.acts .undo{color:var(--err)}',
    '.acts .undo:not(:disabled):hover{background:var(--err);color:#fff;border-color:var(--err)}',
    '.acts button:disabled{opacity:.6;cursor:default;background:none}',
    '.hbtn{width:28px;height:28px;border-radius:50%;color:var(--muted);display:grid;place-items:center;transition:background .15s,color .15s}',
    '.hbtn:hover{background:var(--mine);color:var(--fg)}',
    '.hist .hbtn{background:var(--accent-soft);color:var(--accent)}',
    '.hist .list,.hist .status,.hist .chip,.hist .form{display:none!important}',
    '.changes{display:none;flex:1;min-height:120px;overflow-y:auto;padding:12px;flex-direction:column;gap:8px}',
    '.hist .changes{display:flex}',
    // The goal: a plan she approves, then a progress bar while Claude works through it.
    '.goalv .list,.goalv .status,.goalv .chip,.goalv .form,.goalv .changes{display:none!important}',
    '.gview{display:none;flex:1;min-height:180px;overflow-y:auto;padding:14px;flex-direction:column;gap:11px}',
    '.goalv .gview{display:flex}',
    '.goalv .gbtn{background:var(--accent-soft);color:var(--accent)}',
    '.gtitle{font-weight:650;font-size:15px;line-height:1.3;overflow-wrap:anywhere}',
    '.ghint{font-size:12.5px;color:var(--muted)}',
    '.gfield{width:100%;min-height:76px;resize:vertical;border:1px solid var(--line);border-radius:12px;background:var(--field);color:var(--fg);font:inherit;padding:10px 12px;outline:0;box-shadow:inset 0 1px 0 rgba(255,255,255,.18)}',
    '.gfield:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}',
    '.gfield::placeholder{color:var(--muted)}',
    '.gacts{display:flex;gap:8px;flex-wrap:wrap;align-items:center}',
    '.gprimary{padding:8px 14px;border-radius:11px;background:var(--accent);color:#fff;font-weight:650;font-size:13px;box-shadow:0 4px 14px var(--accent-line),inset 0 1px 0 rgba(255,255,255,.3);transition:transform .15s,opacity .15s}',
    '.gprimary:hover{transform:translateY(-1px)}',
    '.gprimary:disabled{opacity:.4;transform:none;cursor:default}',
    '.gsecondary{padding:8px 12px;border-radius:11px;background:var(--btn);border:1px solid var(--btn-line);color:var(--fg);font-weight:600;font-size:13px;transition:background .15s}',
    '.gsecondary:hover{background:var(--btn-hover)}',
    '.gsecondary.danger{color:var(--err)}',
    '.gprog{display:flex;flex-direction:column;gap:7px}',
    '.gbar{position:relative;height:10px;border-radius:6px;background:var(--mine);overflow:hidden;box-shadow:inset 0 1px 2px rgba(0,0,0,.14)}',
    '.gfill{position:absolute;left:0;top:0;bottom:0;border-radius:6px;background:linear-gradient(90deg,var(--accent),#9b6dff);box-shadow:0 0 12px var(--accent-line);transition:width .9s ' + EASE + ';overflow:hidden}',
    '.gprog.running .gfill::after,.gstrip.running .gfill::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.5),rgba(255,255,255,0));background-size:45% 100%;background-repeat:no-repeat;animation:sweep 1.7s linear infinite}',
    '@keyframes sweep{from{background-position:-60% 0}to{background-position:170% 0}}',
    '.gcount{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:12.5px;color:var(--muted);font-variant-numeric:tabular-nums}',
    '.gcount b{color:var(--fg);font-size:15px}',
    '.gcount span:first-child{flex:none;white-space:nowrap}',
    '.gcount span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.gsteps{display:flex;flex-direction:column;gap:6px}',
    '.gstep{display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:11px;background:var(--mine);font-size:13px;line-height:1.3;animation:rise .3s ' + EASE + ' both}',
    '.gstep .mark{flex:none;width:18px;height:18px;border-radius:50%;display:grid;place-items:center;font-size:10.5px;font-weight:700;border:1.5px solid var(--muted);color:var(--muted)}',
    '.gstep.done .mark{background:#2bb673;border-color:#2bb673;color:#fff}',
    '.gstep.doing{background:var(--accent-soft);box-shadow:inset 0 0 0 1px var(--accent-line)}',
    '.gstep.doing .mark{border-color:var(--accent);border-top-color:transparent;animation:spin .8s linear infinite}',
    '.gstep.failed .mark{background:var(--err);border-color:var(--err);color:#fff}',
    '.gstep.skipped{opacity:.5}',
    '.gstep.skipped .gtext{text-decoration:line-through}',
    '.gtext{flex:1;min-width:0;overflow-wrap:anywhere}',
    '.gstep textarea{flex:1;min-width:0;border:0;background:none;color:var(--fg);font:inherit;line-height:1.3;outline:0;padding:0;resize:none;overflow:hidden;height:17px}',
    '.gstep.edit{align-items:flex-start}',
    '.gstep.edit .mark{margin-top:-1px}',
    '.gstep.still{animation:none}',
    '.gstep .rm{flex:none;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;color:var(--muted);transition:background .15s,color .15s}',
    '.gstep .rm:hover{background:var(--btn-hover);color:var(--err)}',
    '.gadd{width:100%;border:1px dashed var(--btn-line);border-radius:11px;background:none;color:var(--fg);font:inherit;font-size:13px;padding:8px 10px;outline:0}',
    '.gadd:focus{border-style:solid;border-color:var(--accent)}',
    '.gerr{font-size:13px;padding:10px 12px;border-radius:11px;background:var(--err-soft);border:1px solid var(--err);color:var(--fg);overflow-wrap:anywhere}',
    '.gwait{display:flex;align-items:center;gap:9px;font-size:13px}',
    '.gstrip{display:flex;flex-direction:column;gap:6px;padding:9px 14px 10px;border-bottom:1px solid var(--line);cursor:pointer;transition:background .15s}',
    '.gstrip:hover{background:var(--mine)}',
    '.gstrip .gbar{height:6px}',
    '.gstrip .gcount{font-size:12px}',
    '.gstrip .gcount b{font-size:12.5px}',
    '.goalv .gstrip,.hist .gstrip{display:none!important}',
    '.gline{position:absolute;left:16px;right:16px;bottom:6px;height:3px;border-radius:2px;background:rgba(255,255,255,.2);overflow:hidden}',
    '.gline i{position:absolute;left:0;top:0;bottom:0;border-radius:2px;background:linear-gradient(90deg,#8fb0ff,#c3a2ff);transition:width .9s ' + EASE + '}',
    '.crow{padding:10px 12px;border-radius:14px;background:var(--mine);display:flex;flex-direction:column;gap:3px;animation:rise .32s ' + EASE + ' both}',
    '.crow.undone{opacity:.55}',
    '.creq{font-weight:600;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}',
    '.crow.undone .creq{text-decoration:line-through}',
    '.cmeta{font-size:12px;color:var(--muted);overflow-wrap:anywhere}',
    '.crow .acts{margin-top:4px}',
    '.pill{font-size:11.5px;font-weight:600;padding:3px 8px;border-radius:8px;background:var(--mine);color:var(--muted)}',
    '.when{color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}',
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
    '.composer{border:1px solid var(--line);border-radius:16px;background:var(--field);box-shadow:inset 0 1px 0 rgba(255,255,255,.18);transition:border-color .18s,box-shadow .18s}',
    '.composer:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}',
    'textarea{display:block;width:100%;height:42px;max-height:132px;resize:none;border:0;outline:0;background:none;padding:11px 12px 2px;font:inherit;color:var(--fg)}',
    'textarea::placeholder{color:var(--muted)}',
    '.row{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px}',
    '.point{display:flex;align-items:center;gap:6px;padding:6px 11px 6px 9px;border-radius:10px;font-size:12.5px;font-weight:600;color:var(--fg);background:var(--btn);border:1px solid var(--btn-line);box-shadow:0 1px 2px rgba(0,0,0,.08),inset 0 1px 0 rgba(255,255,255,.18);transition:background .15s,color .15s,transform .15s}',
    '.point:hover{background:var(--btn-hover)}',
    '.tools{gap:6px!important}',
    '.point:active{transform:scale(.96)}',
    '.point.on{background:var(--accent);border-color:var(--accent);color:#fff;animation:nudge 1.2s ease-in-out infinite}',
    '.tools{display:flex;gap:2px}',
    // Drawing a box: a clear sheet over the page catches the drag.
    '.sheet{position:fixed;inset:0;z-index:2147483646;cursor:crosshair;touch-action:none;background:rgba(0,0,0,.04)}',
    '.box{position:fixed;pointer-events:none;z-index:2147483646;border:2px dashed var(--accent);background:var(--accent-soft);border-radius:6px;box-shadow:0 0 0 1px rgba(255,255,255,.5),0 0 18px var(--accent-line)}',
    '.box.kept{animation:boxin .3s ' + SPRING + '}',
    '@keyframes boxin{from{transform:scale(.96);opacity:.4}}',
    '.box b{position:absolute;left:-2px;bottom:100%;margin-bottom:4px;background:var(--accent);color:#fff;font-size:11px;font-weight:600;line-height:1;padding:4px 7px;border-radius:6px;white-space:nowrap}',
    '.box.low b{bottom:auto;top:4px;left:4px;margin:0}',
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
    '.cursor{position:fixed;left:0;top:0;z-index:2147483646;pointer-events:none;display:flex;align-items:flex-start;color:var(--accent);opacity:0;transition:opacity .3s;will-change:transform}',
    '.cursor.on{opacity:1}',
    '.arrow{position:relative;filter:drop-shadow(0 0 3px var(--accent)) drop-shadow(0 0 9px var(--accent-line)) drop-shadow(0 2px 3px rgba(0,0,0,.25))}',
    '.halo{position:absolute;left:-14px;top:-14px;width:36px;height:36px;border-radius:50%;background:radial-gradient(circle,var(--accent-line) 0%,rgba(0,0,0,0) 68%);animation:halo 2.2s ease-in-out infinite}',
    '@keyframes halo{50%{transform:scale(1.35);opacity:.6}}',
    '.trail{position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483645}',
    '.arrow.plain{width:18px;height:22px;background:var(--accent);clip-path:polygon(0 0,0 78%,24% 60%,40% 100%,56% 93%,40% 55%,72% 55%);filter:none}',
    // A thought bubble: two little puffs rising from the pointer to a cloud.
    '.think{position:absolute;left:14px;bottom:2px;pointer-events:none}',
    '.puff{position:absolute;border-radius:50%;background:var(--accent);box-shadow:0 0 10px var(--accent-line),inset 0 1px 0 rgba(255,255,255,.35)}',
    '.puff.p1{left:2px;bottom:0;width:6px;height:6px;animation:drift 2.4s ease-in-out infinite}',
    '.puff.p2{left:9px;bottom:9px;width:9px;height:9px;animation:drift 2.4s .3s ease-in-out infinite}',
    '.cloud{position:absolute;left:14px;bottom:18px;max-width:230px;padding:7px 12px;border-radius:16px;background:var(--accent);color:#fff;font-size:12px;font-weight:600;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:inset 0 1px 0 rgba(255,255,255,.35),0 0 0 1px rgba(255,255,255,.25),0 6px 20px var(--accent-line);transform-origin:0 100%;animation:float 3.2s ease-in-out infinite}',
    '.cloud span{display:inline-block}',
    '.cloud span.swap{animation:swap .45s ' + EASE + '}',
    '@keyframes swap{from{opacity:0;transform:translateY(6px)}}',
    '@keyframes drift{50%{transform:translate(1px,-2px)}}',
    '.think.pop .cloud{animation:pop .5s ' + SPRING + ',float 3.2s .5s ease-in-out infinite}',
    '.think.pop .puff.p1{animation:pop .3s ' + SPRING + ' both}',
    '.think.pop .puff.p2{animation:pop .3s .08s ' + SPRING + ' both}',
    '@keyframes pop{from{transform:scale(.3);opacity:0}}',
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
    box: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3',
    spark: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z',
    reply: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 6 6v3',
    down: 'M6 9l6 6 6-6',
    undo: 'M3 7v6h6M3 13a9 9 0 1 0 2.6-6.4L3 9',
    history: 'M12 7v5l3 2M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5M3.5 3.5v5h5',
    flag: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 12.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1z',
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
  var VERBS = { search: 'Searched for', read: 'Looked at', edit: 'Edited', write: 'Wrote', look: 'Looked at the page' };

  // One line of the change log; edits can show what was replaced with what.
  function stepNode(step, withDiff) {
    var node = el('div', 'step');
    node.append(
      el('span', 'verb', (VERBS[step.action] || 'Did') + ' '),
      el('span', 'file', step.action === 'look' ? '' : step.file || '\u201c' + (step.query || '') + '\u201d'),
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
    if (entry.change) acts.append(undoButton(entry.change));
    return node;
  }

  var undone = {}; // change id -> true once it has been undone
  var undoButtons = {}; // change id -> its Undo buttons, to update together

  function undoButton(id) {
    var btn = el('button', 'undo');
    var label = el('span', '', 'Undo');
    btn.append(icon('undo', 13), label);
    btn.setAttribute('title', 'Put the files back the way they were before this change');
    (undoButtons[id] = undoButtons[id] || []).push(btn);
    if (undone[id]) markUndone(id);
    btn.addEventListener('click', function () {
      undoChange(id);
    });
    return btn;
  }

  function markUndone(id) {
    undone[id] = true;
    (undoButtons[id] || []).forEach(function (btn) {
      btn.disabled = true;
      btn.lastChild.textContent = 'Undone';
    });
  }

  // The box between where a drag started and where it is now, in any direction.
  function boxBetween(x1, y1, x2, y2) {
    return { left: Math.min(x1, x2), top: Math.min(y1, y2), right: Math.max(x1, x2), bottom: Math.max(y1, y2) };
  }

  // Which of these boxes sit at least 80% inside the drawn one.
  function mostlyInside(rects, box) {
    var picked = [];
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i];
      var area = (r.right - r.left) * (r.bottom - r.top);
      if (area <= 0) continue;
      var w = Math.min(r.right, box.right) - Math.max(r.left, box.left);
      var h = Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top);
      if (w > 0 && h > 0 && (w * h) / area >= 0.8) picked.push(i);
    }
    return picked;
  }

  // Smooth start and finish for a glide.
  function easeInOut(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  // A point along a curve from `a` to `c` that bends toward `b`.
  function curvePoint(a, b, c, t) {
    var u = 1 - t;
    return { x: u * u * a.x + 2 * u * t * b.x + t * t * c.x, y: u * u * a.y + 2 * u * t * b.y + t * t * c.y };
  }

  // How long a glide takes: unhurried, a little longer for longer trips.
  function glideTime(dist) {
    return Math.min(Math.max(650 + dist * 1.3, 900), 1900);
  }

  // A step Claude took, as a short thought.
  function thoughtFor(step) {
    var file = step.file ? String(step.file).split('/').pop() : '';
    if (step.action === 'search') {
      var q = String(step.query || '');
      return /[*{}?\\|]/.test(q) || !q ? 'Looking through the files\u2026' : 'Looking for \u201c' + q.slice(0, 24) + '\u201d\u2026';
    }
    if (step.action === 'look') return 'Looking at the page\u2026';
    if (step.action === 'read') return 'Reading ' + file + '\u2026';
    if (step.action === 'edit') return 'Changing ' + file + '\u2026';
    if (step.action === 'write') return 'Writing ' + file + '\u2026';
    return 'Thinking\u2026';
  }

  window.__bubble = { easeInOut: easeInOut, curvePoint: curvePoint, glideTime: glideTime, thoughtFor: thoughtFor, boxLabel: boxLabel, boxBetween: boxBetween, mostlyInside: mostlyInside, describe: describe, renderEntry: renderEntry, pathTo: pathTo, clampPoint: clampPoint, gapAt: gapAt, kindOf: kindOf, cornerFor: cornerFor };

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
  var histBtn = el('button', 'hbtn');
  histBtn.setAttribute('aria-label', 'Changes');
  histBtn.setAttribute('title', 'Changes');
  histBtn.append(icon('history', 16));
  var title = el('span', 'title', 'Ask for a change');
  var goalBtn = el('button', 'hbtn gbtn');
  goalBtn.setAttribute('aria-label', 'Goal');
  goalBtn.setAttribute('title', 'Goal');
  goalBtn.append(icon('flag', 16));
  head.append(el('span', 'live'), title, goalBtn, histBtn, close);
  var changesView = el('div', 'changes');
  var goalView = el('div', 'gview');
  var strip = el('div', 'gstrip');
  strip.hidden = true;
  var gline = el('span', 'gline');
  var glineFill = el('i');
  gline.append(glineFill);
  gline.hidden = true;
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
  var statusTime = el('span', 'when');
  statusTop.append(dots, statusText, statusTime);
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
  var drawBtn = el('button', 'point');
  var drawLabel = el('span', '', 'Draw');
  drawBtn.append(icon('box', 15), drawLabel);
  drawBtn.setAttribute('title', 'Drag a box around the part you mean');
  var tools = el('div', 'tools');
  tools.append(pointBtn, drawBtn);
  row.append(tools, sendBtn);
  composer.append(input, row);
  form.append(composer);
  panel.append(head, strip, list, changesView, goalView, statusLine, replyChip, chip, form);
  var outline = el('div', 'outline');
  var outlineLabel = el('b');
  outline.append(outlineLabel);
  var flashBox = el('div', 'outline glow');
  var cursor = el('div', 'cursor');
  var arrow = icon('point', 22, true);
  arrow.setAttribute('class', document.createElementNS ? 'arrow' : 'arrow plain');
  var ping = el('div', 'ping');
  var think = el('div', 'think');
  var thought = el('span', '', 'Thinking\u2026');
  var cloud = el('div', 'cloud');
  cloud.append(thought);
  think.append(el('div', 'puff p1'), el('div', 'puff p2'), cloud);
  cursor.append(el('div', 'halo'), ping, arrow, think);
  var trail = el('canvas', 'trail');
  toggle.append(gline);
  wrap.append(toggle, panel);
  root.append(wrap, outline, flashBox, trail, cursor);
  document.documentElement.appendChild(host);

  var pointed = null;
  var pointedPath = null; // where she pointed, for the next message
  var pointedLabel = ''; // how an empty space she pointed at is described to her
  var pointedFocus = null; // the area she pointed at or drew, in page coordinates

  // A box on screen as a box on the page, so it holds when the page scrolls.
  function onPage(r) {
    var left = r.left !== undefined ? r.left : r.x;
    var top = r.top !== undefined ? r.top : r.y;
    var width = r.width !== undefined ? r.width : r.right - r.left;
    var height = r.height !== undefined ? r.height : r.bottom - r.top;
    return { x: left + (window.scrollX || 0), y: top + (window.scrollY || 0), width: width, height: height };
  }
  var drawing = false;
  var sheet = null; // the layer that catches the drag while drawing
  var liveBox = null; // the box while it is being dragged
  var keptBox = null; // the box she drew, shown until the message is sent
  var keptAt = null; // where it is, in page coordinates so it scrolls with the page
  var workPath = null; // where she pointed, for the message being worked on
  var changedPath = null; // the last thing seen changing on the page
  var working = false;
  var observer = null;
  var pointing = false;
  var replyTo = null; // the message of Claude's she is answering
  var liveSteps = [];
  var allEntries = []; // the whole conversation, for the Changes view
  var showingChanges = false;
  var workSince = 0;
  var workClock = null;
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

  // Claude's pointer drifts along gentle curves and leaves a soft glowing trail.
  var pos = { x: 0, y: 0 };
  var glideFrom = null; // the glide in progress: from, bend, to, start, length
  var trailPoints = [];
  var moving = null;
  var trailColor = '47,111,237';
  var TRAIL_MS = 520;
  var calm = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var pen = trail.getContext ? trail.getContext('2d') : null;

  function drawCursor() {
    cursor.style.transform = 'translate(' + pos.x + 'px,' + pos.y + 'px)';
  }

  function jumpCursor(x, y) {
    var point = clampPoint(x, y, window.innerWidth, window.innerHeight);
    pos.x = point.x;
    pos.y = point.y;
    glideFrom = null;
    trailPoints = [];
    drawCursor();
  }

  function paintTrail(now) {
    if (!pen) return;
    var ratio = window.devicePixelRatio || 1;
    var w = window.innerWidth;
    var h = window.innerHeight;
    if (trail.width !== Math.round(w * ratio) || trail.height !== Math.round(h * ratio)) {
      trail.width = Math.round(w * ratio);
      trail.height = Math.round(h * ratio);
    }
    pen.setTransform(ratio, 0, 0, ratio, 0, 0);
    pen.clearRect(0, 0, w, h);
    if (!cursor.classList.contains('on')) return;
    pen.lineCap = 'round';
    pen.shadowColor = 'rgba(' + trailColor + ',.8)';
    for (var i = 1; i < trailPoints.length; i++) {
      var a = trailPoints[i - 1];
      var b = trailPoints[i];
      var life = 1 - (now - b.t) / TRAIL_MS; // 1 = just drawn, 0 = gone
      if (life <= 0) continue;
      pen.strokeStyle = 'rgba(' + trailColor + ',' + (0.7 * life * life).toFixed(3) + ')';
      pen.lineWidth = 1 + 5 * life;
      pen.shadowBlur = 16 * life;
      pen.beginPath();
      pen.moveTo(a.x + 4, a.y + 4); // from the arrow's tip
      pen.lineTo(b.x + 4, b.y + 4);
      pen.stroke();
    }
  }

  function frame(now) {
    if (glideFrom) {
      var g = glideFrom;
      var t = Math.min((now - g.start) / g.length, 1);
      var point = curvePoint(g.from, g.bend, g.to, easeInOut(t));
      pos.x = point.x;
      pos.y = point.y;
      trailPoints.push({ x: pos.x, y: pos.y, t: now });
      if (t >= 1) {
        glideFrom = null;
        if (g.landed) g.landed();
      }
    }
    while (trailPoints.length && now - trailPoints[0].t > TRAIL_MS) trailPoints.shift();
    drawCursor();
    paintTrail(now);
    moving = !glideFrom && !trailPoints.length ? null : window.requestAnimationFrame(frame);
  }

  // Glide to a point along a soft curve. `slow` is for idle wandering.
  function placeCursor(x, y, opts) {
    opts = opts || {};
    var point = clampPoint(x, y, window.innerWidth, window.innerHeight);
    if (calm || !window.requestAnimationFrame) {
      jumpCursor(point.x, point.y);
      if (opts.landed) opts.landed();
      return;
    }
    var from = { x: pos.x, y: pos.y };
    var dist = Math.hypot(point.x - from.x, point.y - from.y);
    if (dist < 2) {
      if (opts.landed) opts.landed();
      return;
    }
    // Bow the path a little to one side, like a hand moving a mouse.
    var side = Math.random() < 0.5 ? -1 : 1;
    var bowl = Math.min(dist * 0.22, 90) * side;
    var bend = {
      x: (from.x + point.x) / 2 - ((point.y - from.y) / dist) * bowl,
      y: (from.y + point.y) / 2 + ((point.x - from.x) / dist) * bowl,
    };
    glideFrom = {
      from: from,
      bend: bend,
      to: point,
      start: window.performance ? window.performance.now() : Date.now(),
      length: glideTime(dist) * (opts.slow ? 1.5 : 1),
      landed: opts.landed,
    };
    var rgb = /(\d+),\s*(\d+),\s*(\d+)/.exec(window.getComputedStyle ? window.getComputedStyle(cursor).color : '');
    if (rgb) trailColor = rgb[1] + ',' + rgb[2] + ',' + rgb[3];
    if (!moving) moving = window.requestAnimationFrame(frame);
  }

  // What the pointer is "thinking", in a bubble above it.
  var lastThought = 0;
  function setThought(text, quietly) {
    if (thought.textContent === text) return;
    thought.textContent = text;
    lastThought = Date.now();
    if (!quietly) restart(thought, 'swap');
  }

  function popThought() {
    restart(think, 'pop');
  }

  // While Claude works the pointer idles about where it is working, now and
  // then with a passing thought, so a long wait still feels alive.
  var IDLE_THOUGHTS = ['Thinking…', 'Hmm…', 'Looking around…', 'Getting an idea…', 'Almost…'];
  var wanderTimer = null;

  function wander() {
    wanderTimer = null;
    if (!working || calm) return;
    var anchor = find(changedPath) || find(workPath);
    var box = anchor && onScreen(anchor) ? anchor.getBoundingClientRect() : null;
    var x;
    var y;
    if (box) {
      x = box.left + 12 + Math.random() * Math.max(box.width - 24, 1);
      y = box.top + 10 + Math.random() * Math.max(Math.min(box.height, 240) - 20, 1);
    } else {
      x = pos.x + (Math.random() - 0.5) * 220;
      y = pos.y + (Math.random() - 0.5) * 140;
    }
    placeCursor(x, y, { slow: true });
    if (Date.now() - lastThought > 4500) {
      setThought(IDLE_THOUGHTS[Math.floor(Math.random() * IDLE_THOUGHTS.length)]);
    }
    wanderTimer = window.setTimeout(wander, 1800 + Math.random() * 1600);
  }

  function cursorTo(node) {
    var box = node.getBoundingClientRect();
    placeCursor(box.left + Math.min(box.width / 2, 120), box.top + Math.min(box.height / 2, 40), {
      // A click ripple as the pointer lands.
      landed: function () {
        restart(ping, 'go');
      },
    });
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
    setThought('Thinking\u2026', true);
    cursor.classList.add('on', 'busy');
    popThought();
    if (wanderTimer) window.clearTimeout(wanderTimer);
    wanderTimer = window.setTimeout(wander, 2600);
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
    if (wanderTimer) window.clearTimeout(wanderTimer);
    wanderTimer = null;
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
    setThought('Done \u2713', true);
    popThought();
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
    if (!value) {
      pointedPath = null;
      pointedFocus = null;
    }
    chip.hidden = !value;
    // She sees the words on the thing she picked; Claude gets the selector.
    var name = value && value.text ? '\u201c' + value.text.slice(0, 40) + '\u201d' : value && value.selector;
    if (value && value.kind === 'space') name = pointedLabel;
    if (value && value.kind === 'area') name = pointedLabel;
    chipText.textContent = value ? (value.kind === 'area' ? 'Drew a box ' : 'Pointing at: ') + name : '';
    if (!value || value.kind !== 'area') dropBox();
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

  var UNDO_PROBLEMS = {
    conflict: "Can't undo that one: something changed the same spot since. Undo the later change first.",
    busy: 'Wait until Claude has finished, then try again.',
    unavailable: "Undo isn't available for this project.",
  };

  function undoChange(id) {
    if (undone[id]) return;
    (undoButtons[id] || []).forEach(function (btn) {
      btn.disabled = true;
      btn.lastChild.textContent = 'Undoing\u2026';
    });
    window
      .fetch('/__bubble/undo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: id }),
      })
      .then(function (res) {
        if (res.ok) return null;
        return res.json().then(
          function (body) {
            return body.error || 'unavailable';
          },
          function () {
            return 'unavailable';
          },
        );
      }, function () {
        return 'offline';
      })
      .then(function (problem) {
        if (!problem) return; // the note that follows marks it undone and reloads
        if (problem === 'done') return markUndone(id);
        (undoButtons[id] || []).forEach(function (btn) {
          btn.disabled = false;
          btn.lastChild.textContent = 'Undo';
        });
        if (showingChanges) setChangesOpen(false);
        show(el('div', 'msg error', UNDO_PROBLEMS[problem] || "That didn't go through. Check your connection and try again."), true);
      });
  }

  function timeAgo(at) {
    var seconds = Math.max(0, Math.round((Date.now() - Date.parse(at)) / 1000));
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return Math.floor(seconds / 60) + ' min ago';
    if (seconds < 86400) return Math.floor(seconds / 3600) + ' h ago';
    return new Date(at).toLocaleDateString();
  }

  // Every change Claude made, newest first, each with its edits and an Undo.
  function renderChanges() {
    changesView.replaceChildren();
    var rows = [];
    var asked = '';
    allEntries.forEach(function (entry) {
      if (entry.role === 'visitor') asked = entry.text;
      if (entry.role === 'claude' && entry.change) rows.unshift({ entry: entry, asked: asked });
    });
    if (!rows.length) {
      var none = el('div', 'empty');
      none.append(el('div', '', 'No changes yet. When Claude edits something it shows up here, and you can undo it.'));
      changesView.append(none);
      return;
    }
    rows.forEach(function (row, i) {
      var entry = row.entry;
      var card = el('div', 'crow' + (undone[entry.change] ? ' undone' : ''));
      card.style.animationDelay = Math.min(i, 8) * 35 + 'ms';
      var files = (entry.files || []).join(', ');
      card.append(
        el('div', 'creq', row.asked || entry.text),
        el('div', 'cmeta', timeAgo(entry.at) + (files ? ' \u00b7 ' + files : '')),
      );
      var acts = el('div', 'acts');
      if (changeCount(entry.steps)) {
        var log = el('div', 'log');
        log.hidden = true;
        var logBtn = el('button');
        logBtn.append(el('span', '', 'Show edits'), icon('down', 13));
        logBtn.addEventListener('click', function () {
          var opening = log.hidden;
          if (opening && !log.children.length) {
            entry.steps.forEach(function (step) {
              if (step.action === 'edit' || step.action === 'write') log.append(stepNode(step, true));
            });
          }
          log.hidden = !opening;
          logBtn.classList.toggle('openlog', opening);
        });
        acts.append(logBtn);
        card.append(acts, log);
      } else {
        card.append(acts);
      }
      acts.append(undoButton(entry.change));
      changesView.append(card);
    });
  }

  function setChangesOpen(open) {
    if (open && showingGoal) setGoalOpen(false);
    showingChanges = open;
    panel.classList.toggle('hist', open);
    title.textContent = open ? 'Changes' : 'Ask for a change';
    if (open) renderChanges();
  }

  // ---- The goal ----
  var goalState = null; // as the server last described it
  var showingGoal = false;
  var goalShown = ''; // which goal and status the view was last built for
  var draftSteps = null; // her edits to the plan before she starts it
  var goalProblem = '';

  function setGoalOpen(open) {
    if (open && showingChanges) setChangesOpen(false);
    showingGoal = open;
    panel.classList.toggle('goalv', open);
    try {
      window.sessionStorage.setItem('bubble_goalview', open ? '1' : '0');
    } catch (e) {}
    title.textContent = open ? 'Goal' : 'Ask for a change';
    goalShown = '';
    if (open) renderGoal();
  }

  function doneOf(g) {
    return g.steps.filter(function (s) {
      return s.status === 'done';
    }).length;
  }

  function progressBox(g, cls) {
    var done = doneOf(g);
    var total = g.steps.length || 1;
    var box = el('div', cls + (g.status === 'running' ? ' running' : ''));
    var count = el('div', 'gcount');
    var left = el('span');
    left.append(el('b', '', String(done)), document.createTextNode(' of ' + g.steps.length + ' done'));
    var current = g.steps.filter(function (s) {
      return s.status === 'doing';
    })[0];
    var right = {
      running: current ? current.text : 'Working\u2026',
      paused: 'Paused',
      done: 'Done \u2713',
      stopped: 'Stopped',
    }[g.status] || '';
    count.append(left, el('span', '', right));
    var bar = el('div', 'gbar');
    var fill = el('div', 'gfill');
    fill.style.width = Math.round((done / total) * 100) + '%';
    bar.append(fill);
    box.append(count, bar);
    return box;
  }

  function goalCall(action, body) {
    goalProblem = '';
    return window
      .fetch('/__bubble/goal' + (action ? '/' + action : ''), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      })
      .then(
        function (res) {
          if (!res.ok) {
            goalProblem = res.status === 409 ? 'Wait until Claude has finished, then try again.' : "That didn't work. Try again.";
            goalShown = '';
            renderGoal();
          }
          return res.ok;
        },
        function () {
          goalProblem = "That didn't go through. Check your connection and try again.";
          goalShown = '';
          renderGoal();
          return false;
        },
      );
  }

  function stepRow(step, i, editable) {
    var row = el('div', 'gstep ' + (step.status || 'todo'));
    row.style.animationDelay = Math.min(i, 8) * 40 + 'ms';
    var mark = el('span', 'mark', step.status === 'done' ? '\u2713' : step.status === 'failed' ? '!' : step.status === 'doing' ? '' : String(i + 1));
    row.append(mark);
    if (editable) {
      // Edits touch only this row, so nothing jumps or replays while she works.
      row.classList.add('edit');
      var place = function () {
        return Array.prototype.indexOf.call(row.parentElement ? row.parentElement.children : [], row);
      };
      var field = el('textarea');
      field.value = step.text;
      field.setAttribute('rows', '1');
      field.setAttribute('aria-label', 'Step ' + (i + 1));
      var grow = function () {
        field.style.height = 'auto';
        field.style.height = field.scrollHeight + 'px';
      };
      field.addEventListener('input', function () {
        draftSteps[place()] = field.value;
        grow();
      });
      field.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') event.preventDefault();
      });
      window.setTimeout(grow, 0);
      var rm = el('button', 'rm');
      rm.setAttribute('aria-label', 'Remove this step');
      rm.append(icon('close', 12));
      rm.addEventListener('click', function () {
        var holder = row.parentElement;
        draftSteps.splice(place(), 1);
        row.remove();
        renumber(holder);
      });
      row.append(field, rm);
    } else {
      row.append(el('span', 'gtext', step.text));
    }
    return row;
  }

  function renumber(holder) {
    if (!holder) return;
    Array.prototype.forEach.call(holder.children, function (row, n) {
      row.firstChild.textContent = String(n + 1);
    });
  }

  function goalForm(prefill) {
    goalView.append(
      el('div', 'gtitle', 'Set a goal'),
      el('div', 'ghint', 'Describe what this page should become. Claude plans the steps, you check them, then it works through them on its own.'),
    );
    var field = el('textarea', 'gfield');
    field.setAttribute('placeholder', 'Make the homepage ready for launch\u2026');
    field.setAttribute('aria-label', 'Your goal');
    if (prefill) field.value = prefill;
    var go = el('button', 'gprimary', 'Plan it');
    go.disabled = !String(field.value).trim();
    field.addEventListener('input', function () {
      go.disabled = !String(field.value).trim();
    });
    go.addEventListener('click', function () {
      var text = String(field.value || '').trim();
      if (!text) return;
      go.disabled = true;
      goalCall('', { text: text, view: currentView(null) });
    });
    var acts = el('div', 'gacts');
    acts.append(go);
    goalView.append(field, acts);
    window.setTimeout(function () {
      if (field.focus) field.focus();
    }, 50);
  }

  function renderGoal() {
    var g = goalState;
    // The strip in the chat view and the line on the launcher.
    var live = g && (g.status === 'running' || g.status === 'paused' || g.status === 'review' || g.status === 'planning');
    strip.hidden = !live;
    gline.hidden = !(g && (g.status === 'running' || g.status === 'paused'));
    if (live) {
      strip.replaceChildren();
      if (g.status === 'planning' || g.status === 'review') {
        var line = el('div', 'gcount');
        line.append(el('span', '', g.status === 'planning' ? 'Planning your goal\u2026' : 'Your plan is ready. Review it'), el('span', '', '\u203a'));
        strip.append(line);
        strip.classList.remove('running');
      } else {
        var p = progressBox(g, 'gprog');
        strip.append.apply(strip, Array.prototype.slice.call(p.children));
        strip.classList.toggle('running', g.status === 'running');
        glineFill.style.width = Math.round((doneOf(g) / (g.steps.length || 1)) * 100) + '%';
      }
    }
    if (!showingGoal) return;

    // Rebuild the view only when something she could be typing into would not be lost.
    var key = g ? g.id + ':' + g.status + ':' + JSON.stringify(g.steps.map(function (s) { return s.status; })) : 'none';
    if (key === goalShown && !(g && g.status === 'running')) return;
    if (g && g.status === 'review' && goalShown.indexOf(g.id + ':review') === 0) return;
    goalShown = key;
    goalView.replaceChildren();
    if (goalProblem) goalView.append(el('div', 'gerr', goalProblem));

    if (!g) return goalForm('');
    if (g.status === 'failed') {
      goalView.append(el('div', 'gerr', g.error || 'Claude could not plan that.'));
      return goalForm(g.text);
    }
    goalView.append(el('div', 'gtitle', g.text));

    if (g.status === 'planning') {
      var wait = el('div', 'gwait');
      var dotsBox = el('span', 'dots');
      dotsBox.append(el('i'), el('i'), el('i'));
      wait.append(dotsBox, el('span', 'what', 'Claude is looking at the page and planning the steps\u2026'));
      goalView.append(wait);
      return;
    }

    if (g.status === 'review') {
      if (!draftSteps) draftSteps = g.steps.map(function (s) { return s.text; });
      goalView.append(el('div', 'ghint', 'Check the plan. Change, remove or add steps, then start. Each step becomes its own change you can undo.'));
      var list_ = el('div', 'gsteps');
      draftSteps.forEach(function (text, i) {
        list_.append(stepRow({ text: text, status: 'todo' }, i, true));
      });
      var add = el('input', 'gadd');
      add.setAttribute('placeholder', '+ Add a step');
      add.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' && String(add.value).trim()) {
          draftSteps.push(String(add.value).trim());
          var added = stepRow({ text: String(add.value).trim(), status: 'todo' }, draftSteps.length - 1, true);
          list_.append(added);
          add.value = '';
        }
      });
      var start = el('button', 'gprimary', 'Start autopilot');
      start.addEventListener('click', function () {
        var steps = draftSteps.map(function (t) { return String(t).trim(); }).filter(Boolean);
        if (!steps.length) return;
        start.disabled = true;
        goalCall('start', { steps: steps }).then(function (ok) {
          if (ok) draftSteps = null;
        });
      });
      var cancel = el('button', 'gsecondary', 'Cancel');
      cancel.addEventListener('click', function () {
        draftSteps = null;
        goalCall('stop').then(function () {
          goalCall('clear');
        });
      });
      var acts = el('div', 'gacts');
      acts.append(start, cancel);
      goalView.append(list_, add, acts);
      return;
    }

    // Running, paused, done or stopped: the progress bar and the steps.
    draftSteps = null;
    goalView.append(progressBox(g, 'gprog'));
    var steps = el('div', 'gsteps');
    g.steps.forEach(function (step, i) {
      steps.append(stepRow(step, i, false));
    });
    goalView.append(steps);
    var buttons = el('div', 'gacts');
    if (g.status === 'running' || g.status === 'paused') {
      var toggleRun = el('button', 'gprimary', g.status === 'running' ? 'Pause' : 'Resume');
      toggleRun.addEventListener('click', function () {
        toggleRun.disabled = true;
        goalCall(g.status === 'running' ? 'pause' : 'resume');
      });
      var stop = el('button', 'gsecondary danger', 'Stop');
      stop.addEventListener('click', function () {
        stop.disabled = true;
        goalCall('stop');
      });
      buttons.append(toggleRun, stop);
      if (g.status === 'paused' && g.steps.some(function (s) { return s.status === 'failed'; })) {
        goalView.append(el('div', 'ghint', 'A step did not work. Resume to try it again, or stop here.'));
      }
    } else {
      var again = el('button', 'gprimary', 'New goal');
      again.addEventListener('click', function () {
        goalCall('clear');
      });
      buttons.append(again);
    }
    goalView.append(buttons);
  }

  function onGoal(g) {
    var before = goalState;
    goalState = g;
    if (!g || !before || before.id !== g.id) draftSteps = null;
    // Her plan is ready while she is looking elsewhere: show it.
    if (g && g.status === 'review' && (!before || before.status !== 'review') && isOpen && !showingGoal) setGoalOpen(true);
    renderGoal();
  }

  // Where she is on the page, so Claude can be shown a screenshot of it.
  function currentView(focus) {
    return {
      path: window.location.pathname + window.location.search,
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: window.scrollX || 0,
      scrollY: window.scrollY || 0,
      focus: focus,
    };
  }

  function placeBox(node, b) {
    node.style.left = b.left + 'px';
    node.style.top = b.top + 'px';
    node.style.width = Math.max(b.right - b.left, 1) + 'px';
    node.style.height = Math.max(b.bottom - b.top, 1) + 'px';
    node.classList.toggle('low', b.top < 26);
  }

  function dropBox() {
    if (keptBox) keptBox.remove();
    keptBox = null;
    keptAt = null;
  }

  // Keep the drawn box over the same part of the page when it scrolls.
  if (window.addEventListener) window.addEventListener(
    'scroll',
    function () {
      if (!keptBox || !keptAt) return;
      var x = window.scrollX || 0;
      var y = window.scrollY || 0;
      placeBox(keptBox, { left: keptAt.left - x, top: keptAt.top - y, right: keptAt.right - x, bottom: keptAt.bottom - y });
    },
    true,
  );

  function setDrawing(on) {
    if (on && pointing) setPointing(false);
    drawing = on;
    drawBtn.classList.toggle('on', on);
    drawLabel.textContent = on ? 'Drag a box\u2026' : 'Draw';
    if (on && !sheet) {
      sheet = el('div', 'sheet');
      sheet.addEventListener('pointerdown', drawStart);
      root.append(sheet);
    }
    if (!on && sheet) {
      sheet.remove();
      sheet = null;
      if (liveBox) liveBox.remove();
      liveBox = null;
    }
  }

  var drawFrom = null;

  function drawStart(event) {
    if (event.button) return;
    event.preventDefault();
    drawFrom = { x: event.clientX, y: event.clientY, id: event.pointerId };
    if (sheet.setPointerCapture) sheet.setPointerCapture(event.pointerId);
    sheet.addEventListener('pointermove', drawMove);
    sheet.addEventListener('pointerup', drawEnd);
    sheet.addEventListener('pointercancel', drawCancel);
    liveBox = el('div', 'box');
    liveBox.append(el('b', '', '0 \u00d7 0'));
    root.append(liveBox);
    placeBox(liveBox, boxBetween(drawFrom.x, drawFrom.y, drawFrom.x, drawFrom.y));
  }

  function drawMove(event) {
    if (!drawFrom || event.pointerId !== drawFrom.id) return;
    var b = boxBetween(drawFrom.x, drawFrom.y, event.clientX, event.clientY);
    placeBox(liveBox, b);
    liveBox.firstChild.textContent = Math.round(b.right - b.left) + ' \u00d7 ' + Math.round(b.bottom - b.top);
  }

  function drawCancel() {
    drawFrom = null;
    setDrawing(false);
  }

  function drawEnd(event) {
    if (!drawFrom || event.pointerId !== drawFrom.id) return;
    var b = boxBetween(drawFrom.x, drawFrom.y, event.clientX, event.clientY);
    drawFrom = null;
    setDrawing(false);
    if (b.right - b.left < 8 || b.bottom - b.top < 8) return; // a click, not a box
    useBox(b);
  }

  // A heading's box spans the whole page width even when its words are short,
  // so for plain text the words themselves are measured.
  function tightRect(node) {
    var box = node.getBoundingClientRect();
    if (node.children.length || !words(node) || !document.createRange) return box;
    var range = document.createRange();
    range.selectNodeContents(node);
    var text = range.getBoundingClientRect();
    return text.width && text.height ? text : box;
  }

  // "around “Selected work” and 2 images": what she sees on the chip.
  function boxLabel(shown) {
    if (!shown.length) return 'around empty space';
    var named = shown.filter(function (node) {
      return words(node);
    });
    var parts = named.slice(0, 2).map(shortFor);
    var rest = shown.length - parts.length;
    if (rest) {
      var kind = kindOf(shown[shown.length - 1]);
      parts.push(rest + (parts.length ? ' more' : ' ' + kind + (rest > 1 ? 's' : '')));
    }
    return 'around ' + (parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0]);
  }

  // Work out what the box covers and attach it to the next message.
  function useBox(b) {
    var found = [];
    var all = document.body ? document.body.getElementsByTagName('*') : [];
    var rects = [];
    var nodes = [];
    for (var i = 0; i < all.length && i < 4000; i++) {
      var node = all[i];
      if (node === host || /^(SCRIPT|STYLE|LINK|META|NOSCRIPT|BR)$/.test(node.tagName)) continue;
      nodes.push(node);
      rects.push(tightRect(node));
    }
    mostlyInside(rects, b).forEach(function (index) {
      var node = nodes[index];
      // Only the outermost things: a card, not also its heading and its text.
      for (var j = 0; j < found.length; j++) {
        if (found[j].contains(node)) return;
      }
      found.push(node);
    });
    var shown = found.slice(0, 8);
    var text = shown.map(words).join(' ').slice(0, 300);
    var x = window.scrollX || 0;
    var y = window.scrollY || 0;
    var size = Math.round(b.right - b.left) + '\u00d7' + Math.round(b.bottom - b.top);
    pointedLabel = boxLabel(shown);
    setPointed({
      kind: 'area',
      box: size + ' at ' + Math.round(b.left + x) + ',' + Math.round(b.top + y) + ' on a ' + window.innerWidth + '\u00d7' + window.innerHeight + ' screen',
      inside: shown.map(nameFor).join('; ') + (found.length > 8 ? '; and ' + (found.length - 8) + ' more' : ''),
      text: text,
    });
    pointedPath = shown.length ? pathTo(shown[0]) : null;
    pointedFocus = onPage(b);
    dropBox();
    keptBox = el('div', 'box kept');
    keptBox.append(el('b', '', size));
    keptAt = { left: b.left + x, top: b.top + y, right: b.right + x, bottom: b.bottom + y };
    placeBox(keptBox, b);
    root.append(keptBox);
    input.focus();
  }

  function setPointing(on) {
    if (on && drawing) setDrawing(false);
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
    body.view = currentView(pointedFocus);
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
    setDrawing(false);
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
  drawBtn.addEventListener('click', function () {
    setDrawing(!drawing);
  });
  histBtn.addEventListener('click', function () {
    setChangesOpen(!showingChanges);
  });
  goalBtn.addEventListener('click', function () {
    setGoalOpen(!showingGoal);
  });
  strip.addEventListener('click', function () {
    setGoalOpen(true);
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
        pointedFocus = onPage(space.box);
      } else {
        setPointed({
          selector: describe(target),
          text: String(target.innerText || target.textContent || '').trim().slice(0, 120),
          html: String(target.outerHTML || '').slice(0, 500),
        });
        pointedPath = pathTo(target);
        pointedFocus = onPage(target.getBoundingClientRect());
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
      if (drawing && event.key === 'Escape') drawCancel();
    },
    true,
  );

  function onHistory(entries) {
    seen = {};
    entries.forEach(function (entry) {
      if (entry.id) seen[entry.id] = true;
    });
    count = 0;
    allEntries = entries.slice();
    entries.forEach(function (entry) {
      if (entry.undid) undone[entry.undid] = true;
    });
    list.replaceChildren(empty);
    entries.forEach(function (entry) {
      show(renderEntry(entry), false);
    });
    if (showingChanges) renderChanges();
  }
  function onEntry(entry) {
    // A held-back stream can deliver late what asking already showed.
    if (entry.id && seen[entry.id]) return;
    if (entry.id) seen[entry.id] = true;
    allEntries.push(entry);
    show(renderEntry(entry), true);
    if (showingChanges) renderChanges();
    if (entry.role === 'visitor') return;
    if (entry.undid) {
      // The files are back as they were: show the page that way.
      markUndone(entry.undid);
      if (showingChanges) renderChanges();
      window.setTimeout(function () {
        window.location.reload();
      }, 900);
      return;
    }
    liveSteps = [];
    showLive();
    if (!isOpen) toggle.classList.add('unread');
    // Show the change even when the project has no live reload of its own.
    if (entry.role === 'claude' && entry.files && entry.files.length) {
      try {
        window.sessionStorage.setItem('bubble_flash', changedPath || workPath || '');
      } catch (e) {}
      setThought('Done \u2713');
      window.setTimeout(function () {
        window.location.reload();
      }, 1500);
    } else {
      hideCursor();
    }
    workPath = null;
  }
  function onStep(step) {
    liveSteps.push(step);
    showLive();
    if (working) setThought(thoughtFor(step));
  }
  function onSteps(steps) {
    liveSteps = steps;
    showLive();
  }
  function onStatus(text) {
    if (working && /^Checking/.test(text)) setThought(text);
    statusText.textContent = text;
    statusLine.hidden = !text;
    wrap.classList.toggle('working', !!text);
    scrollDown();
    // A running count of seconds, so a long wait still looks alive.
    if (text && !workClock) {
      workSince = Date.now();
      statusTime.textContent = '0s';
      workClock = window.setInterval(function () {
        var seconds = Math.floor((Date.now() - workSince) / 1000);
        statusTime.textContent = seconds < 60 ? seconds + 's' : Math.floor(seconds / 60) + 'm ' + (seconds % 60) + 's';
      }, 1000);
    }
    if (!text && workClock) {
      window.clearInterval(workClock);
      workClock = null;
    }
    if (text && !working) startWork();
    if (!text && working) stopWork();
  }

  // The page hears news over a live stream. Some links hold a stream back
  // (Cloudflare's temporary ones do), so when nothing arrives soon after
  // connecting, the page asks for the news every moment or two instead.
  var seen = {};
  var streaming = false;
  var asking = false;
  var askTimer = null;
  var known = -1; // how many entries asking has shown; -1 before the first answer
  var knownStatus = null;
  var knownSteps = 0;
  var knownGoal = null;
  var STREAM_WAIT = 3000;
  var ASK_EVERY = 1500;

  function later(fn, ms) {
    var timer = window.setTimeout(fn, ms);
    // Under Node (the tests) a waiting timer must not keep the process alive.
    if (timer && typeof timer.unref === 'function') timer.unref();
    return timer;
  }

  function heard(handler) {
    return function (event) {
      streaming = true;
      if (askTimer) window.clearTimeout(askTimer);
      askTimer = null;
      asking = false;
      try {
        window.sessionStorage.removeItem('bubble_ask');
      } catch (e) {}
      handler(JSON.parse(event.data));
    };
  }

  function applyNews(news) {
    if (!news || typeof news.total !== 'number' || !Array.isArray(news.entries)) return;
    if (known < 0 || news.after !== known) {
      // The first answer, or the conversation was started afresh: show it whole.
      if (news.after !== 0) {
        known = 0;
        return;
      }
      onHistory(news.entries);
    } else {
      news.entries.forEach(onEntry);
    }
    known = news.total;
    var steps = Array.isArray(news.steps) ? news.steps : [];
    if (steps.length !== knownSteps) {
      knownSteps = steps.length;
      onSteps(steps.slice());
      if (working && steps.length) setThought(thoughtFor(steps[steps.length - 1]));
    }
    if ('goal' in news) {
      var goalNews = JSON.stringify(news.goal);
      if (goalNews !== knownGoal) {
        knownGoal = goalNews;
        onGoal(news.goal);
      }
    }
    var text = typeof news.status === 'string' ? news.status : '';
    if (text !== knownStatus) {
      knownStatus = text;
      onStatus(text);
    }
  }

  function ask() {
    askTimer = null;
    if (streaming || !asking) return;
    var again = function () {
      if (!streaming && asking) askTimer = later(ask, ASK_EVERY);
    };
    window
      .fetch('/__bubble/poll?after=' + (known < 0 ? 0 : known), { cache: 'no-store' })
      .then(function (res) {
        return res && res.ok && typeof res.json === 'function' ? res.json() : null;
      })
      .then(function (news) {
        if (!streaming && asking) applyNews(news);
      })
      .catch(function () {})
      .then(again);
  }

  function startAsking() {
    if (streaming || asking) return;
    asking = true;
    // Remember it, so the next page on this link does not wait to find out.
    try {
      window.sessionStorage.setItem('bubble_ask', '1');
    } catch (e) {}
    ask();
  }

  var source = new window.EventSource('/__bubble/events');
  source.addEventListener('history', heard(onHistory));
  source.addEventListener('entry', heard(onEntry));
  source.addEventListener('step', heard(onStep));
  source.addEventListener('steps', heard(onSteps));
  source.addEventListener('status', heard(onStatus));
  source.addEventListener('goal', heard(onGoal));
  var askedBefore = false;
  try {
    askedBefore = window.sessionStorage.getItem('bubble_ask') === '1';
  } catch (e) {}
  later(startAsking, askedBefore ? 0 : STREAM_WAIT);

  list.appendChild(empty);
  statusLine.hidden = true;
  setPointed(null);
  setReply(null);
  outline.hidden = true;
  flashBox.hidden = true;
  // Park the pointer by the bubble, so its first glide starts from there.
  var savedCorner = null;
  try {
    savedCorner = window.localStorage.getItem('bubble_corner');
  } catch (e) {}
  if (/^[tb][lr]$/.test(savedCorner || '')) setCorner(savedCorner);
  var home = toggle.getBoundingClientRect();
  jumpCursor(home.left + home.width / 2, home.top + home.height / 2);
  showAfterReload();
  var wasOpen = false;
  try {
    wasOpen = window.sessionStorage.getItem('bubble_open') === '1';
  } catch (e) {}
  setOpen(wasOpen);
  var goalViewWasOpen = false;
  try {
    goalViewWasOpen = window.sessionStorage.getItem('bubble_goalview') === '1';
  } catch (e) {}
  if (goalViewWasOpen) setGoalOpen(true);
})();
