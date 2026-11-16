# bubble

Puts a small chat bubble on any site you are running locally. Whoever has the
link can type a change into it, and Claude Code makes that change in your
project. No approval step in between.

## Install (once)

```bash
cd bubble
npm link
```

Needs Node 20 or newer, Claude Code (`claude`, logged in) and `cloudflared`.

## Use

Start your site as usual, then in the same project folder:

```bash
bubble 3000
```

`3000` is the port your site runs on. Bubble prints a link. Send it to her.
Stop with Ctrl+C.

| Option | What it does |
| --- | --- |
| `--host preview.example.com` | Use a fixed address on your Cloudflare domain. Remembered per project. |
| `--fresh` | Start a new conversation with Claude. |
| `--no-tunnel` | Local link only, for trying it yourself. Use Chrome or Firefox; Safari will not keep the access cookie on a plain `http://localhost` address. |

### A link that never changes

Without `--host` the link is a temporary trycloudflare address that changes
each time bubble starts. For a fixed one:

1. Run `cloudflared tunnel login` once and pick your domain in the browser.
2. Run `bubble 3000 --host preview.yourdomain.com`.

Bubble creates a tunnel named `bubble` and points that name at it.

## What she sees while Claude works

A small pointer labelled "Claude" glides to the thing she pointed at (or the
middle of the page), a status line says what is happening, and whatever
changes on the page is briefly outlined. When Claude is done the page
refreshes and the pointer lands on what changed. The pointer is a visual
effect: Claude edits files, it does not click on the page.

## What she can and cannot ask for

She can ask for anything that is a change to the project's files: text,
layout, colours, new sections. Claude remembers the conversation, so "a bit
smaller than that" works. A new conversation starts after 12 quiet hours.

Claude cannot run commands, install packages, browse the web, read `.env`
files, or edit `package.json`, lock files, config files, dotfiles or
`scripts/`. If she asks for something that needs those, it tells her to ask
you. It also cannot use your connectors, hooks or plugins.

## What you can see afterwards

- `.bubble/log.md` in the project: each request, Claude's reply and the files
  it changed.
- `git diff`: the changes themselves. Bubble never commits.

`.bubble/` is kept out of git through `.git/info/exclude`.

## The risk you are accepting

The link is the only lock. Anyone who has it can make Claude edit your
project's source, and source files in a web project run on your Mac, so treat
the link like a password and stop bubble when you are done. To cancel a link
that got out, delete `.bubble/key` and start bubble again.

## Tests

```bash
npm test
```
