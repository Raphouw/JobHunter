import React from 'react';
import { motion, useMotionValue, useTransform } from 'framer-motion';

export function offerInsights(offer) {
  const lines = String(offer.reasons || '').split('\n').map((item) => item.replace(/^[\s•✓✦-]+/, '').trim()).filter(Boolean);
  const checkPattern = /inconnu|non confirm|à vérifi|a verifier|incertain|préfér|souhait|manquant|pas précisé|non précisé|unknown|not confirmed|preferred/i;
  return { strong: lines.filter((line) => !checkPattern.test(line)), checks: lines.filter((line) => checkPattern.test(line)) };
}

export function offerSkills(offer) {
  return String(offer.skills_found || '').split(/,|\n/).map((item) => item.trim()).filter(Boolean);
}

export function TinderCard({ offer, isFront = false, x, y, rotate, disabled = false, onDragEnd, onOpenDetails }) {
  const fallbackX = useMotionValue(0);
  const fallbackY = useMotionValue(0);
  const motionX = x || fallbackX;
  const motionY = y || fallbackY;
  const keepOpacity = useTransform(motionX, [24, 125], [0, 1]);
  const passOpacity = useTransform(motionX, [-125, -24], [1, 0]);
  const laterOpacity = useTransform(motionY, [28, 125], [0, 1]);
  if (!offer) return null;

  const score = Math.max(0, Math.min(100, Math.round(Number(offer.score) || 0)));
  const { strong, checks } = offerInsights(offer);
  const skills = offerSkills(offer);
  const context = [offer.duration, offer.language, offer.domain_category].filter(Boolean);
  const caveats = [...checks];
  if (!offer.duration) caveats.push('Durée à confirmer');
  if (!offer.start_date) caveats.push('Date de début inconnue');
  if (offer.availability_status !== 'open') caveats.push('Disponibilité à vérifier');

  return (
    <motion.article
      className={`match-card ${isFront ? 'is-front' : 'is-back'}`}
      style={isFront ? { x: motionX, y: motionY, rotate } : undefined}
      drag={isFront && !disabled}
      dragMomentum={false}
      dragElastic={0.82}
      onDragEnd={onDragEnd}
      whileDrag={{ cursor: 'grabbing' }}
      initial={isFront ? { opacity: 0, y: 18, scale: 0.975 } : false}
      animate={isFront ? { opacity: 1, scale: 1 } : undefined}
      transition={{ duration: 0.28 }}
    >
      <span className="match-card-edge" style={{ '--match-fill': `${score}%` }} aria-hidden="true" />
      <motion.span className="match-swipe-cue cue-keep" style={{ opacity: isFront ? keepOpacity : 0 }}>KEEP →</motion.span>
      <motion.span className="match-swipe-cue cue-pass" style={{ opacity: isFront ? passOpacity : 0 }}>← PASS</motion.span>
      <motion.span className="match-swipe-cue cue-later" style={{ opacity: isFront ? laterOpacity : 0 }}>À REVOIR ↓</motion.span>

      <div className="match-card-content">
        <div className="match-card-topline">
          <div className="match-company">{offer.company || 'Entreprise inconnue'} <span>/</span> {offer.location || offer.canton || 'Lieu à confirmer'}</div>
          <div className="match-score" title={`Score de correspondance : ${score}/100`} aria-label={`Correspondance ${score} sur 100`}>
            <strong>{score}</strong><span>MATCH</span>
          </div>
        </div>

        <h2 className="match-title">{offer.title || 'Offre sans titre'}</h2>
        <div className="match-meta">{context.length ? context.join(' · ') : 'Informations sur le contrat à confirmer'}</div>

        <div className="match-card-bottom">
          {skills.length > 0 && <div className="match-skills"><span className="match-kicker">COMPÉTENCES</span><p>{skills.slice(0, 5).join(' · ')}</p></div>}
          {strong.length > 0 && <section className="match-reasons" aria-label="Pourquoi cette offre correspond">
            <h3 className="match-kicker">POURQUOI ÇA CORRESPOND</h3>
            <ol>{strong.slice(0, 3).map((reason, index) => <li key={index}><span>{String(index + 1).padStart(2, '0')}</span><p>{reason}</p></li>)}</ol>
          </section>}
          {caveats.length > 0 && <div className="match-check"><span className="match-kicker">À VÉRIFIER</span><p>{caveats.slice(0, 3).join(' · ')}</p></div>}
          {isFront && <button className="match-inline-details" type="button" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onOpenDetails?.(offer); }}>Lire le dossier <span aria-hidden="true">↗</span></button>}
        </div>
      </div>
    </motion.article>
  );
}
