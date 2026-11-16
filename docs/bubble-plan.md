# Bubble Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A command, `bubble <port>`, that puts a chat bubble on any locally served site and sends what a visitor types straight to a restricted Claude Code run in that project.

**Architecture:** One Node process run from the project folder. It proxies the dev server, injects a widget script into HTML, serves a small API under `/__bubble/`, runs the installed `claude` CLI headless per message, and exposes itself through `cloudflared`.

**Tech Stack:** Node >= 20 (ESM), no runtime dependencies (`node:http`, `node:net`, `node:crypto`, `node:child_process`), tests with `node --test`. Browser widget is plain JavaScript.

**Spec:** `bubble-design.md` (same folder as this plan).

## Global Constraints

- No runtime npm dependencies. No build step.
- Never modify a tracked file in the target project. All bubble state lives in `<project>/.bubble/`.
- Bubble never runs `git commit`, and never runs shell commands on behalf of a message.
- Every HTTP request and WebSocket upgrade without a valid cookie is refused, including `/__bubble/*`. Only exception: a request carrying the right `?k=`.
- The proxy listens on `127.0.0.1` only.
- `claude` is always started with exactly the flags in Task 3 and a scrubbed environment. These were proven on this Mac (v2.1.325) on 2026-11-17: tools limited to Read/Glob/Grep/Edit/Write, `.env` unreadable, `package.json` uneditable, `/etc/hosts` unreadable, page edit succeeded, no prompt.
- Text typed by the visitor and text from Claude is rendered with `textContent`, never `innerHTML`.
- User-facing wording is plain and short; no stack traces in the widget.

## Review Focus

1. Dev server is down or restarting: visitor gets a plain "the preview isn't running" page (502), bubble process stays up.
2. `claude` fails (not logged in, non-zero exit, timeout): visitor sees "Something went wrong on Mannas's side. Tell him." and the next queued message still runs.
3. Two messages sent quickly: they run one at a time in order; the second resumes the session the first created.
4. Stored session id no longer exists: runner retries once with a fresh session instead of failing.
5. Message containing HTML or `</script>`: shown literally in the widget and passed literally to Claude.

Each has a test in the task that owns it (1 in Task 2, 2 to 4 in Tasks 3 and 4, 5 in Task 5).

---

## File Structure

```
bubble/
  package.json          name "bubble", type "module", bin { "bubble": "bin/bubble.js" }
  bin/bubble.js         parse args, wire parts, print link
  src/state.js          .bubble/ folder: key, host, session, history, log, git exclude
  src/access.js         key and cookie check
  src/inject.js         put the script tag into HTML
  src/proxy.js          HTTP + WebSocket proxy with access gate
  src/runner.js         one headless claude run; stream parsing
  src/api.js            /__bubble/ routes, queue, SSE
  src/tunnel.js         cloudflared quick and fixed tunnels
  widget/widget.js      the bubble (browser)
  test/*.test.js        one file per src module
  test/fake-claude.js   stand-in for the claude binary
  README.md
```

---

### Task 1: State and access

**Files:** Create `package.json`, `src/state.js`, `src/access.js`, `test/state.test.js`, `test/access.test.js`

**Interfaces (produces):**
- `openState(projectDir: string): State`. Creates `.bubble/` if missing; if `.git/` exists, appends `.bubble/` to `.git/info/exclude` once.
- `State.key: string`: `crypto.randomBytes(24).toString('base64url')`, created once, stored in `.bubble/key`.
- `State.host: string | null`, `State.setHost(h)`: stored in `.bubble/config.json`.
- `State.session(): string | null`: returns stored session id, or `null` if the last message is older than 12 hours. `State.setSession(id)`, `State.clearSession()`.
- `State.history(): Entry[]`, `State.append(entry: Entry)`: `.bubble/history.json`. `Entry = { id: string, role: 'visitor' | 'claude' | 'error', text: string, at: string (ISO), files?: string[] }`.
- `State.log(request: string, reply: string, files: string[])`: appends to `.bubble/log.md` as `## <ISO time>`, then `**Asked:**`, `**Reply:**`, `**Files:**` lines.
- `checkAccess(req, key): { ok: boolean, setCookie?: string, redirect?: string }`. Cookie name `bubble_k`. With correct `?k=`: `ok: true`, `setCookie: "bubble_k=<key>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000"`, `redirect` = same URL without `k`. Compare with `crypto.timingSafeEqual`.
- `DENIED_HTML: string`: page saying "This preview is private. Ask Mannas for the link."

