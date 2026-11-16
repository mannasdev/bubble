const TAG = '<script src="/__bubble/widget.js" defer></script>';

/** Add the widget script to a page, just before the last </body>. */
export function inject(html) {
  const matches = [...html.matchAll(/<\/body\s*>/gi)];
  const last = matches.at(-1);
  if (!last) return html + TAG;
  return html.slice(0, last.index) + TAG + html.slice(last.index);
}
