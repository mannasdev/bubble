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
| `--local` | Just for you: no public link. Opens the page with the bubble in your browser, so you can tell Claude Code things from the page yourself. |

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

## Replying, and seeing what changed

Every answer from Claude has a Reply button. Replying quotes that answer, so
"a bit lighter please" is understood as being about it.

While Claude works, the bubble lists what it is doing ("Looked at
index.html", "Edited index.html"). Afterwards each answer has an "N changes"
button that opens the log, with what each edit replaced and what it put there.
The same steps are saved with the conversation in `.bubble/history.json`.

## Draw

Next to Point there is Draw: drag a box over any part of the page. The box
stays on the page (and scrolls with it) until the message is sent, and Claude
is told where the box is, what sits inside it and the text inside it. Useful
for "this whole area" or a spot that is not one element.

## Undo

Every answer that changed files has an Undo button, and the clock button in
the panel's header opens Changes: every change Claude made, newest first,
with its edits and an Undo. Undo puts back only what that change did, and
leaves later edits alone. If a later change touched the same spot, it says
so and changes nothing; undo the later one first.

Bubble keeps its own snapshots in `.bubble/snapshots` (a hidden git
repository) so your project's git is never touched. Changes made before you
updated bubble cannot be undone this way; use git for those. After an undo,
Claude is told about it with the next message, so it does not assume its
change is still there.

## Moving it

Drag the launcher, or the open panel by its header, to any corner. It stays
there for that site.

## Pointing

Point picks either a thing on the page or the empty space between things.
Hovering a gap highlights the gap itself, so "add a section here" or "less
room here" means that exact spot. Claude is told what sits before and after
the space and how big it is.

## What she can and cannot ask for

She can ask for anything that is a change to the project's files: text,
layout, colours, new sections. Claude remembers the conversation, so "a bit
smaller than that" works. A new conversation starts after 12 quiet hours.

Claude cannot run commands, install packages, browse the web, read `.env`
files, or edit `package.json`, lock files, config files, dotfiles or
`scripts/`. If she asks for something that needs those, it tells her to ask
you. It also cannot use your connectors, hooks or plugins.

## Watching it live

The terminal you started bubble in is a live feed: her message and what she
pointed at, each file Claude looks at or edits (with what was replaced), and
Claude's answer, each with the time. While Claude is working, the last line
is a spinner saying what it is doing and for how long. The bubble shows the
same status with its own running timer.

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