- [ ] Step 1: Write failing tests: key is stable across two `openState` calls; `.git/info/exclude` gets `.bubble/` exactly once after two calls and is untouched when there is no `.git`; `session()` returns `null` when last history entry is 13 hours old and the id when 1 hour old; `append` then `history()` round-trips; `log` writes the three labelled lines. Access: no cookie → `ok:false`; wrong key → `ok:false`; right `?k=` on `/pricing?k=K&x=1` → redirect `/pricing?x=1` with the cookie above; right cookie → `ok:true` with no redirect; key of different length does not throw.
- [ ] Step 2: Run `node --test`. Expected: FAIL, modules missing.
- [ ] Step 3: Implement `src/state.js` and `src/access.js` to the interfaces above.
- [ ] Step 4: Run `node --test`. Expected: PASS.
- [ ] Step 5: `git init` (first task only), commit `feat: state folder and access check`.

### Task 2: Injection and proxy

**Files:** Create `src/inject.js`, `src/proxy.js`, `test/inject.test.js`, `test/proxy.test.js`

**Interfaces:**
- Consumes: `checkAccess`, `DENIED_HTML`.
- Produces: `inject(html: string): string`. Inserts `<script src="/__bubble/widget.js" defer></script>` before the last `</body>` (case-insensitive); appends it if there is none.
- Produces: `createProxy({ targetPort: number, key: string, handleApi: (req, res) => void }): http.Server`.

Decisions:
- Access gate runs first on every request and on every `upgrade` event (refused upgrades get `403` and the socket destroyed).
- Paths starting `/__bubble/` go to `handleApi`; everything else is forwarded to `127.0.0.1:targetPort`.
- Forwarded requests have `accept-encoding` set to `identity`. A response is buffered and injected only when `content-type` starts with `text/html` **and** has no `content-encoding`; then `content-length` is recomputed and `content-security-policy` and `content-security-policy-report-only` headers are removed. All other responses are piped through untouched.
- WebSocket upgrades are forwarded with `node:net` by replaying the request head and piping both ways.
- Upstream connection error → `502` with a plain page: "The preview isn't running right now."

- [ ] Step 1: Write failing tests. Inject: tag lands before the last of two `</BODY>`; appended when absent. Proxy (with a throwaway upstream `http.Server`): HTML gets the tag and a correct `content-length`; JSON passes byte-identical; a gzip-encoded HTML response passes byte-identical with no tag; CSP header is gone on HTML and kept on JSON; no cookie → 403 `DENIED_HTML` on `/` and on `/__bubble/events`; `?k=` → 302 with cookie; `/__bubble/x` reaches `handleApi`; upstream stopped → 502 and the proxy still answers the next request; a WebSocket echo upstream works through the proxy with the cookie and is refused without it.
- [ ] Step 2: Run `node --test test/inject.test.js test/proxy.test.js`. Expected: FAIL.
- [ ] Step 3: Implement both files.
- [ ] Step 4: Run the tests. Expected: PASS.
- [ ] Step 5: Commit `feat: proxy with widget injection and access gate`.

### Task 3: Runner

**Files:** Create `src/runner.js`, `test/fake-claude.js`, `test/runner.test.js`

