import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { runClaude, RunError, checkPrompt } from './runner.js';

const MAX_BODY = 16 * 1024;
const MAX_TEXT = 2000;
const MAX_POINTED_HTML = 500;
const MAX_REPLY_TO = 200;
const MAX_STEPS = 40;
const FAILED_TEXT = "Something went wrong on Mannas's side. Tell him.";
const MAX_IMAGE = 10 * 1024 * 1024;
const MAX_IMAGES = 4;
const IMAGE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|gif|webp)$/;
const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const IMAGE_ONLY_TEXT = 'Take a look at the attached image.';

/** What kind of image these bytes are, judged by the bytes themselves. */
function imageKind(b) {
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 6 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString('latin1'))) return 'gif';
  if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

/** Read raw bytes, giving up (null) once they pass the limit. */
function readBytes(req, max) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let over = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > max) over = true;
      else chunks.push(c);
    });
    req.on('end', () => resolve(over ? null : Buffer.concat(chunks)));
    req.on('error', () => resolve(null));
  });
}

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
  res.end(body);
}

/** Read a request body, giving up (null) once it passes the size limit. */
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let over = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) over = true;
      else chunks.push(c);
    });
    req.on('end', () => resolve(over ? null : Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(null));
  });
}

function cleanPointed(p) {
  if (!p || typeof p !== 'object') return undefined;
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  if (p.kind === 'area') {
    return { kind: 'area', box: str(p.box, 80), inside: str(p.inside, 600), text: str(p.text, 300) };
  }
  if (p.kind === 'space') {
    return {
      kind: 'space',
      selector: str(p.selector, 300),
      before: str(p.before, 200),
      after: str(p.after, 200),
      gap: str(p.gap, 40),
    };
  }
  return { selector: str(p.selector, 300), text: str(p.text, 120), html: str(p.html, MAX_POINTED_HTML) };
}

const MAX_GOAL = 300;
const MAX_GOAL_STEPS = 12;
const MAX_STEP_TEXT = 160;

/** The numbered lines of Claude's plan, as steps (at most 8). */
export function parsePlan(text) {
  const out = [];
  for (const line of String(text ?? '').split('\n')) {
    const m = /^\s*\d+[.)]\s+(.+?)\s*$/.exec(line);
    if (m) out.push(m[1].replace(/\*\*/g, '').slice(0, MAX_STEP_TEXT));
  }
  return out.slice(0, 8);
}

function planPrompt(goal) {
  return (
    `She wants this for the site: "${goal}". Look at the page and the code, then plan it as 3 to 8 small, concrete steps. ` +
    'Each step should be one change she can see on the page. Do not change any files now. ' +
    'Reply with only the numbered steps, one per line, each under 12 words, in plain words for a designer. ' +
    'If the goal is too unclear to plan, ask one short question instead.'
  );
}

/** Where she is on the page, for screenshots. Anything odd means no screenshot. */
function cleanView(v) {
  if (!v || typeof v !== 'object') return undefined;
  const num = (n, min, max) => (Number.isFinite(n) ? Math.min(Math.max(Math.round(n), min), max) : null);
  const width = num(v.width, 320, 3000);
  const height = num(v.height, 320, 3000);
  if (typeof v.path !== 'string' || !v.path.startsWith('/') || v.path.startsWith('//') || v.path.length > 500) return undefined;
  if (width === null || height === null) return undefined;
  const f = v.focus;
  const focus =
    f && typeof f === 'object' && [f.x, f.y, f.width, f.height].every(Number.isFinite)
      ? { x: num(f.x, 0, 100000), y: num(f.y, 0, 100000), width: num(f.width, 1, 3000), height: num(f.height, 1, 3000) }
      : null;
  return { path: v.path, width, height, scrollX: num(v.scrollX, 0, 100000) ?? 0, scrollY: num(v.scrollY, 0, 100000) ?? 0, focus };
}

/**
 * Everything under /__bubble/: the widget file, the live event stream (and
 * the same news for a page that has to ask), and the endpoint that takes a
 * message and queues it for Claude.
 */
