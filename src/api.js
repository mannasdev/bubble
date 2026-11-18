import fs from 'node:fs';
import crypto from 'node:crypto';
import { runClaude, RunError } from './runner.js';

const MAX_BODY = 16 * 1024;
const MAX_TEXT = 2000;
const MAX_POINTED_HTML = 500;
const MAX_REPLY_TO = 200;
const MAX_STEPS = 40;
const FAILED_TEXT = "Something went wrong on Mannas's side. Tell him.";

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

/**
 * Everything under /__bubble/: the widget file, the live event stream, and
 * the endpoint that takes a message and queues it for Claude.
 */
export function createApi({ state, projectDir, run = runClaude, widgetPath, owner = false, onActivity = () => {} }) {
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

  const addStep = (step) => {
    if (steps.length >= MAX_STEPS) return;
    steps.push(step);
    emit('step', step);
    onActivity({ type: 'step', step });
  };

  async function runJob(job) {
    steps = [];
    const attempt = (sessionId) =>
      run({
        projectDir,
        text: job.text,
        pointed: job.pointed,
        replyTo: job.replyTo,
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
      add('claude', result.reply, { files: result.files, ...(steps.length ? { steps } : {}) });
      steps = [];
      state.log(job.text, result.reply, result.files);
      onActivity({ type: 'reply', text: result.reply, files: result.files });
    } catch (err) {
      onActivity({ type: 'error', detail: String(err?.message ?? err) });
      steps = [];
      add('error', FAILED_TEXT);
      state.log(job.text, `(failed: ${err?.message ?? err})`, []);
    }
  }

  async function drain() {
    if (working) return;
    working = true;
    while (queue.length) {
      setStatus('Thinking…');
      await runJob(queue.shift());
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
    if (!text || text.length > MAX_TEXT) return json(res, 400, { error: 'bad message' });
    // A conversation that has been quiet too long ends here, before this
    // message is saved and makes it look recent again.
    if (state.session() === null) state.clearSession();
    const replyTo = typeof body.replyTo === 'string' ? body.replyTo.trim().slice(0, MAX_REPLY_TO) : '';
    const entry = add('visitor', text, replyTo ? { replyTo } : {});
    const job = { text, pointed: cleanPointed(body.pointed), replyTo: replyTo || undefined };
    queue.push(job);
    onActivity({ type: 'message', ...job });
    json(res, 202, { id: entry.id });
    drain();
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
    listeners.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      listeners.delete(res);
    });
  }

  return function handleApi(req, res) {
    const route = new URL(req.url, 'http://x').pathname;
    if (req.method === 'GET' && route === '/__bubble/widget.js') {
      const body = fs.readFileSync(widgetPath);
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store' });
      return res.end(body);
    }
    if (req.method === 'GET' && route === '/__bubble/events') return events(req, res);
    if (req.method === 'POST' && route === '/__bubble/send') return send(req, res);
    json(res, 404, { error: 'not found' });
  };
}
