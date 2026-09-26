import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { descriptionText } from './descriptionText';
import { offerInsights, offerSkills } from './TinderCard';

export function OfferDetailModal({ offer, onClose, onDecide, onTransferCandidature, busy }) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const handleKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);
  if (!offer) return null;

  const { strong, checks } = offerInsights(offer);
  const skills = offerSkills(offer);
  const caveats = [...checks];
  if (!offer.duration) caveats.push('Durée non confirmée');
  if (!offer.start_date) caveats.push('Date de début inconnue');
  if (offer.availability_status !== 'open') caveats.push('Disponibilité à vérifier');
  const paragraphs = descriptionText(offer.body_preview || offer.body || offer.snippet || '').split(/\n{2,}|\r\n\r\n/).map((part) => part.trim()).filter(Boolean);
  const score = Math.max(0, Math.min(100, Math.round(Number(offer.score) || 0)));
  const decide = (decision) => { onDecide?.(offer, decision); onClose(); };

  return <>
    <motion.div className="match-dossier-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
    <motion.aside className={`match-dossier ${expanded ? 'is-expanded' : ''}`} role="dialog" aria-modal="true" aria-label={`Détails de ${offer.title || 'l’offre'}`} initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', stiffness: 360, damping: 38 }}>
      <div className="match-sheet-handle" onPointerDown={(event) => event.stopPropagation()} onTouchStart={(event) => { event.currentTarget.dataset.startY = String(event.touches[0].clientY); }} onTouchEnd={(event) => { const delta = event.changedTouches[0].clientY - Number(event.currentTarget.dataset.startY || 0); if (delta > 80) { if (expanded) setExpanded(false); else onClose(); } else if (delta < -60) setExpanded(true); }} onClick={() => setExpanded((value) => !value)} aria-hidden="true"><span /></div>
      <header className="match-dossier-header"><div><span>DOSSIER / {offer.company || 'ENTREPRISE'}</span><h2>{offer.title || 'Offre sans titre'}</h2><p>{offer.location || offer.canton || 'Lieu à confirmer'} <span>·</span> {score} MATCH</p></div><button type="button" onClick={onClose} aria-label="Fermer les détails">×</button></header>
      <div className="match-dossier-scroll">
        <section className="match-dossier-section"><div className="match-dossier-index">01</div><div><h3>Analyse de correspondance</h3><div className="match-analysis-columns"><div><h4>POINTS FORTS</h4>{strong.length ? strong.map((line, index) => <p key={index}>{line}</p>) : <p>Aucune raison détaillée disponible.</p>}</div><div><h4>À VÉRIFIER AVANT DE POSTULER</h4>{caveats.map((line, index) => <p key={index}>{line}</p>)}</div></div></div></section>
        <section className="match-dossier-section"><div className="match-dossier-index">02</div><div><h3>Compétences</h3><p className="match-dossier-skills">{skills.length ? skills.join(' · ') : 'Aucune compétence détaillée détectée.'}</p></div></section>
        <section className="match-dossier-section"><div className="match-dossier-index">03</div><div><h3>Description du poste</h3><div className="match-dossier-prose">{paragraphs.length ? paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>) : <p>Aucun texte extrait disponible pour cette offre.</p>}</div></div></section>
        <section className="match-dossier-section"><div className="match-dossier-index">04</div><div><h3>Informations & source</h3><dl className="match-dossier-facts"><div><dt>Contrat / catégorie</dt><dd>{offer.domain_category || 'À confirmer'}</dd></div><div><dt>Durée</dt><dd>{offer.duration || 'À confirmer'}</dd></div><div><dt>Début</dt><dd>{offer.start_date || 'À confirmer'}</dd></div><div><dt>Langue</dt><dd>{offer.language || 'À confirmer'}</dd></div><div><dt>Disponibilité</dt><dd>{offer.availability_status === 'open' ? 'Ouverte' : 'À vérifier'}</dd></div>{offer.source && <div><dt>Source</dt><dd>{offer.source}</dd></div>}{offer.learned_adjustment ? <div><dt>Ajustement Swiper</dt><dd>{offer.learned_adjustment > 0 ? '+' : ''}{offer.learned_adjustment} points</dd></div> : null}</dl>{offer.url && <a href={offer.url} target="_blank" rel="noopener noreferrer" className="match-source-link">Voir l’offre à la source ↗</a>}</div></section>
      </div>
      <footer className="match-dossier-footer"><div>{onTransferCandidature && <button type="button" onClick={() => { onTransferCandidature(offer); onClose(); }}>Postuler & suivre ↗</button>}</div><div><button type="button" disabled={busy} onClick={() => decide('reject')}>PASS</button><button type="button" disabled={busy} onClick={() => decide('unsure')}>LATER</button><button type="button" disabled={busy} onClick={() => decide('keep')}>KEEP →</button></div></footer>
    </motion.aside>
  </>;
}
