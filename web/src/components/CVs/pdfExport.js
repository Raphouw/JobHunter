import './vendor/purify.min.js';
import pdfLibrary from './vendor/html2pdf.bundle.min.js?raw';

export async function exportCvPdf({ html, styles, options, pageCount }) {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-downloads');
  frame.title = 'Rendu PDF';
  frame.style.cssText = 'position:fixed;left:-20000px;top:0;width:1000px;height:1400px;border:0';
  // Only the bundled PDF library can execute; imported CV markup has no scripts or executable attributes.
  const clean = window.DOMPurify.sanitize(html, { ADD_TAGS:['svg','polygon','text','circle','path','g','line'], ADD_ATTR:['style'], FORBID_TAGS:['script','iframe','object','embed','form'] });
  const content = document.createElement('template');
  content.innerHTML = clean;
  for (const image of content.content.querySelectorAll('img')) {
    if (!image.getAttribute('src')) image.remove();
  }
  const css = window.DOMPurify.sanitize(`<style>${styles}</style>`, { FORCE_BODY:true, ADD_TAGS:['style'] });
  const nonce = crypto.randomUUID();
  const loaded = new Promise(resolve => frame.addEventListener('load', resolve, { once:true }));
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src 'self' about:; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:">${css}<script nonce="${nonce}">${pdfLibrary}</script></head><body>${content.innerHTML}</body></html>`;
  document.body.appendChild(frame);
  try {
    await loaded;
    const document = frame.contentDocument;
    await document.fonts.ready;
    await Promise.all(Array.from(document.images).map(img => img.decode().catch(() => {})));
    const element = document.querySelector('#cv-page');
    if (!element) throw new Error('Le contenu du CV est vide.');
    const worker = frame.contentWindow.html2pdf().set(options).from(element).toPdf();
    await worker.get('pdf').then(pdf => { while (pdf.getNumberOfPages() > pageCount) pdf.deletePage(pdf.getNumberOfPages()); });
    const blob = await worker.outputPdf('blob');
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement('a');
    anchor.href = url; anchor.download = options.filename || 'Mon CV.pdf';
    window.document.body.appendChild(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  } finally { frame.remove(); }
}
