import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Icon } from '../components/Common/Icons';

const LISTING_FIELDS = [
  { id: 'card', label: 'Carte d’offre', required: true, hint: 'Clique sur le conteneur complet d’une offre d’emploi.' },
  { id: 'title', label: 'Titre du poste', required: true, hint: 'Clique sur l’intitulé du poste dans la carte.' },
  { id: 'company', label: 'Entreprise', required: false, hint: 'Clique sur le nom de l’entreprise dans la carte.' },
  { id: 'location', label: 'Lieu', required: false, hint: 'Clique sur la ville ou le canton dans la carte.' },
  { id: 'detail_link', label: 'Lien de détail', required: true, hint: 'Clique sur le lien ou titre cliquable menant à l’offre.' },
  { id: 'contract', label: 'Contrat', required: false, hint: 'Clique sur le type de contrat (Stage, CDI, etc.) si visible.' },
  { id: 'date', label: 'Date', required: false, hint: 'Clique sur la date de publication si visible.' },
  { id: 'description', label: 'Description', required: false, hint: 'Clique sur le résumé ou extrait de description.' },
  { id: 'application_link', label: 'Lien postuler', required: false, hint: 'Clique sur le bouton postuler direct si distinct du lien de détail.' },
  { id: 'salary', label: 'Rémunération', hint: 'Clique sur le salaire ou la fourchette de rémunération.' },
  { id: 'work_time', label: 'Temps de travail', hint: 'Clique sur temps plein, temps partiel ou le taux d’activité.' },
  { id: 'experience', label: 'Expérience demandée', hint: 'Clique sur le niveau ou le nombre d’années d’expérience.' },
  { id: 'sector', label: 'Secteur d’activité', hint: 'Clique sur le secteur d’activité de l’offre.' },
  { id: 'education', label: 'Diplôme demandé', hint: 'Clique sur le diplôme ou le niveau de formation requis.' },
  { id: 'next', label: 'Page suivante', required: false, hint: 'Clique sur le bouton ou lien "Page suivante" de la pagination.' },
];

const DETAIL_FIELDS = LISTING_FIELDS.filter((f) => !['card', 'detail_link', 'next'].includes(f.id));

const SEQUENCE = LISTING_FIELDS.filter((item) => item.id !== 'next').map((item) => item.id);

function cleanClass(name) {
  if (!name || typeof name !== 'string') return '';
  if (name.startsWith('jobhunter-') || name.length > 35 || /\d{5,}/.test(name)) return '';
  if (name.includes(':') || name.includes('/') || name.includes('\\') || name.includes('[') || name.includes('%') || name.includes('.')) return '';
  return name.trim();
}

function cleanPart(node) {
  if (!node || !node.tagName) return '';
  const tag = node.tagName.toLowerCase();

  // 1. Prioritize robust testing and item data attributes
  for (const attr of ['data-cy', 'data-testid', 'data-qa', 'data-test', 'data-id-storage-item-id', 'data-item-id', 'data-job-id', 'data-offer-id']) {
    const val = node.getAttribute && node.getAttribute(attr);
    if (val !== null && val !== undefined) {
      if (!/\d{5,}/.test(val) && !val.includes('/') && !val.includes(':')) {
        return `${tag}[${attr}="${val}"]`;
      }
      return `${tag}[${attr}]`;
    }
  }

  // 2. Semantic clean ID
  if (node.id && !/\d{4,}/.test(node.id) && !node.id.includes(':')) {
    return `${tag}#${CSS.escape(node.id)}`;
  }

  // 3. Meaningful CSS classes
  const classes = Array.from(node.classList || [])
    .map(cleanClass)
    .filter(Boolean)
    .slice(0, 2);
  if (classes.length > 0) {
    return tag + classes.map((c) => `.${CSS.escape(c)}`).join('');
  }

  // 4. If bare <li> inside a classed <ul>, generate e.g. ul.grid > li
  if (tag === 'li' && node.parentElement && node.parentElement.tagName.toLowerCase() === 'ul') {
    const parentClasses = Array.from(node.parentElement.classList || []).map(cleanClass).filter(Boolean);
    if (parentClasses.length > 0) {
      return `ul.${CSS.escape(parentClasses[0])} > li`;
    }
  }

  return tag;
}

