import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SESSION_MAX_IDLE_MS = 12 * 3600_000;

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

function excludeFromGit(projectDir) {
  const gitDir = path.join(projectDir, '.git');
  if (!fs.existsSync(gitDir) || !fs.statSync(gitDir).isDirectory()) return;
  const file = path.join(gitDir, 'info', 'exclude');
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (current.split('\n').includes('.bubble/')) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const gap = current === '' || current.endsWith('\n') ? '' : '\n';
  fs.writeFileSync(file, current + gap + '.bubble/\n');
}

/** Everything bubble remembers about one project lives in <project>/.bubble/. */
export function openState(projectDir) {
  const dir = path.join(projectDir, '.bubble');
  fs.mkdirSync(dir, { recursive: true });
  excludeFromGit(projectDir);

  const keyFile = path.join(dir, 'key');
  const configFile = path.join(dir, 'config.json');
  const historyFile = path.join(dir, 'history.json');
  const logFile = path.join(dir, 'log.md');

  if (!fs.existsSync(keyFile)) {
    fs.writeFileSync(keyFile, crypto.randomBytes(24).toString('base64url'), { mode: 0o600 });
  }
  const key = fs.readFileSync(keyFile, 'utf8').trim();

  const config = () => readJson(configFile, {});
  const setConfig = (patch) => writeJson(configFile, { ...config(), ...patch });
  const history = () => readJson(historyFile, []);

  return {
    key,
    get host() {
      return config().host ?? null;
    },
    setHost(host) {
      setConfig({ host });
    },
    session() {
      const id = config().sessionId ?? null;
      if (!id) return null;
      const last = history().at(-1);
      if (last && Date.now() - Date.parse(last.at) > SESSION_MAX_IDLE_MS) return null;
      return id;
    },
    setSession(sessionId) {
      setConfig({ sessionId });
    },
    clearSession() {
      setConfig({ sessionId: null });
    },
    history,
    append(entry) {
      writeJson(historyFile, [...history(), entry]);
    },
    log(request, reply, files) {
      const oneLine = (s) => String(s).replace(/\s*\n\s*/g, ' ').trim();
      fs.appendFileSync(
        logFile,
        `## ${new Date().toISOString()}\n` +
          `**Asked:** ${oneLine(request)}\n` +
          `**Reply:** ${oneLine(reply)}\n` +
          `**Files:** ${files.length ? files.join(', ') : 'none'}\n\n`,
      );
    },
  };
}
