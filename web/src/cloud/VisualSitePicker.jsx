import React, { useEffect, useRef, useState } from 'react';

const listingFields = [
  ['card', 'Carte complète'], ['detail_link', 'Lien de détail'], ['title', 'Titre'],
  ['company', 'Entreprise'], ['location', 'Lieu'], ['contract', 'Contrat'],
  ['date', 'Date'], ['description', 'Description'],
  ['application_link', 'Lien de candidature'], ['next', 'Page suivante'],
];
const detailFields = listingFields.filter(([key]) => !['card', 'detail_link', 'next'].includes(key));

function part(node) {
  const classes = Array.from(node.classList || [])
    .filter((name) => name.length < 40 && !/\d{5,}/.test(name)).slice(0, 2);
  return node.tagName.toLowerCase() + classes.map((name) => `.${CSS.escape(name)}`).join('');
}

function selectorFor(node, root) {
  const pieces = [];
  let current = node;
  while (current && current !== root && current.tagName && pieces.length < 5) {
    pieces.unshift(part(current));
    const candidate = pieces.join(' > ');
    try { if (root.querySelectorAll(candidate).length === 1) return candidate; }
    catch { /* Keep a readable selector for manual adjustment. */ }
    current = current.parentElement;
  }
  const first = part(node);
  const siblings = Array.from(node.parentElement?.children || []).filter((item) => item.tagName === node.tagName);
  return siblings.length > 1 ? `${first}:nth-of-type(${siblings.indexOf(node) + 1})` : first;
}

const frameStyle = `<style>
  body{font:14px/1.5 system-ui,sans-serif;color:#18212b;background:#fff;margin:20px}
  a{color:#0866ba}article,li,[class*="job"],[class*="offer"]{margin:5px 0;padding:5px}
  *{cursor:crosshair!important}img{max-width:120px} .jobhunter-hover{outline:2px solid #e57819!important;background:#fff3df!important}
</style>`;

export function VisualSitePicker({ inspection, site, onSelector }) {
  const frame = useRef(null);
  const [field, setField] = useState('card');
  const [options, setOptions] = useState([]);
  const [version, setVersion] = useState(0);
  const isDetail = inspection?.kind === 'detail';
  useEffect(() => { setField(isDetail ? 'title' : 'card'); setOptions([]); }, [inspection?.url, isDetail]);
  useEffect(() => {
    const doc = frame.current?.contentDocument;
    if (!doc?.body || !inspection) return undefined;
    let highlighted;
    const hover = (event) => {
      highlighted?.classList.remove('jobhunter-hover');
      highlighted = event.target;
      highlighted?.classList.add('jobhunter-hover');
    };
    const click = (event) => {
      event.preventDefault(); event.stopPropagation();
      let target = event.target;
      if (field === 'card') {
        const choices = [];
        for (let node = target; node && node !== doc.body && choices.length < 7; node = node.parentElement) {
          const selector = part(node);
          const count = doc.querySelectorAll(selector).length;
          if (count <= 100 && (node.classList.length || count > 1))
            choices.push({ selector, count, label: node.tagName.toLowerCase() });
        }
        setOptions(choices);
        return;
      }
      const root = isDetail || field === 'next' ? doc.body
        : doc.querySelector(site.selectors.card);
      if (!root || !root.contains(target)) {
        setOptions([{ error: 'Clique dans la première carte d’offre sélectionnée.' }]);
        return;
      }
      if (field === 'detail_link' || field === 'application_link' || field === 'next')
        target = target.closest('a[href]') || target;
      onSelector(isDetail ? 'detail_selectors' : field === 'next' ? 'pagination' : 'selectors',
                 field === 'next' ? 'next_selector' : field, selectorFor(target, root));
      setOptions([]);
    };
    doc.addEventListener('mouseover', hover, true);
    doc.addEventListener('click', click, true);
    return () => { doc.removeEventListener('mouseover', hover, true);
      doc.removeEventListener('click', click, true); highlighted?.classList.remove('jobhunter-hover'); };
  }, [field, inspection, isDetail, onSelector, site.selectors.card, version]);

  if (!inspection) return null;
  return <div className="sh-site-picker">
    <div className="sh-site-picker-toolbar">
      <strong>{isDetail ? 'Fiche de détail' : 'Page de listings'}</strong>
      <a href={inspection.url} target="_blank" rel="noreferrer">Voir le site original</a>
      <label>Élément à sélectionner <select value={field} onChange={(event) => { setField(event.target.value); setOptions([]); }}>
        {(isDetail ? detailFields : listingFields).map(([key, label]) =>
          <option key={key} value={key}>{label}</option>)}</select></label>
    </div>
    <p>Clique l’élément dans la page ci-dessous. Pour une carte complète, choisis ensuite le conteneur proposé. Les sélecteurs restent modifiables dans les champs avancés.</p>
    {options.length > 0 && <div className="sh-site-picker-options">
      {options.map((item, index) => item.error ? <span key={index}>{item.error}</span>
        : <button type="button" key={`${item.selector}-${index}`} onClick={() => {
          onSelector('selectors', 'card', item.selector); setOptions([]);
        }}>{item.selector} · {item.count} élément(s)</button>)}
    </div>}
    <iframe ref={frame} title="Aperçu sélectionnable du site"
      sandbox="allow-same-origin" referrerPolicy="no-referrer"
      srcDoc={`<!doctype html><html><head><meta charset="utf-8">${frameStyle}</head><body>${inspection.html}</body></html>`}
      onLoad={() => setVersion((value) => value + 1)} />
  </div>;
}