**Interfaces (produces):**
- `runClaude({ projectDir, text, pointed?, sessionId?, onStatus, claudeBin = 'claude', timeoutMs = 300000 }): Promise<{ reply: string, sessionId: string, files: string[] }>`. Rejects with `RunError` (`.kind`: `'failed' | 'timeout' | 'stale-session'`).
- `buildPrompt(text, pointed?): string`. Without `pointed`: the text unchanged. With `pointed = { selector, text, html }`: the text, a blank line, then `She pointed at this element on the page:`, `selector: …`, `text: …`, `html: …`.

Exact invocation (argument array, no shell):

```
claude -p <prompt>
  --restricted --safe-mode --strict-mcp-config
  --tools Read,Glob,Grep,Edit,Write
  --permission-mode acceptEdits --permission-prompts none
  --settings <SETTINGS_JSON>
  --append-system-prompt <SYSTEM_PROMPT>
  --output-format stream-json --verbose
  [--resume <sessionId>]
```

`SETTINGS_JSON`:
```json
{"permissions":{"deny":["Read(./.env*)","Read(./.bubble/**)","Read(./.git/**)","Edit(./package.json)","Edit(./*lock*)","Edit(./*.config.*)","Edit(./.*)","Edit(./node_modules/**)","Edit(./scripts/**)"]}}
```

`SYSTEM_PROMPT`: "You are making changes to a website for a designer who is looking at the live page and typing into a small chat box on it. She is not a programmer. Make the change she asks for by editing files in this project. Reply in one or two plain sentences with no code and no file names. If her request is unclear, ask one short question instead of guessing. You cannot run commands, install packages or change configuration; if a request needs that, tell her to ask Mannas."

Other decisions: `cwd` = `projectDir`; `stdio: ['ignore','pipe','pipe']`; the child's environment is the parent's minus every variable whose name starts with `CLAUDE` or `ANTHROPIC` (proven necessary: with them set, the CLI reports "Not logged in"). Parse stdout line by line as JSON. For each `assistant` message `tool_use` block call `onStatus`: `Read|Glob|Grep` → `"Looking at the code…"`, `Edit|Write` → `"Making the change…"`, and collect `input.file_path` relative to `projectDir` into `files` (deduplicated). The `result` line supplies `reply` (`result`) and `sessionId` (`session_id`); `is_error: true` or a non-zero exit → `RunError('failed')`. When `--resume` was passed and the run fails before any `assistant` line → `RunError('stale-session')`. On timeout, kill the child → `RunError('timeout')`.

`test/fake-claude.js` is an executable Node script that prints canned stream-json chosen by env var `FAKE_MODE` (`ok`, `error`, `hang`, `stale`) and writes its argv and env to the file in `FAKE_RECORD`.

- [ ] Step 1: Write failing tests: argv recorded by the fake equals the list above in order, with and without `--resume`; recorded env has no key starting `CLAUDE` or `ANTHROPIC` when the parent has `CLAUDECODE=1` and `ANTHROPIC_BASE_URL=x`; `ok` mode returns reply, session id and `files: ['index.html']` and fires both status strings; `error` → `RunError` kind `failed`; `hang` with `timeoutMs: 200` → kind `timeout` and the child is gone; `stale` with a `sessionId` → kind `stale-session`; `buildPrompt` with text `</script><b>x</b>` returns it unchanged.
- [ ] Step 2: Run `node --test test/runner.test.js`. Expected: FAIL.
- [ ] Step 3: Implement `src/runner.js`.
- [ ] Step 4: Run the tests. Expected: PASS.
- [ ] Step 5: Real check, once, in a temp folder holding `index.html`, `.env`, `package.json`: call `runClaude` with the real binary asking it to change the heading, read `.env`, and edit `package.json`. Expected: heading changed, `.env` contents absent from the reply, `package.json` unchanged.
- [ ] Step 6: Commit `feat: restricted headless claude runner`.

### Task 4: API, queue and live updates

