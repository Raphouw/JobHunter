import React, { useEffect, useRef, useState } from 'react';
import offer from './offer.json';
import './swiper-lab.css';
import './tactile-deck-v2.css';

const reasons = offer.reasons.split('\n');
const selectedReasons = [reasons[0], reasons[2], reasons[6]];
const checks = [reasons[8], reasons[9]];
const skills = offer.skills_found.split(',').map((skill) => skill.trim()).slice(0, 4);
const actions = [
  ['undo', 'Undo', '↶'],
  ['pass', 'Pass', '×'],
  ['later', 'Later', '⌄'],
  ['keep', 'Keep', '✓'],
];

function ActionSet({ variant, onPreview }) {
  return <div className={`lab-actions lab-actions-${variant}`} aria-label="Aperçu des actions">
    {actions.map(([key, label, glyph]) => <button type="button" key={key} className={`lab-action lab-action-${key}`} onClick={() => onPreview(label)} aria-label={`${label} — aperçu visuel uniquement`}><span aria-hidden="true">{glyph}</span><strong>{label}</strong></button>)}
  </div>;
}

function VariantA({ onPreview }) {
  return <div className="lab-concept lab-concept-a">
    <div className="lab-card lab-card-a">
      <div className="lab-a-top"><div className="lab-a-company-mark" aria-hidden="true">D</div><div className="lab-a-company"><strong>{offer.company}</strong><span>{offer.location}</span></div><div className="lab-a-score"><strong>{Math.round(offer.score)}</strong><span>match</span></div></div>
      <h3>{offer.title}</h3>
      <p className="lab-a-meta">{offer.duration}<span>·</span>{offer.language}</p>
      <div className="lab-a-skills"><span className="lab-label">Compétences clés</span><p>{skills.join(' · ')}</p></div>
      <div className="lab-a-reasons"><span className="lab-label">Pourquoi ça matche</span>{selectedReasons.map((reason, index) => <div key={reason}><span>{`0${index + 1}`}</span><p>{reason}</p></div>)}</div>
      <div className="lab-a-bottom"><div><span className="lab-label">À vérifier</span><p>{checks.join(' · ')}</p></div><button type="button" onClick={() => onPreview('Détails')}>Détails <span aria-hidden="true">↗</span></button></div>
    </div>
    <ActionSet variant="a" onPreview={onPreview} />
  </div>;
}

function VariantB({ onPreview }) {
  return <div className="lab-concept lab-concept-b">
    <div className="lab-b-stack"><div className="lab-b-back back-two" aria-hidden="true" /><div className="lab-b-back back-one" aria-hidden="true" />
      <div className="lab-card lab-card-b"><div className="lab-b-grip" aria-hidden="true"><i /><i /><i /><i /><i /></div><div className="lab-b-score"><strong>{Math.round(offer.score)}</strong><span>MATCH</span></div>
        <div className="lab-b-main"><div className="lab-b-kicker"><strong>{offer.company}</strong><span>{offer.location}</span></div><h3>{offer.title}</h3><div className="lab-b-meta"><span>{offer.duration}</span><span>{offer.language}</span></div>
          <div className="lab-b-skills"><span className="lab-label">SKILLS</span><p>{skills.join(' / ')}</p></div>
          <div className="lab-b-reasons"><span className="lab-label">THE MATCH</span>{selectedReasons.map((reason, index) => <p key={reason}><b>{`0${index + 1}`}</b>{reason}</p>)}</div>
          <div className="lab-b-check"><span className="lab-label">CHECK</span><p>{checks.join(' · ')}</p></div>
          <button className="lab-b-details" type="button" onClick={() => onPreview('Détails')}>Voir les détails <span aria-hidden="true">↗</span></button>
        </div>
      </div>
    </div>
    <ActionSet variant="b" onPreview={onPreview} />
  </div>;
}

function VariantC({ onPreview }) {
  return <div className="lab-concept lab-concept-c"><div className="lab-card lab-card-c">
    <div className="lab-c-header"><div><strong>{offer.company}</strong><span>{offer.location}</span></div><div className="lab-c-score"><strong>{Math.round(offer.score)}</strong><span>match</span></div></div>
    <h3>{offer.title}</h3>
    <div className="lab-c-meta"><span>{offer.duration}</span><span>{offer.language}</span></div>
    <div className="lab-c-skills"><span className="lab-label">Compétences</span><p>{skills.join(' · ')}</p></div>
    <div className="lab-c-reasons"><span className="lab-label">Ce qui correspond</span>{selectedReasons.map((reason) => <p key={reason}><span aria-hidden="true">✓</span>{reason}</p>)}</div>
    <div className="lab-c-check"><span className="lab-label">À vérifier</span><p>{checks.join(' · ')}</p></div>
    <button className="lab-c-details" type="button" onClick={() => onPreview('Détails')}>Détails de l’offre <span aria-hidden="true">→</span></button>
  </div><ActionSet variant="c" onPreview={onPreview} /></div>;
}

function DeckIcon({ name }) {
  const common = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
  if (name === 'undo') return <svg {...common}><path d="M8 7H5v3" /><path d="M5.3 10A8 8 0 1 1 5 15" /><path d="m5 7 3 3" /></svg>;
  if (name === 'pass') return <svg {...common}><path d="M5 5 19 19M19 5 5 19" /></svg>;
  if (name === 'later') return <svg {...common}><path d="M5.5 4.5h13v15l-6.5-4-6.5 4z" /></svg>;
  return <svg {...common}><path d="m4.5 12.5 5 5 10-11" /></svg>;
}