export function createApi({
  state,
  projectDir,
  run = runClaude,
  widgetPath,
  owner = false,
  onActivity = () => {},
  snapshots = null,
  camera = null,
  mediaDir = camera?.dir ?? null,
}) {
  // Images she attaches are kept with the screenshots, outside the project.
  const uploadsDir = mediaDir ? path.join(mediaDir, 'uploads') : null;
  const listeners = new Set();
  const queue = [];
  let working = false;
  let status = '';
  let steps = []; // what Claude has done so far for the request in progress

  const emit = (event, data) => {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of listeners) res.write(frame);
  };
  const setStatus = (text) => {
    status = text;
    emit('status', text);
    onActivity({ type: 'status', text });
  };
  const add = (role, text, extra = {}) => {
    const entry = { id: crypto.randomUUID(), role, text, at: new Date().toISOString(), ...extra };
    state.append(entry);
    emit('entry', entry);
    return entry;
  };

  // The goal she set, worked through step by step on autopilot.
  const goalFile = path.join(projectDir, '.bubble', 'goal.json');
  let goal = (() => {
    try {
      const g = JSON.parse(fs.readFileSync(goalFile, 'utf8'));
      // Nothing runs on its own after a restart: a running goal waits.
      if (g.status === 'running') g.status = 'paused';
      if (g.status === 'planning') Object.assign(g, { status: 'failed', error: 'Planning was interrupted. Try again.' });
      for (const s of g.steps ?? []) if (s.status === 'doing') s.status = 'todo';
      return g;
    } catch {
      return null;
    }
  })();
  const saveGoal = () => {
    if (goal) fs.writeFileSync(goalFile, JSON.stringify(goal, null, 2));
    else fs.rmSync(goalFile, { force: true });
    emit('goal', goal);
  };
  const doneCount = () => goal.steps.filter((s) => s.status === 'done').length;
  const goalNews = (event, extra = {}) =>
    onActivity({ type: 'goal', event, text: goal.text, done: doneCount(), total: goal.steps.length, ...extra });

  const addStep = (step) => {
    if (steps.length >= MAX_STEPS) return;
    steps.push(step);
    emit('step', step);
    onActivity({ type: 'step', step });
  };

  // Changes that can be undone: id -> { before, after, request, files, undone }.
  const changesFile = path.join(projectDir, '.bubble', 'changes.json');
  const changes = (() => {
    try {
      return JSON.parse(fs.readFileSync(changesFile, 'utf8'));
    } catch {
      return {};
    }
  })();
  const saveChanges = () => fs.writeFileSync(changesFile, JSON.stringify(changes, null, 2));

  // Things Claude should hear about before her next message, such as an undo
  // it did not do itself. Kept on disk so a restart does not lose them.
  const notesFile = path.join(projectDir, '.bubble', 'notes.json');
  let notes = (() => {
    try {
      return JSON.parse(fs.readFileSync(notesFile, 'utf8'));
    } catch {
      return [];
    }
  })();
  const saveNotes = () => fs.writeFileSync(notesFile, JSON.stringify(notes));

  // The part of the page a screenshot should show: what she pointed at with
  // some room around it, or else what she could see.
  function shotOf(view, name, whole) {
    // A goal can touch any part of the page, so it is shown the whole page.
    if (whole) return { path: view.path, width: view.width, height: view.height, whole: true, name };
    const pad = name === 'after' ? 120 : 60;
    const f = view.focus;
    const clip = f
      ? { x: Math.max(0, f.x - pad), y: Math.max(0, f.y - pad), width: f.width + pad * 2, height: f.height + pad * 2 }
      : { x: view.scrollX, y: view.scrollY, width: view.width, height: view.height };
    return { path: view.path, width: view.width, height: view.height, scrollX: view.scrollX, scrollY: view.scrollY, clip, name };
  }

  async function runJob(job) {
    steps = [];
    const told = notes;
    const before = snapshots ? await snapshots.take() : null;
    const look = camera && job.view;
    const beforeShot = look ? await camera.shoot(shotOf(job.view, 'before', !!job.goalStep)) : null;
    const attempt = (sessionId) =>
      run({
        projectDir,
        text: job.text,
        pointed: job.pointed,
        replyTo: job.replyTo,
        notes: told.length ? told : undefined,
        screenshot: beforeShot ?? undefined,
        images: job.images?.length ? job.images : undefined,
        shotsDir: look || job.images?.length ? mediaDir : undefined,
        sessionId,
        onStatus: setStatus,
        onStep: addStep,
        owner,
      });
    try {
      let result;
      try {
        result = await attempt(state.session());
      } catch (err) {
        if (!(err instanceof RunError) || err.kind !== 'stale-session') throw err;
        state.clearSession();
        result = await attempt(null);
      }
      if (result.sessionId) state.setSession(result.sessionId);
      // After a change, Claude looks at the page and can fix what it sees.
      if (look && result.files.length) {
        setStatus('Checking how it looks\u2026');
        const afterShot = await camera.shoot(shotOf(job.view, 'after', !!job.goalStep));
        if (afterShot) {
          try {
            const check = await run({
              projectDir,
              text: checkPrompt(afterShot),
              sessionId: result.sessionId,
              shotsDir: camera.dir,
              onStatus: setStatus,
              onStep: addStep,
              owner,
            });
            result = {
              reply: check.reply,
              sessionId: check.sessionId || result.sessionId,
              files: [...new Set([...result.files, ...check.files])],
            };
          } catch {
            // Keep the first answer: the change itself was made.
          }
        }
      }
      if (told.length) {
        notes = notes.slice(told.length);
        saveNotes();
      }
      const after = before ? await snapshots.take() : null;
      let change;
      if (before && after && before !== after) {
        change = crypto.randomUUID();
        changes[change] = { before, after, request: job.text, files: result.files, undone: false };
        saveChanges();
      }
      add('claude', result.reply, { files: result.files, ...(steps.length ? { steps } : {}), ...(change ? { change } : {}) });
      steps = [];
      state.log(job.text, result.reply, result.files);
      onActivity({ type: 'reply', text: result.reply, files: result.files });
      return { ok: true, change };
    } catch (err) {
      onActivity({ type: 'error', detail: String(err?.message ?? err) });
      steps = [];
      add('error', FAILED_TEXT);
      state.log(job.text, `(failed: ${err?.message ?? err})`, []);
      return { ok: false };
    }
  }

  // Claude reads the page and the code and proposes steps; nothing changes yet.
  async function runPlan() {
    const look = camera && goal.view;
    const shot = look ? await camera.shoot(shotOf(goal.view, 'before', true)) : null;
    try {
      const result = await run({
        projectDir,
        text: planPrompt(goal.text),
        readOnly: true,
        sessionId: state.session(),
        screenshot: shot ?? undefined,
        shotsDir: look ? camera.dir : undefined,
        onStatus: (text) => setStatus(text === 'Thinking\u2026' ? 'Planning\u2026' : text),
        onStep: () => {},
        owner,
      });
      if (result.sessionId) state.setSession(result.sessionId);
      const plan = parsePlan(result.reply);
      if (!plan.length) {
        Object.assign(goal, { status: 'failed', error: result.reply.trim().slice(0, 300) });
      } else {
        goal.steps = plan.map((text) => ({ id: crypto.randomUUID(), text, status: 'todo' }));
        goal.status = 'review';
        goalNews('planned');
      }
    } catch (err) {
      Object.assign(goal, { status: 'failed', error: 'Planning did not work. Try again.' });
      onActivity({ type: 'error', detail: String(err?.message ?? err) });
    }
    saveGoal();
  }

  // The next step of a running goal, ready to run, or null. Finishes the goal
  // when every step is done.
  function nextGoalJob() {
    if (goal?.status !== 'running') return null;
    const index = goal.steps.findIndex((s) => s.status === 'todo' || s.status === 'failed');
    if (index === -1) {
      goal.status = 'done';
      add('note', 'Goal done \u2713');
      goalNews('done');
      saveGoal();
      return null;
    }
    const step = goal.steps[index];
    const total = goal.steps.length;
    goalNews('step', { step: step.text, number: index + 1 });
    step.status = 'doing';
    saveGoal();
    add('note', `Step ${index + 1} of ${total} \u00b7 ${step.text}`);
    return {
      goalStep: step.id,
      text: `Working toward the goal "${goal.text}", step ${index + 1} of ${total}: ${step.text}. Make only this step's change.`,
      view: goal.view,
    };
  }

  function finishStep(id, outcome) {
    const step = goal?.steps.find((s) => s.id === id);
    if (!step) return;
    if (outcome.ok) {
      step.status = 'done';
      if (outcome.change) step.change = outcome.change;
    } else {
      step.status = 'failed';
      if (goal.status === 'running') goal.status = 'paused';
    }
    saveGoal();
  }

  async function drain() {
    if (working) return;
    working = true;
    for (;;) {
      // Her own messages first; when there are none, the goal's next step.
      if (!queue.length) {
        const next = nextGoalJob();
        if (!next) break;
        queue.push(next);
      }
      const job = queue.shift();
      setStatus('Thinking…');
      if (job.plan) {
        await runPlan();
        continue;
      }
      const outcome = await runJob(job);
      if (job.goalStep) finishStep(job.goalStep, outcome);
    }
    working = false;
    setStatus('');
  }

  async function send(req, res) {
    const raw = await readBody(req);
    if (raw === null) return json(res, 413, { error: 'too large' });
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return json(res, 400, { error: 'bad request' });
    }
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    const wanted = Array.isArray(body?.images) ? body.images : [];
    const images = wanted.filter((name) => typeof name === 'string' && IMAGE_NAME.test(name) && uploadsDir && fs.existsSync(path.join(uploadsDir, name)));
    if (images.length !== wanted.length || images.length > MAX_IMAGES) return json(res, 400, { error: 'bad images' });
    if ((!text && !images.length) || text.length > MAX_TEXT) return json(res, 400, { error: 'bad message' });
    // A conversation that has been quiet too long ends here, before this
    // message is saved and makes it look recent again.
    if (state.session() === null) state.clearSession();
    const replyTo = typeof body.replyTo === 'string' ? body.replyTo.trim().slice(0, MAX_REPLY_TO) : '';
    const entry = add('visitor', text, { ...(replyTo ? { replyTo } : {}), ...(images.length ? { images } : {}) });
    const job = {
      text: text || IMAGE_ONLY_TEXT,
      pointed: cleanPointed(body.pointed),
      replyTo: replyTo || undefined,
      view: cleanView(body.view),
      images: images.map((name) => path.join(uploadsDir, name)),
    };
    queue.push(job);
    onActivity({
      type: 'message',
      text,
      pointed: job.pointed,
      replyTo: job.replyTo,
      ...(images.length ? { images: images.length } : {}),
    });
    json(res, 202, { id: entry.id });
    drain();
  }

  async function upload(req, res) {
    if (!uploadsDir) return json(res, 404, { error: 'not found' });
    const bytes = await readBytes(req, MAX_IMAGE);
    if (bytes === null) return json(res, 413, { error: 'too large' });
    const kind = imageKind(bytes);
    if (!kind) return json(res, 415, { error: 'not an image' });
    const name = `${crypto.randomUUID()}.${kind}`;
    fs.mkdirSync(uploadsDir, { recursive: true });
    fs.writeFileSync(path.join(uploadsDir, name), bytes);
    json(res, 200, { id: name });
  }

  function media(name, res) {
    const file = uploadsDir && IMAGE_NAME.test(name) ? path.join(uploadsDir, name) : null;
    if (!file || !fs.existsSync(file)) return json(res, 404, { error: 'not found' });
    const body = fs.readFileSync(file);
    res.writeHead(200, {
      'content-type': IMAGE_TYPES[name.split('.').pop()],
      'content-length': body.length,
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, max-age=86400',
    });
    res.end(body);
  }

  async function undo(req, res) {
    const raw = await readBody(req);
    let id;
    try {
      id = JSON.parse(raw ?? '').id;
    } catch {}
    const change = typeof id === 'string' && Object.hasOwn(changes, id) ? changes[id] : null;
    if (!change) return json(res, 404, { error: 'unknown' });
    if (change.undone) return json(res, 409, { error: 'done' });
    if (working) return json(res, 409, { error: 'busy' });
    working = true;
    try {
      const result = await snapshots.undo(change.before, change.after);
      if (!result.ok) return json(res, 409, { error: result.reason });
      change.undone = true;
      saveChanges();
      const touched = change.files?.length ? ` (${change.files.join(', ')})` : '';
      notes = [...notes, `Your change for "${change.request}" was undone. The files it touched${touched} are back to how they were before that change.`];
      saveNotes();
      add('note', `Undid \u201c${change.request}\u201d`, { undid: id });
      state.log(`(undo) ${change.request}`, 'Undid this change.', change.files ?? []);
      onActivity({ type: 'undo', text: change.request, files: change.files ?? [] });
      json(res, 200, { ok: true });
    } finally {
      working = false;
      if (queue.length) drain();
    }
  }

  async function goalRoute(action, req, res) {
    const raw = await readBody(req);
    if (raw === null) return json(res, 413, { error: 'too large' });
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return json(res, 400, { error: 'bad request' });
    }
    const state_ = goal?.status;
    if (action === 'goal') {
      const text = typeof body?.text === 'string' ? body.text.trim() : '';
      if (!text || text.length > MAX_GOAL) return json(res, 400, { error: 'bad goal' });
      if (goal && !['done', 'stopped', 'failed'].includes(state_)) return json(res, 409, { error: 'busy' });
      goal = { id: crypto.randomUUID(), text, status: 'planning', steps: [], view: cleanView(body.view) };
      saveGoal();
      add('note', `Goal: ${text}`);
      queue.push({ plan: true });
      json(res, 202, { id: goal.id });
      return drain();
    }
    if (action === 'start') {
      if (state_ !== 'review') return json(res, 409, { error: 'not ready' });
      const list = Array.isArray(body?.steps) ? body.steps : null;
      const texts = list?.map((t) => (typeof t === 'string' ? t.trim().slice(0, MAX_STEP_TEXT) : '')).filter(Boolean);
      if (!texts?.length || texts.length !== list.length || texts.length > MAX_GOAL_STEPS) return json(res, 400, { error: 'bad steps' });
      goal.steps = texts.map((text) => ({ id: crypto.randomUUID(), text, status: 'todo' }));
      goal.status = 'running';
      saveGoal();
      json(res, 200, { ok: true });
      return drain();
    }
    if (action === 'pause') {
      if (state_ !== 'running') return json(res, 409, { error: 'not running' });
      goal.status = 'paused';
      saveGoal();
      return json(res, 200, { ok: true });
    }
    if (action === 'resume') {
      if (state_ !== 'paused') return json(res, 409, { error: 'not paused' });
      goal.status = 'running';
      saveGoal();
      json(res, 200, { ok: true });
      return drain();
    }
    if (action === 'stop') {
      if (!['running', 'paused', 'review'].includes(state_)) return json(res, 409, { error: 'nothing to stop' });
      goal.status = 'stopped';
      for (const s of goal.steps) if (s.status === 'todo' || s.status === 'failed') s.status = 'skipped';
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i].goalStep) queue.splice(i, 1);
      goalNews('stopped');
      saveGoal();
      add('note', 'Goal stopped');
      return json(res, 200, { ok: true });
    }
    if (action === 'clear') {
      if (goal && ['running', 'planning'].includes(state_)) return json(res, 409, { error: 'busy' });
      if (goal?.steps.some((s) => s.status === 'doing')) return json(res, 409, { error: 'busy' });
      goal = null;
      saveGoal();
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'not found' });
  }

  function events(req, res) {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(`event: history\ndata: ${JSON.stringify(state.history())}\n\n`);
    res.write(`event: status\ndata: ${JSON.stringify(status)}\n\n`);
    if (steps.length) res.write(`event: steps\ndata: ${JSON.stringify(steps)}\n\n`);
    res.write(`event: goal\ndata: ${JSON.stringify(goal)}\n\n`);
    listeners.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      listeners.delete(res);
    });
  }

  /**
   * The same news as the event stream, for a page that asks instead of
   * listening. Some links (Cloudflare's temporary ones) hold a stream back, so
   * the widget falls back to this. `after` is how many entries it already has.
   */
  function poll(req, res) {
    const history = state.history();
    const asked = Number(new URL(req.url, 'http://x').searchParams.get('after'));
    const after = Number.isInteger(asked) && asked >= 0 && asked <= history.length ? asked : 0;
    json(res, 200, { total: history.length, after, entries: history.slice(after), status, steps, goal });
  }

  return function handleApi(req, res) {
    const route = new URL(req.url, 'http://x').pathname;
    if (req.method === 'GET' && route === '/__bubble/widget.js') {
      const body = fs.readFileSync(widgetPath);
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store' });
      return res.end(body);
    }
    if (req.method === 'GET' && route === '/__bubble/events') return events(req, res);
    if (req.method === 'GET' && route === '/__bubble/poll') return poll(req, res);
    if (req.method === 'POST' && route === '/__bubble/send') return send(req, res);
    if (req.method === 'POST' && route === '/__bubble/upload') return upload(req, res);
    if (req.method === 'GET' && route.startsWith('/__bubble/media/')) return media(route.slice('/__bubble/media/'.length), res);
    if (req.method === 'POST' && route === '/__bubble/undo' && snapshots) return undo(req, res);
    const goalAction = /^\/__bubble\/goal(?:\/(start|pause|resume|stop|clear))?$/.exec(route);
    if (req.method === 'POST' && goalAction) return goalRoute(goalAction[1] ?? 'goal', req, res);
    json(res, 404, { error: 'not found' });
  };
}