**Files:** Create `src/api.js`, `test/api.test.js`

**Interfaces:**
- Consumes: `State`, `runClaude`, `RunError`.
- Produces: `createApi({ state, projectDir, run = runClaude, widgetPath }): (req, res) => void`.

Routes:
- `GET /__bubble/widget.js` → the widget file, `content-type: text/javascript`, `cache-control: no-store`.
- `GET /__bubble/events` → server-sent events. On connect sends `event: history` with the full `Entry[]`, and `event: status` with the current status text or `""`. Then `event: entry` for each new entry and `event: status` on each change. Comment ping every 25 s.
- `POST /__bubble/send` → JSON `{ text: string, pointed?: { selector, text, html } }`. `text` trimmed, 1 to 2000 chars, else `400`. `pointed.html` cut to 500 chars. Body over 16 KB → `413`. Appends a `visitor` entry, queues the job, answers `202 { id }`.

Queue: one job at a time, first in first out. Per job: status `"Thinking…"`; call `run` with `state.session()`; on success `setSession`, append a `claude` entry with `files`, call `state.log`; on `stale-session` call `clearSession()` and retry once without a session; on any other `RunError` append an `error` entry with text "Something went wrong on Mannas's side. Tell him." and continue with the next job. Status returns to `""` when the queue is empty.

- [ ] Step 1: Write failing tests with a fake `run`: send → 202, history has the visitor entry then the claude entry with files, log file has the request; two sends where the fake resolves slowly run strictly in order and the second receives the session id the first returned; fake rejecting `stale-session` once is called a second time with `sessionId` undefined and succeeds; fake rejecting `failed` yields the error entry and the following job still runs; empty text and 2001 chars → 400; 20 KB body → 413; an events client receives `history` first, then `entry` events in order and a final empty status.
- [ ] Step 2: Run `node --test test/api.test.js`. Expected: FAIL.
- [ ] Step 3: Implement `src/api.js`.
- [ ] Step 4: Run the tests. Expected: PASS.
- [ ] Step 5: Commit `feat: message queue and live updates`.

### Task 5: Widget

**Files:** Create `widget/widget.js`, `test/widget.test.js`

Decisions:
- One self-running script. Does nothing if `window.__bubble` is already set or if it is running inside an iframe.
- Renders into a shadow root on a `<div>` appended to `document.documentElement`, `position: fixed; right: 16px; bottom: 16px; z-index: 2147483647`. Follows `prefers-color-scheme`. System font. Closed state: a 48px round button. Open state: panel 320px wide, max 60vh, with message list, textarea (Enter sends, Shift+Enter newline) and a "Point" button.
- Open or closed is remembered in `sessionStorage` under `bubble_open`.
- Connects to `/__bubble/events` with `EventSource`; renders `history`, appends `entry`, shows `status` as a muted last line. All text set with `textContent`.
- Point mode: outline the hovered element; the next click is captured (`preventDefault`, `stopPropagation`, capture phase), ignored if inside the bubble, and stored as `{ selector, text, html }`: `selector` is the tag plus `#id` or up to two classes, prefixed by up to three ancestors; `text` is `innerText` cut to 120 chars; `html` is `outerHTML` cut to 500. A chip "Pointing at: <selector> ×" appears above the textarea. Escape cancels.
- When a `claude` entry arrives with a non-empty `files` list, reload the page after 1500 ms. (Covers projects with no hot reload; harmless with it.)
- Pure helpers are exported on `window.__bubble` for tests: `describe(el)` and `renderEntry(entry)`.

- [ ] Step 1: Write failing tests that load the script into a minimal fake DOM built in the test file (no dependency): `describe` on `<main><section class="hero big x"><h1 id="t">` returns `main > section.hero.big > h1#t`; `renderEntry({ role: 'visitor', text: '<b>x</b></script>' })` yields a node whose `textContent` is that exact string and which has no child elements; second load of the script creates no second root.
- [ ] Step 2: Run `node --test test/widget.test.js`. Expected: FAIL.
- [ ] Step 3: Implement `widget/widget.js`.
- [ ] Step 4: Run the tests. Expected: PASS.
- [ ] Step 5: Commit `feat: chat bubble widget`.

