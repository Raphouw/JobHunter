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

function primaryReasons(reasons) {
  const chosen = [];
  for (const pattern of [/contrat|internship|stage/i, /métier|intitulé|titre/i, /langue|anglais|français|allemand/i]) {
    const reason = reasons.find((item) => pattern.test(item) && !chosen.includes(item));
    if (reason) chosen.push(reason);
  }
  for (const reason of reasons) {
    if (chosen.length === 3) break;
    if (!chosen.includes(reason)) chosen.push(reason);
  }
  return chosen;
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
  const title = offer.title || 'Offre sans titre';
  const prefix = title.match(/^(Internship|Stage)\s*[-–:]\s*/i);
  const displayTitle = prefix ? title.slice(prefix[0].length) : title;
  const subtitle = prefix ? prefix[1] : null;
  const location = offer.location || offer.canton || 'Lieu à confirmer';
  const country = /(?:,\s*CH\b|Switzerland|Suisse)/i.test(location) ? 'Suisse' : null;
  const context = [offer.duration, offer.language, country].filter(Boolean);
  const caveats = [...checks];
  if (!offer.duration && !caveats.some((item) => /durée/i.test(item))) caveats.push('Durée à confirmer');
  if (!offer.start_date && !caveats.some((item) => /date de début/i.test(item))) caveats.push('Date de début inconnue');
  if (offer.availability_status !== 'open' && !caveats.some((item) => /disponibilité/i.test(item))) caveats.push('Disponibilité à vérifier');

  return <motion.article
    className={`tactile-card ${isFront ? 'is-front' : 'is-back'}`}
    aria-label={`${title}, ${offer.company || 'Entreprise inconnue'}`}
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
    <motion.span className="tactile-cue tactile-cue-keep" style={{ opacity: isFront ? keepOpacity : 0 }}>GARDER →</motion.span>
    <motion.span className="tactile-cue tactile-cue-pass" style={{ opacity: isFront ? passOpacity : 0 }}>← PASSER</motion.span>
    <motion.span className="tactile-cue tactile-cue-later" style={{ opacity: isFront ? laterOpacity : 0 }}>À REVOIR ↓</motion.span>
    <div className="tactile-content">
      <div className="tactile-top"><div className="tactile-company"><strong>{offer.company || 'Entreprise inconnue'}</strong><span>{location}</span></div><div className="tactile-score" title={`Score de correspondance : ${score}/100`} aria-label={`Correspondance ${score} sur 100`}><strong>{score}</strong><span>match</span></div></div>
      <div className="tactile-role"><h2>{displayTitle}</h2>{subtitle && <p>{subtitle}</p>}</div>
      <div className="tactile-meta">{context.length ? context.join(' · ') : 'Informations du contrat à confirmer'}</div>
      <div className="tactile-lower">
        {skills.length > 0 && <div className="tactile-skills"><span className="tactile-label">Compétences</span><p>{skills.slice(0, 4).join(' · ')}</p></div>}
        {strong.length > 0 && <section className="tactile-reasons" aria-label="Pourquoi cette offre correspond"><h3 className="tactile-label">Pourquoi ça correspond</h3><ol>{primaryReasons(strong).map((reason, index) => <li key={reason}><span>{String(index + 1).padStart(2, '0')}</span><p>{reason}</p></li>)}</ol></section>}
        {caveats.length > 0 && <div className="tactile-check"><span className="tactile-label">À vérifier</span><p>{caveats.slice(0, 3).join(' · ')}</p></div>}
      </div>
    </div>
    {isFront && <button className="tactile-details" type="button" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onOpenDetails?.(offer); }}><span>Voir les détails</span><span aria-hidden="true">→</span></button>}
  </motion.article>;
}