function selectorFor(node, root) {
  if (!node || !root) return '';
  if (node === root) return 'self';
  const pieces = [];
  let current = node;
  while (current && current !== root && current.tagName && pieces.length < 5) {
    pieces.unshift(cleanPart(current));
    const candidate = pieces.join(' > ');
    try {
      if (root.querySelectorAll(candidate).length === 1) return candidate;
    } catch (_) {}
    current = current.parentElement;
  }
  // Build a complete positional path when semantic selectors are ambiguous.
  const path = [];
  for (let item = node; item && item !== root; item = item.parentElement) {
    const siblings = Array.from(item.parentElement?.children || []).filter((child) => child.tagName === item.tagName);
    path.unshift(`${item.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(item) + 1})`);
  }
  return path.join(' > ');
}

function targetAtPoint(doc, event) {
  // Ignore stretched links and overlapping boxes when the pointer is on text.
  const stack = doc.elementsFromPoint(event.clientX, event.clientY);
  for (const element of stack) {
    for (const child of element.childNodes) {
      if (child.nodeType !== 3 || !child.textContent.trim()) continue;
      const range = doc.createRange();
      range.selectNodeContents(child);
      const hit = Array.from(range.getClientRects()).some((rect) =>
        event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom);
      if (hit) return element;
    }
  }
  return stack[0] || event.target;
}

const frameStyle = `
  * { cursor: crosshair !important; pointer-events: auto !important; }
  *::before, *::after { pointer-events: none !important; }
  .jobhunter-hover {
    outline: 2.5px solid #fb7185 !important;
    background: rgba(251, 113, 133, 0.15) !important;
    transition: outline 0.08s ease !important;
  }
  .jobhunter-card-match {
    outline: 2px dashed #8b5cf6 !important;
    outline-offset: 2px !important;
  }
  .jobhunter-card-active {
    outline: 3px solid #8b5cf6 !important;
    background: rgba(139, 92, 246, 0.06) !important;
    outline-offset: 2px !important;
  }
  .jobhunter-field-highlight {
    outline: 2.5px solid #10b981 !important;
    background: rgba(16, 185, 129, 0.18) !important;
  }
`;

