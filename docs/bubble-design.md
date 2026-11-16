# Bubble: design

Working name: `bubble`. 2026-11-17.

## Why

Mannas builds things for a designer friend. Today she texts changes on
WhatsApp, he retypes them into Claude Code, then shares a fresh
try.cloudflare.com link. He adds nothing in the middle. Bubble removes him
from the loop: she asks for a change on the page itself and Claude Code
makes it on his Mac.

## What she sees

She opens one link. The site he built is there, live, with a small chat
bubble in the bottom-right corner. She types "make the hero text bigger",
sees "working…", then "done", and the page updates in front of her. She can
press a "point" button and click an element first, so "this" means
something.

## What he does

In any project where a dev server is already running:

```
bubble 3000
```

It prints the link to send her. That is the whole setup per project. It is
an add-on: nothing is added to the project's own code.

## Goals

- She can request changes with no install, no account, no app.
- Requests go straight to Claude Code with no approval step (his decision).
- Works on any project that serves a site on a local port.
- He can see afterwards what she asked for and what was changed.

## Non-goals (v1)

- WhatsApp, Telegram or any chat app.
- Screenshot or voice-note upload.
- Several people at once, or several projects from one command.
- An undo button. He uses git as he does today.
- Running when his Mac is off or asleep.

## Anti-goals

- Anyone who finds the link being able to drive Claude on his Mac.
- Claude running shell commands because of something typed into the bubble.
- Changing the project's source to install the bubble.

## Approaches considered

1. **Chat bubble on the page (picked).** Feedback and result in one place,
   nothing for her to install, works with any project. Cost: she leaves
   WhatsApp, and his Mac must be on. Mannas picked this.
2. **WhatsApp bot.** No change for her. Rejected: the official API needs a
   Meta business account and a second number; the unofficial route breaks
   WhatsApp's terms and exposes all his chats. She would still switch to a
   browser to see the result.
3. **Telegram/Discord bot.** Dropped: Claude Code's built-in channels
   feature already does this, and he asked to build something instead.

## How it works

One Node program, run from the project folder, with four parts.

**1. Proxy.** Listens on its own local port and forwards everything to the
dev server (`localhost:3000` in the example), including WebSocket upgrades
so hot reload keeps working. For HTML responses it inserts one
`<script src="/__bubble/widget.js">` tag before `</body>`. Its own routes
live under `/__bubble/`.

**2. Widget.** Plain JavaScript, no framework, rendered in a shadow root so
the site's CSS and the bubble's CSS cannot affect each other. Contains the
bubble, the message list, a text box and the "point" button. Point mode
highlights elements on hover; a click captures a CSS selector, the tag's
text, and a trimmed `outerHTML` (max ~500 chars), which are attached to the
next message. Chat history is kept by the server, so a refresh or hot
reload does not lose it.

**3. Runner.** For each message, runs Claude Code headless in the project
folder, using the `claude` CLI already installed and logged in on his Mac
(verified: v2.1.325, supports `-p`, `--output-format stream-json`,
`--resume`, `--permission-mode`, `--allowedTools`, `--disallowedTools`,
`--append-system-prompt`). The first message starts a session; later
messages resume it, so "a bit smaller than that" works. One request runs at
a time; others queue in order. Progress goes to the widget over
server-sent events: a short status while working, then Claude's final
reply. Claude is told, via the appended system prompt, that it is talking
to a designer looking at the live page, to keep replies to one or two plain
sentences, and to ask her when a request is unclear rather than guess.

Isolation: the runner does not inherit his normal Claude Code setup. His
Mac has connectors for mail, drive, calendar and Linear, plus hooks,
skills and plugins; none of them load for bubble requests. The runner
starts `claude` with an explicit tool allowlist of exactly Read, Glob,
Grep, Edit and Write, no MCP servers, no user hooks, skills or plugins,
and no subagents. Shell and web tools are not on the list.

Paths: reads and edits are confined to the project folder with explicit
deny rules for everything outside it. Inside it, Claude may not read
`.env*`, `.bubble/` or `.git/`, and may not edit `package.json`, lock
files, `*.config.*`, dotfiles, `node_modules/` or anything under
`scripts/`. Consequence: she cannot ask for something that needs a new
package or a config change; Claude tells her to ask Mannas.

Accepted risk: source files in a web project run on his Mac (a server
component, an API route). So whoever holds the link can, by asking for an
edit, get code to run on his Mac. Path rules reduce this but cannot remove
it. The real protection is the key in the link and the fact that she is
someone he trusts. The link must be treated like a password.

Session life: the Claude session id and the chat history are stored in
`.bubble/` and survive a restart of `bubble`. A new Claude session starts
after 12 hours without a message, or with `bubble 3000 --fresh`; the chat
history she sees is kept either way.

**4. Tunnel.** Starts `cloudflared` pointing at the proxy and prints the
public link. `bubble 3000 --host fb.example.com` uses a fixed address and
remembers it for that project in `.bubble/`; without it, bubble falls back
to a quick tunnel with a random address, as today, and "one link" only
holds until the next restart. A fixed
address needs a one-time `cloudflared tunnel login` by Mannas and a domain
on his Cloudflare account. (Checked: cloudflared is installed but not
logged in on this Mac. Whether he has a domain on Cloudflare is not
verified.)

**Access.** On first run per project, bubble generates a random key and
stores it in `.bubble/` in the project. The link is
`https://…/?k=<key>`. The first visit with the right key sets a cookie and
redirects to the clean URL; every request without the cookie gets a plain
"ask Mannas for the link" page, including `/__bubble/` routes.

**Log.** Every request, Claude's reply and the list of files it edited
are appended to `.bubble/log.md` with a timestamp. The diff itself is not
stored; he reads it with git. Bubble never commits. `.bubble/` is added to the project's
`.git/info/exclude` when the project is a git repo, so nothing shows up in
his commits and no tracked file is touched.

## Decided by Mannas

- Chat bubble on the page, as an add-on.
- No approval step.

## Calls made by Claude (correct any of these)

- Node, zero or near-zero dependencies, drives the installed `claude` CLI
  rather than the API, so it uses his existing login and plan.
- Shell commands blocked for bubble requests.
- Bubble requests run isolated from his connectors, hooks and plugins.
- Secrets unreadable; config and package files uneditable.
- Session kept across restarts, renewed after 12 idle hours.
- Log lists files touched; no automatic commits.
- Key-in-link access, kept per project.
- Fixed address when available, random address otherwise.
- Log file instead of an undo button.
- One request at a time.

## Left to the builder

- Proxy details: compressed HTML responses, streaming, `Content-Length`
  after injection, pages with a strict Content-Security-Policy.
- Exact wording and look of the widget (small, neutral, light and dark).
- How status text is derived from Claude's stream.
- What happens when the dev server is down, `claude` fails, or she sends a
  message while the page is mid-reload.
- Tests: proxy injection, key check, queue order, with `claude` faked.

## Verified on 2026-11-17

- Headless `claude -p` v2.1.325 ran unattended on his login with
  `--restricted --safe-mode --strict-mcp-config --tools
  Read,Glob,Grep,Edit,Write --permission-mode acceptEdits
  --permission-prompts none` plus deny rules in `--settings`. It had only
  those five tools, edited a page, and was refused `.env`, `package.json`
  and `/etc/hosts`.
- The run only finds his login when environment variables starting
  `CLAUDE` or `ANTHROPIC` are removed first.

## Not verified

- That he has a domain on Cloudflare for the fixed address. He said "I do
  have the link"; taken to mean yes.
- That a named tunnel runs without a config file. Checked in the build.
