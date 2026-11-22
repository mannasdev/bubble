// Screenshots of the project's own pages, taken with a headless Chrome that
// bubble drives directly through the DevTools protocol (no extra libraries).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

/** A Chrome-like browser to take screenshots with, or null if there is none. */
export function findChrome() {
  if (process.env.BUBBLE_CHROME) return fs.existsSync(process.env.BUBBLE_CHROME) ? process.env.BUBBLE_CHROME : null;
  for (const candidate of CANDIDATES) if (fs.existsSync(candidate)) return candidate;
  // The browsers Playwright downloads, if any.
  const cache = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  try {
    for (const dir of fs.readdirSync(cache).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
      for (const inner of ['chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium']) {
        const file = path.join(cache, dir, inner);
        if (fs.existsSync(file)) return file;
      }
    }
  } catch {}
  return null;
}

const MAX_W = 1600;
const MAX_H = 1400;
const WHOLE_H = 2200;

/**
 * Takes screenshots of http://localhost:<targetPort><path>. Chrome is started
 * the first time a shot is needed and kept until close(). Every failure gives
 * null, never an error: a missing screenshot must not stop a change.
 */
export function createCamera({ targetPort, dir, chromePath = findChrome(), timeoutMs = 15000 }) {
  let browser = null; // { child, socket, send }
  let starting = null;

  async function start() {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bubble-chrome-'));
    const child = spawn(
      chromePath,
      [
        '--headless=new',
        '--remote-debugging-port=0',
        `--user-data-dir=${profile}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--hide-scrollbars',
        '--mute-audio',
        'about:blank',
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    const wsUrl = await new Promise((resolve, reject) => {
      let text = '';
      const timer = setTimeout(() => reject(new Error('Chrome did not start')), timeoutMs);
      child.stderr.on('data', (d) => {
        text += d;
        const m = /DevTools listening on (ws:\/\/\S+)/.exec(text);
        if (m) {
          clearTimeout(timer);
          resolve(m[1]);
        }
      });
      child.on('error', reject);
      child.on('exit', () => reject(new Error('Chrome exited')));
    });
    const socket = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = () => reject(new Error('could not reach Chrome'));
    });
    let id = 0;
    const pending = new Map();
    const listeners = new Set();
    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const listener of listeners) listener(msg);
      }
    };
    const send = (method, params = {}, sessionId) =>
      new Promise((resolve, reject) => {
        const msgId = ++id;
        pending.set(msgId, { resolve, reject });
        socket.send(JSON.stringify({ id: msgId, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    child.on('exit', () => {
      browser = null;
      for (const { reject } of pending.values()) reject(new Error('Chrome exited'));
      pending.clear();
    });
    return { child, socket, send, listeners, profile };
  }

  async function ready() {
    if (browser) return browser;
    starting ??= start().then(
      (b) => (browser = b),
      (err) => {
        starting = null;
        throw err;
      },
    );
    return starting;
  }

  async function shoot({ path: pagePath = '/', width = 1280, height = 800, scrollX = 0, scrollY = 0, clip, whole = false, name = 'shot' }) {
    if (!chromePath) return null;
    let target = null;
    let b;
    try {
      b = await ready();
      const w = Math.min(Math.max(Math.round(width), 320), MAX_W);
      const h = Math.min(Math.max(Math.round(height), 320), 2000);
      ({ targetId: target } = await b.send('Target.createTarget', { url: 'about:blank' }));
      const { sessionId } = await b.send('Target.attachToTarget', { targetId: target, flatten: true });
      const call = (method, params) => b.send(method, params, sessionId);
      await call('Page.enable');
      await call('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
      const loaded = new Promise((resolve) => {
        const timer = setTimeout(resolve, timeoutMs);
        const listener = (msg) => {
          if (msg.sessionId === sessionId && msg.method === 'Page.loadEventFired') {
            clearTimeout(timer);
            b.listeners.delete(listener);
            resolve();
          }
        };
        b.listeners.add(listener);
      });
      const nav = await call('Page.navigate', { url: `http://localhost:${targetPort}${pagePath.startsWith('/') ? pagePath : '/' + pagePath}` });
      if (nav.errorText) return null;
      await loaded;
      await new Promise((r) => setTimeout(r, 400)); // fonts and late layout
      // Scroll to where she was, so fixed headers, lazy images and anything that
      // changes as it scrolls into view look as they did on her screen.
      if (!whole && (scrollX || scrollY)) {
        await call('Runtime.evaluate', { expression: `window.scrollTo(${Math.round(scrollX)}, ${Math.round(scrollY)})` });
        await new Promise((r) => setTimeout(r, 600));
      }
      let area;
      if (whole) {
        // The whole page in one picture, scaled down when it is long.
        const { result } = await call('Runtime.evaluate', {
          expression: 'Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)',
          returnByValue: true,
        });
        const tall = Math.min(Math.max(Number(result?.value) || h, h), 12000);
        area = { x: 0, y: 0, width: w, height: tall, scale: Math.min(1, WHOLE_H / tall) };
      } else area = clip
        ? {
            x: Math.max(0, Math.round(clip.x)),
            y: Math.max(0, Math.round(clip.y)),
            width: Math.min(Math.max(Math.round(clip.width), 1), MAX_W),
            height: Math.min(Math.max(Math.round(clip.height), 1), MAX_H),
            scale: 1,
          }
        : { x: 0, y: 0, width: w, height: h, scale: 1 };
      const { data } = await call('Page.captureScreenshot', { format: 'png', clip: area, captureBeyondViewport: true });
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${Date.now()}-${name}.png`);
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      return file;
    } catch {
      return null;
    } finally {
      if (target && b) b.send('Target.closeTarget', { targetId: target }).catch(() => {});
    }
  }

  function close() {
    if (browser) {
      browser.child.kill();
      fs.rm(browser.profile, { recursive: true, force: true }, () => {});
    }
    browser = null;
  }

  return { dir, shoot, close };
}