### Task 6: Tunnel, command and end-to-end check

**Files:** Create `src/tunnel.js`, `bin/bubble.js`, `README.md`, `test/tunnel.test.js`, `test/cli.test.js`

**Interfaces:**
- `parseArgs(argv): { port: number, host?: string, fresh: boolean, noTunnel: boolean }`. Usage: `bubble <port> [--host name] [--fresh] [--no-tunnel]`. Missing or non-numeric port → usage text, exit code 1.
- `startTunnel({ localPort, host?, bin = 'cloudflared' }): Promise<{ url: string, stop(): void }>`.

Decisions:
- Quick tunnel (no host): run `cloudflared tunnel --url http://127.0.0.1:<localPort>`, resolve with the first `https://<something>.trycloudflare.com` seen on stderr; reject after 30 s.
- Fixed address (host given or remembered in state): requires `~/.cloudflared/cert.pem`. If missing, print "Run `cloudflared tunnel login` once, then start bubble again. Using a temporary link for now." and use a quick tunnel. Otherwise: if `cloudflared tunnel list --output json` has no tunnel named `bubble`, run `cloudflared tunnel create bubble`; run `cloudflared tunnel route dns --overwrite-dns bubble <host>`; run `cloudflared tunnel run --url http://127.0.0.1:<localPort> bubble`; resolve with `https://<host>` once stderr reports a registered connection.
- `bin/bubble.js`: check `claude` and (unless `--no-tunnel`) `cloudflared` exist, with a plain message if not; `openState(process.cwd())`; `--fresh` → `clearSession()`; `--host` → `setHost`; start the proxy on a free port; start the tunnel; print exactly one block: the link with `?k=<key>`, and "Send this to her. Treat it like a password. Ctrl+C to stop." On Ctrl+C stop the tunnel and the server.
- README: what it is, install (`npm link` in the bubble folder), the one command, the fixed-address setup, what she can and cannot ask for, where the log is, the accepted risk from the spec in two sentences.

- [ ] Step 1: Write failing tests: `parseArgs` cases above; quick tunnel with a fake `cloudflared` script that prints a trycloudflare URL on stderr resolves with it; fake that prints nothing rejects (use a short timeout option); fixed mode with no cert file falls back to quick and reports the login message; fixed mode with a cert runs `create` only when `list` lacks `bubble`, then `route dns`, then `run`, in that order (recorded by the fake).
- [ ] Step 2: Run `node --test`. Expected: the new tests FAIL, earlier ones PASS.
- [ ] Step 3: Implement `src/tunnel.js`, `bin/bubble.js`, `README.md`.
- [ ] Step 4: Run `node --test`. Expected: all PASS.
- [ ] Step 5: End-to-end with the real pieces. In a throwaway folder with an `index.html`, serve it on a port, run `bubble <port> --no-tunnel`, open the printed local link in a browser. Expected: page shows with the bubble; without `?k=` in a private window the private page shows; typing "make the heading say hello there" changes the file and the page; `.bubble/log.md` has the entry; asking it to "show me the .env file" does not reveal contents.
- [ ] Step 6: Fixed address with the real Cloudflare account. This needs Mannas to run `cloudflared tunnel login` in his browser and to name the hostname. Expected: the same link works after stopping and starting bubble. **Not yet verified:** that `cloudflared tunnel run --url … <name>` works without a config file on v2026.7.2; if it does not, write `.bubble/cloudflared.yml` with `tunnel`, `credentials-file` and one `ingress` rule plus the `http_status:404` catch-all, and run with `--config`.
- [ ] Step 7: Commit `feat: bubble command and tunnels`.
