import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { Icon } from '../Common/Icons';
import { descriptionText } from '../Swiper/descriptionText';
import { offerInsights, offerSkills } from '../Swiper/TinderCard';

function DescriptionBlocks({ text }) {
  if (!text) return <p className="om-muted">La description n’a pas pu être extraite. Consulte le site de l’annonce pour découvrir le poste.</p>;
  const blocks = text.split(/\n\s*\n/).filter(Boolean);
  return blocks.map((block, index) => {
    const lines = block.split('\n').filter(Boolean);
    if (lines.every((line) => /^\s*[-•▪✓*]\s+/.test(line))) {
      return <ul className="om-description-list" key={index}>{lines.map((line, i) => <li key={i}>{line.replace(/^\s*[-•▪✓*]\s+/, '')}</li>)}</ul>;
    }
    if (lines.length === 1 && ( /^#{1,6}\s/.test(block) || (block.length < 85 && /[:：]$/.test(block)))) {
      return <h4 key={index}>{block.replace(/^#{1,6}\s+/, '').replace(/[:：]$/, '')}</h4>;
    }
    return <p key={index}>{block}</p>;
  });
}

export function OfferDetailDrawer({ offer, candidature, onClose, onDecide, onTransferCandidature, onRequeue, busy = false }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    function handleKey(event) {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab') return;
      const focusable = [...dialogRef.current.querySelectorAll('a[href],button:not(:disabled),[tabindex="0"]')];
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener('keydown', handleKey);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', handleKey); previousFocus?.focus(); };
  }, [onClose]);
  if (!offer) return null;
  const { strong, checks } = offerInsights(offer);
  const skills = offerSkills(offer);
  const score = Math.max(0, Math.min(100, Math.round(Number(offer.score) || 0)));
  const text = descriptionText(offer.body || offer.body_preview || offer.snippet || '');
  const specs = [['briefcase', 'Contrat', offer.contract_type], ['clock', 'Durée', offer.duration], ['pin', 'Lieu', offer.location || offer.canton], ['globe', 'Langue', offer.language], ['calendar', 'Début', offer.start_date]].filter(([, , value]) => value);
  return createPortal(<div className="om-overlay" onClick={onClose}>
    <motion.section ref={dialogRef} className="om-modal" role="dialog" aria-modal="true" aria-labelledby="om-title" onClick={(event) => event.stopPropagation()} initial={reducedMotion ? false : { opacity: 0, scale: .96, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: .22 }}>
      <header className="om-header">
        <div className="om-heading"><span className="om-eyebrow">UNE NOUVELLE OPPORTUNITÉ</span><h2 id="om-title">{offer.title || 'Offre sans titre'}</h2><p>{offer.company || 'Entreprise non précisée'} <span>· {offer.location || offer.canton || 'Lieu à confirmer'}</span></p><span className={`om-status ${candidature ? 'applied' : ''}`}><Icon name={candidature ? 'check' : 'clock'} size={13} />{candidature ? 'Déjà postulé' : 'À postuler'}</span></div>
        <div className="so-score om-score"><strong>{score}<small>%</small></strong><span>Match profil</span></div>
        <button ref={closeRef} className="om-close" onClick={onClose} aria-label="Fermer la description"><Icon name="x" size={20} /></button>
      </header>
      <div className="om-body">
        {specs.length > 0 && <div className="om-specs">{specs.map(([icon, label, value]) => <div key={label}><Icon name={icon} size={17} /><span>{label}<strong>{value}</strong></span></div>)}</div>}
        <div className="om-columns">
          <section className="om-description"><div className="om-section-heading"><span className="om-section-icon"><Icon name="fileText" size={19} /></span><div><h3>Le poste en détail</h3><p>L’annonce et ce qui t’attend</p></div></div><div className="om-prose"><DescriptionBlocks text={text} /></div></section>
          <aside className="om-sidebar">
            <section className="om-panel om-match"><h3><Icon name="spark" size={17} /> Pourquoi ce match ?</h3>{strong.length ? <ul>{strong.map((point, index) => <li key={index}><Icon name="check" size={14} /><span>{point}</span></li>)}</ul> : <p className="om-muted">Les points de correspondance ne sont pas encore disponibles.</p>}</section>
            {skills.length > 0 && <section className="om-panel om-skills"><h3><Icon name="target" size={17} /> Compétences</h3><div>{skills.map((skill, index) => <span key={index}>{skill}</span>)}</div></section>}
            {checks.length > 0 && <section className="om-panel om-checks"><h3><Icon name="info" size={17} /> À vérifier</h3><ul>{checks.map((point, index) => <li key={index}>{point}</li>)}</ul></section>}
          </aside>
        </div>
      </div>
      <footer className="om-footer"><div className="om-secondary-actions">{offer.url && <a className="om-site" href={offer.url} target="_blank" rel="noopener noreferrer"><Icon name="external" size={15} /> Voir l’annonce originale</a>}{onRequeue && <button disabled={busy} onClick={async () => { await onRequeue({ offer_ids: [offer.id] }); onClose(); }} title="Remettre dans le Swiper"><Icon name="refresh" size={16} /></button>}{onDecide && <button className="om-trash" disabled={busy} onClick={() => onDecide(offer, 'reject')} title="Mettre à la poubelle"><Icon name="trash" size={16} /></button>}</div>{onTransferCandidature && <button className="om-apply" disabled={busy || Boolean(candidature)} onClick={async () => { await onTransferCandidature(offer); onClose(); }}><Icon name={candidature ? 'check' : 'external'} size={16} />{candidature ? 'Déjà postulé' : 'Postuler & suivre'}</button>}</footer>
    </motion.section>
  </div>, document.body);
}
