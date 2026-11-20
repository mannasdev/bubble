import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Kept out of snapshots: bubble's own folder, secrets and dependencies.
// The project's own .gitignore is honoured as well.
const EXCLUDE = ['.bubble/', '.env*', 'node_modules/', '.next/', '.nuxt/', '.svelte-kit/', '.DS_Store'].join('\n') + '\n';

/**
 * Snapshots of the project's files, kept in a hidden git repository in
 * .bubble/snapshots so the project's own git is never touched. A change can
 * be undone by applying the reverse of the difference between the snapshots
 * taken before and after it.
 */
export function createSnapshots(projectDir, { git = 'git' } = {}) {
  const gitDir = path.join(projectDir, '.bubble', 'snapshots');
  const base = ['--git-dir', gitDir, '--work-tree', projectDir, '-c', 'core.autocrlf=false', '-c', 'gc.auto=0'];
  let ready = null;

  const run = (args, input) =>
    new Promise((resolve, reject) => {
      if (input === undefined) {
        execFile(git, [...base, ...args], { cwd: projectDir, maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' }, (err, stdout, stderr) =>
          err ? reject(Object.assign(err, { stderr: String(stderr) })) : resolve(stdout),
        );
        return;
      }
      const child = spawn(git, [...base, ...args], { cwd: projectDir, stdio: ['pipe', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (d) => (stderr += d));
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve() : reject(Object.assign(new Error(stderr), { stderr }))));
      child.stdin.end(input);
    });

  const init = () =>
    (ready ??= (async () => {
      if (!fs.existsSync(path.join(gitDir, 'HEAD'))) {
        fs.mkdirSync(gitDir, { recursive: true });
        await run(['init', '-q']);
      }
      fs.writeFileSync(path.join(gitDir, 'info', 'exclude'), EXCLUDE);
    })().catch((err) => {
      ready = null;
      throw err;
    }));

  return {
    /** Record the files as they are now. Returns an id, or null if git is unavailable. */
    async take() {
      try {
        await init();
        await run(['add', '-A']);
        return String(await run(['write-tree'])).trim();
      } catch {
        return null;
      }
    },

    /** Put back what changed between two snapshots, leaving everything else as it is now. */
    async undo(before, after) {
      try {
        await init();
      } catch {
        return { ok: false, reason: 'unavailable' };
      }
      let patch;
      try {
        patch = await run(['diff', '--binary', after, before]);
      } catch {
        return { ok: false, reason: 'unavailable' };
      }
      if (!patch.length) return { ok: true };
      try {
        await run(['apply', '--whitespace=nowarn', '-'], patch);
        return { ok: true };
      } catch {
        return { ok: false, reason: 'conflict' };
      }
    },
  };
}