export function VisualSitePicker({
  inspection,
  site,
  onSelector,
  onInspectDetail,
  onInspectListing,
  firstDetailLink,
}) {
  const frame = useRef(null);
  const isDetail = inspection?.kind === 'detail';
  const [field, setField] = useState(isDetail ? 'description' : 'card');
  const [options, setOptions] = useState([]);
  const [version, setVersion] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [samples, setSamples] = useState({});
  const [detectedDetailUrl, setDetectedDetailUrl] = useState('');

  const fieldsList = isDetail ? DETAIL_FIELDS : LISTING_FIELDS;
  const currentStep = fieldsList.find((f) => f.id === field) || fieldsList[0];

  useEffect(() => {
    setField(isDetail ? 'title' : 'card');
    setOptions([]);
    setFeedback('');
  }, [inspection?.url, isDetail]);

  // Synchronize highlights in the iframe when site.selectors change
  const applyHighlights = (doc) => {
    if (!doc?.body) return;
    // Clear previous highlights
    doc.querySelectorAll('.jobhunter-card-match, .jobhunter-card-active, .jobhunter-field-highlight')
      .forEach((el) => el.classList.remove('jobhunter-card-match', 'jobhunter-card-active', 'jobhunter-field-highlight'));

    const cardSel = site?.selectors?.card;
    if (cardSel) {
      try {
        const cards = doc.querySelectorAll(cardSel);
        cards.forEach((card, idx) => {
          card.classList.add(idx === 0 ? 'jobhunter-card-active' : 'jobhunter-card-match');
        });
        const firstCard = cards[0];
        if (firstCard) {
          // Highlight configured fields inside first card
          const configuredKeys = DETAIL_FIELDS.map((item) => item.id);
          configuredKeys.forEach((key) => {
            const selector = site?.selectors?.[key];
            if (selector) {
              try {
                const el = firstCard.querySelector(selector);
                if (el) el.classList.add('jobhunter-field-highlight');
              } catch (_) {}
            }
          });
        }
      } catch (_) {}
    }
  };

  useEffect(() => {
    const doc = frame.current?.contentDocument;
    if (doc?.body) {
      applyHighlights(doc);
    }
  }, [site?.selectors, version]);

  useEffect(() => {
    const doc = frame.current?.contentDocument;
    if (!doc?.body || !inspection) return undefined;

    let highlighted = null;

    const hover = (event) => {
      if (highlighted) {
        highlighted.classList.remove('jobhunter-hover');
      }
      highlighted = targetAtPoint(doc, event);
      if (highlighted && highlighted !== doc.body) {
        highlighted.classList.add('jobhunter-hover');
      }
    };

    const click = (event) => {
      event.preventDefault();
      event.stopPropagation();
      let target = targetAtPoint(doc, event);
      if (!target || target === doc.body) return;

      if (field === 'card') {
        const choices = [];
        let bestCandidate = null;

        for (let node = target; node && node !== doc.body && choices.length < 6; node = node.parentElement) {
          const sel = cleanPart(node);
          if (!sel || sel === 'div' || sel === 'li' || sel === 'ul' || sel === 'body') continue;
          try {
            const count = doc.querySelectorAll(sel).length;
            if (count >= 1 && count <= 200) {
              const item = { selector: sel, count, label: node.tagName.toLowerCase() };
              choices.push(item);
              // Prioritize data-cy, data-testid, compound selectors, or repeating elements
              if (!bestCandidate && (sel.includes('[data-') || sel.includes(' > ') || (count >= 2 && count <= 100))) {
                bestCandidate = item;
              }
            }
          } catch (_) {}
        }

        const chosen = bestCandidate || choices[0];
        if (chosen) {
          onSelector('selectors', 'card', chosen.selector);
          setFeedback(`Carte sélectionnée : "${chosen.selector}" (${chosen.count} cartes trouvées sur la page).`);
          applyHighlights(doc);
          // Advance to Title
          setField('title');
        }
        setOptions(choices);
        return;
      }

      // Handling inner fields (title, company, location, detail_link, etc.)
      const cardSelector = site?.selectors?.card;
      let cardRoot = null;
      if (cardSelector) {
        try {
          cardRoot = target.closest(cardSelector) || doc.querySelector(cardSelector);
        } catch (_) {}
      }

      // Check if clicking outside card on listing page (Cockpit / Side Pane mode!)
      const isOutsideCard = !isDetail && cardRoot && !cardRoot.contains(target) && field !== 'next';

      if (isOutsideCard && field === 'description') {
        // Cockpit / Master-Detail side panel clicked!
        const paneSelector = selectorFor(target, doc.body);
        if (paneSelector) {
          onSelector('detail_selectors', 'description', paneSelector);
          const sample = (target.innerText || target.textContent || '').trim().slice(0, 60);
          setSamples((prev) => ({ ...prev, description: sample + '…' }));
          setFeedback(`✓ Description (Volet latéral cockpit) : "${sample || paneSelector}" enregistrée !`);
          setOptions([]);
          setField('application_link');
          return;
        }
      }

      // If card was not yet configured, automatically detect parent card container!
      if (!cardRoot && field !== 'next' && !isDetail) {
        for (let node = target.parentElement; node && node !== doc.body; node = node.parentElement) {
          const sel = cleanPart(node);
          if (!sel) continue;
          try {
            const count = doc.querySelectorAll(sel).length;
            if (count >= 2) {
              onSelector('selectors', 'card', sel);
              cardRoot = node;
              break;
            }
          } catch (_) {}
        }
      }

      const root = isDetail || field === 'next' || isOutsideCard ? doc.body : (cardRoot || doc.body);

      if (field === 'detail_link' || field === 'application_link' || field === 'next') {
        target = target.closest('a[href]') || target;
      }

      let relSelector = '';
      if (field === 'detail_link') {
        if (target === cardRoot || target.contains(cardRoot) || (cardRoot && cardRoot.tagName.toLowerCase() === 'a')) {
          relSelector = 'self';
        } else {
          relSelector = selectorFor(target, root);
        }
      } else {
        relSelector = selectorFor(target, root);
      }

      if (!relSelector) return;

      const targetSection = isDetail ? 'detail_selectors' : field === 'next' ? 'pagination' : 'selectors';
      const targetKey = field === 'next' ? 'next_selector' : field;

      onSelector(targetSection, targetKey, relSelector);

      // Extract sample text for instant live feedback
      let sampleVal = '';
      if (field.includes('link') || field === 'next') {
        sampleVal = target.getAttribute('href') || target.href || '';
        if (field === 'detail_link' && sampleVal) {
          try {
            const absoluteUrl = new URL(sampleVal, inspection.url).toString();
            setDetectedDetailUrl(absoluteUrl);
          } catch (_) {}
        }
      } else {
        sampleVal = target.innerText?.trim() || target.textContent?.trim() || '';
      }
      if (sampleVal.length > 55) sampleVal = sampleVal.slice(0, 55) + '…';

      setSamples((prev) => ({ ...prev, [field]: sampleVal }));
      setFeedback(`✓ ${currentStep?.label} : "${sampleVal || relSelector}" enregistré.`);
      setOptions([]);

      // Auto-advance to the next field in sequence
      const nextIdx = SEQUENCE.indexOf(field);
      if (nextIdx >= 0 && nextIdx < SEQUENCE.length - 1) {
        const nextId = SEQUENCE[nextIdx + 1];
        setField(nextId);
      }
    };

    doc.addEventListener('mouseover', hover, true);
    doc.addEventListener('click', click, true);

    return () => {
      doc.removeEventListener('mouseover', hover, true);
      doc.removeEventListener('click', click, true);
      if (highlighted) highlighted.classList.remove('jobhunter-hover');
    };
  }, [field, inspection, isDetail, onSelector, site?.selectors?.card, version, currentStep]);

  if (!inspection) return null;

  const targetDetailUrl = detectedDetailUrl || firstDetailLink;

  return (
    <div className="sh-site-picker">
      {/* Top Header & Links */}
      <div className="sh-site-picker-header">
        <div>
          <span className="sh-eyebrow">SÉLECTEUR VISUEL INTERACTIF</span>
          <h4>{isDetail ? 'Aperçu d’une fiche de détail (Annonce complète)' : 'Aperçu de la page de listings (Offres d’emploi)'}</h4>
        </div>
        <div className="sh-site-picker-actions">
          {isDetail && onInspectListing && (
            <button type="button" className="sh-btn-secondary sm" onClick={onInspectListing}>
              <Icon name="arrow-left" size={13} />
              <span>← Revenir aux listings</span>
            </button>
          )}
          {!isDetail && targetDetailUrl && onInspectDetail && (
            <button
              type="button"
              className="sh-btn-secondary sm"
              onClick={() => onInspectDetail(targetDetailUrl)}
            >
              <Icon name="external" size={13} />
              <span>Inspecter la fiche de détail</span>
            </button>
          )}
          <a href={inspection.url} target="_blank" rel="noreferrer" className="sh-btn-secondary sm">
            <Icon name="external" size={13} />
            <span>Voir le site original</span>
          </a>
        </div>
      </div>

      {/* Stepper Navigation Pills */}
      <div className="sh-picker-stepper-bar">
        {fieldsList.map((item, idx) => {
          const isSelected = field === item.id;
          const selectorVal = isDetail
            ? site?.detail_selectors?.[item.id]
            : item.id === 'next'
            ? site?.pagination?.next_selector
            : site?.selectors?.[item.id];
          const hasVal = Boolean(selectorVal);
          const sample = samples[item.id];

          return (
            <button
              type="button"
              key={item.id}
              className={`sh-picker-pill ${isSelected ? 'active' : ''} ${hasVal ? 'configured' : ''}`}
              onClick={() => {
                setField(item.id);
                setOptions([]);
              }}
            >
              <span className="sh-picker-pill-num">{hasVal ? '✓' : idx + 1}</span>
              <span className="sh-picker-pill-name">{item.label}</span>
              {hasVal && sample && <span className="sh-picker-pill-sample">"{sample}"</span>}
            </button>
          );
        })}
      </div>

      {/* Action / Guidance banner */}
      <div className="sh-picker-instruction">
        <Icon name="info" size={16} />
        <div>
          <strong>{currentStep?.label} :</strong> {currentStep?.hint}
        </div>
      </div>

      {/* Dedicated Cockpit / Description Helper banner */}
      {field === 'description' && (
        <div className="sh-description-helper-box">
          <div className="sh-description-helper-text">
            <strong>Où se trouve la description complète sur ce site ?</strong>
            <ul>
              <li><strong>Dans la carte :</strong> clique sur l’extrait ou le texte dans la carte.</li>
              <li><strong>Dans un volet latéral (Cockpit) :</strong> clique directement sur le texte dans le panneau de droite.</li>
              <li><strong>Sur la page dédiée :</strong> ouvre la fiche de détail avec le bouton ci-contre.</li>
            </ul>
          </div>
          <div className="sh-description-helper-actions">
            {targetDetailUrl && onInspectDetail && (
              <button
                type="button"
                className="sh-btn-primary sm"
                onClick={() => onInspectDetail(targetDetailUrl)}
              >
                <Icon name="external" size={13} />
                <span>Ouvrir la fiche de détail réelle</span>
              </button>
            )}
            <button
              type="button"
              className="sh-btn-secondary sm"
              onClick={() => {
                onSelector('selectors', 'description', '');
                setFeedback('Description laissée vide : Job Hunter extraira le corps de l’annonce automatiquement lors du scan.');
                setField('application_link');
              }}
            >
              <span>Passer (extraction auto)</span>
            </button>
          </div>
        </div>
      )}

      {/* Status / Feedback message */}
      {feedback && (
        <div className="sh-picker-feedback-bar">
          <Icon name="check" size={15} />
          <span>{feedback}</span>
        </div>
      )}

      {/* Multiple Candidate Selector Chips (if card clicked) */}
      {options.length > 0 && field === 'card' && (
        <div className="sh-site-picker-options">
          <span className="sh-options-label">Conteneurs détectés :</span>
          {options.map((item, index) => (
            <button
              type="button"
              key={`${item.selector}-${index}`}
              className="sh-btn-secondary sm"
              onClick={() => {
                onSelector('selectors', 'card', item.selector);
                setFeedback(`Carte définie sur : ${item.selector} (${item.count} trouvées)`);
                setField('title');
                setOptions([]);
              }}
            >
              <strong>{item.selector}</strong>
              <small>({item.count} cartes)</small>
            </button>
          ))}
        </div>
      )}

      {/* Iframe displaying the authentic page */}
      <div className="sh-picker-frame-wrapper">
        <iframe
          ref={frame}
          title="Aperçu sélectionnable du site"
          sandbox="allow-same-origin"
          referrerPolicy="no-referrer"
          srcDoc={`<!doctype html><html><head><meta charset="utf-8"><base href="${inspection.url.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></head><body>${inspection.html}<style>${frameStyle}</style></body></html>`}
          onLoad={() => setVersion((v) => v + 1)}
        />
      </div>
    </div>
  );
}