function VariantD({ onPreview }) {
  const [intent, setIntent] = useState('');
  const resetTimer = useRef(null);
  useEffect(() => () => window.clearTimeout(resetTimer.current), []);
  const previewAction = (action) => {
    window.clearTimeout(resetTimer.current);
    setIntent(action);
    onPreview(action === 'pass' ? 'Passer' : action === 'later' ? 'À revoir' : action === 'keep' ? 'Garder' : 'Annuler');
    resetTimer.current = window.setTimeout(() => setIntent(''), 900);
  };
  const jobTitle = offer.title.replace(/^Internship\s*-\s*/i, '');
  return <div className={`lab-concept lab-concept-d lab-intent-${intent || 'none'}`}>
    <div className="lab-d-stack">
      <div className="lab-d-layer lab-d-layer-two" aria-hidden="true" />
      <div className="lab-d-layer lab-d-layer-one" aria-hidden="true" />
      <article className="lab-card lab-card-d" aria-label={`${offer.title}, ${offer.company}`}>
        <div className="lab-d-content">
          <div className="lab-d-top"><div className="lab-d-company"><strong>{offer.company}</strong><span>{offer.location}</span></div><div className="lab-d-score" aria-label={`Correspondance ${Math.round(offer.score)} sur 100`}><strong>{Math.round(offer.score)}</strong><span>match</span></div></div>
          <div className="lab-d-role"><h3>{jobTitle}</h3><p>Internship</p></div>
          <div className="lab-d-meta">{offer.duration}<span aria-hidden="true">·</span>{offer.language}<span aria-hidden="true">·</span>Suisse</div>
          <div className="lab-d-skills"><span className="lab-d-label">Compétences</span><p>{skills.join(' · ')}</p></div>
          <div className="lab-d-reasons"><span className="lab-d-label">Pourquoi ça correspond</span><ol>{selectedReasons.map((reason, index) => <li key={reason}><span>{String(index + 1).padStart(2, '0')}</span><p>{reason}</p></li>)}</ol></div>
          <div className="lab-d-check"><span className="lab-d-label">À vérifier</span><p>{checks.join(' · ')}</p></div>
        </div>
        <button className="lab-d-details" type="button" onClick={() => onPreview('Détails')}><span>Voir les détails</span><span className="lab-d-details-arrow" aria-hidden="true">→</span></button>
      </article>
    </div>
    <div className="lab-d-actions" aria-label="Aperçu des actions">
      <button type="button" className="lab-d-action lab-d-undo" onClick={() => previewAction('undo')} aria-label="Annuler — aperçu visuel uniquement"><DeckIcon name="undo" /><span>Annuler</span></button>
      <button type="button" className="lab-d-action lab-d-pass" onPointerEnter={() => setIntent('pass')} onPointerLeave={() => setIntent('')} onFocus={() => setIntent('pass')} onBlur={() => setIntent('')} onClick={() => previewAction('pass')} aria-label="Passer — aperçu visuel uniquement"><DeckIcon name="pass" /><span>Passer</span></button>
      <button type="button" className="lab-d-action lab-d-later" onPointerEnter={() => setIntent('later')} onPointerLeave={() => setIntent('')} onFocus={() => setIntent('later')} onBlur={() => setIntent('')} onClick={() => previewAction('later')} aria-label="À revoir — aperçu visuel uniquement"><DeckIcon name="later" /><span>À revoir</span></button>
      <button type="button" className="lab-d-action lab-d-keep" onPointerEnter={() => setIntent('keep')} onPointerLeave={() => setIntent('')} onFocus={() => setIntent('keep')} onBlur={() => setIntent('')} onClick={() => previewAction('keep')} aria-label="Garder — aperçu visuel uniquement"><DeckIcon name="keep" /><span>Garder</span></button>
    </div>
  </div>;
}

export function SwiperDesignLab() {
  const [preview, setPreview] = useState('');
  const onPreview = (label) => { setPreview(`${label} · aperçu visuel uniquement`); window.setTimeout(() => setPreview(''), 2200); };
  return <main className="swiper-lab"><header className="lab-header"><span>STAGEHUNTER / DESIGN LAB</span><h1>Quatre façons de ressentir la même offre.</h1><p>Un seul jeu de données réel. Quatre directions visuelles pour la carte et ses actions.</p></header>
    <div className="lab-gallery">
      <section className="lab-variant" id="soft-premium"><div className="lab-variant-title"><span>A</span><div><h2>Soft premium</h2><p>Douceur, équilibre, finition native.</p></div></div><VariantA onPreview={onPreview} /></section>
      <section className="lab-variant" id="tactile-deck"><div className="lab-variant-title"><span>B</span><div><h2>Tactile deck</h2><p>Profondeur, prise en main, présence physique.</p></div></div><VariantB onPreview={onPreview} /></section>
      <section className="lab-variant" id="minimal-mobile"><div className="lab-variant-title"><span>C</span><div><h2>Minimal mobile-first</h2><p>Dense, direct, pensé pour le pouce.</p></div></div><VariantC onPreview={onPreview} /></section>
      <section className="lab-variant lab-variant-d" id="tactile-deck-v2"><div className="lab-variant-title"><span>D</span><div><h2>Tactile Deck V2</h2><p>La direction retenue, reconstruite avec plus de finesse et de présence.</p></div></div><VariantD onPreview={onPreview} /></section>
    </div>
    <div className="lab-preview-note" role="status" aria-live="polite">{preview}</div>
  </main>;
}

export default SwiperDesignLab;
