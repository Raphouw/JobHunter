export function descriptionText(value) {
  const source = String(value || '');
  if (!source) return '';

  const withBreaks = source.replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/(?:p|div|li|h[1-6])\s*>/gi, '\n\n');
  const doc = new DOMParser().parseFromString(withBreaks, 'text/html');
  doc.querySelectorAll('script, style').forEach((node) => node.remove());
  return (doc.body.textContent || '').replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n').trim();
}
