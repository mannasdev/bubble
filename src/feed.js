// Turns what happens in the bubble into lines for the terminal bubble runs in.

const CODES = { dim: 2, bold: 1, red: 31, green: 32, cyan: 36 };
const VERBS = { search: 'searched for', read: 'looked at', edit: 'edited', write: 'wrote' };
const INDENT = ' '.repeat(18);

const oneLine = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
const two = (n) => String(n).padStart(2, '0');

function pointedText(pointed) {
  if (pointed.kind === 'space') {
    const between = `${pointed.before || 'the start'} and ${pointed.after || 'the end'}`;
    return `pointing at the space between ${between}${pointed.gap ? ` (${pointed.gap})` : ''}`;
  }
  return `pointing at "${oneLine(pointed.text) || pointed.selector}"`;
}

/**
 * One event from the api as text. `who` is the label for the person typing
 * ("her", or "you" in local mode).
 */
export function formatActivity(event, { now = new Date(), color = false, who = 'her' } = {}) {
  const paint = (text, ...styles) =>
    color && text ? `\x1b[${styles.map((s) => CODES[s]).join(';')}m${text}\x1b[0m` : text;
  const time = paint(`${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`, 'dim');
  const head = (label, style, text) => `${time}  ${paint(label.padEnd(8), ...style)}${text}`;

  if (event.type === 'message') {
    const lines = [head(who, ['cyan', 'bold'], oneLine(event.text))];
    if (event.pointed) lines.push(INDENT + paint(pointedText(event.pointed), 'dim'));
    if (event.replyTo) lines.push(INDENT + paint(`replying to "${oneLine(event.replyTo)}"`, 'dim'));
    return lines.join('\n');
  }
  if (event.type === 'step') {
    const step = event.step;
    const what = step.action === 'search' ? `"${step.query}"` : step.file;
    const lines = [head('', [], paint(`${VERBS[step.action] ?? step.action} ${what}`, 'dim'))];
    if (step.action === 'edit') {
      if (step.before) lines.push(`${INDENT}  ${paint(`- ${step.before}`, 'red')}`);
      if (step.after) lines.push(`${INDENT}  ${paint(`+ ${step.after}`, 'green')}`);
    }
    return lines.join('\n');
  }
  if (event.type === 'reply') return head('claude', ['green', 'bold'], oneLine(event.text));
  if (event.type === 'error') return head('failed', ['red', 'bold'], oneLine(event.detail));
  return '';
}
