import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { animate, AnimatePresence, motion, useMotionValue, useTransform } from 'framer-motion';
import { TinderCard } from './TinderCard';
import { OfferDetailModal } from './OfferDetailModal';
import './matching.css';

const spring = { type: 'spring', stiffness: 450, damping: 30 };

function Underlay({ offer, depth, progress }) {
  const scale = useTransform(progress, [0, 1], depth === 1 ? [0.955, 1] : [0.91, 0.955]);
  const y = useTransform(progress, [0, 1], depth === 1 ? [20, 0] : [39, 20]);
  const rotate = useTransform(progress, [0, 1], depth === 1 ? [-2.4, 0] : [2.8, -2.4]);
  return <motion.div className="match-underlay" style={{ scale, y, rotate, zIndex: 3 - depth }} aria-hidden="true"><TinderCard offer={offer} /></motion.div>;
}

export function TinderDeck({ offers = [], stats = {}, busy = false, onDecide, onUndo, onRequeue, onGoToPage, onTransferCandidature }) {
  const [minScore, setMinScore] = useState(0);
  const [cantonFilter, setCantonFilter] = useState('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedOffer, setSelectedOffer] = useState(null);
  const [flight, setFlight] = useState(false);
  const flightRef = useRef(false);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-300, 300], [-10, 10]);
  const dragDistance = useTransform(x, (value) => Math.min(Math.abs(value) / 200, 1));

  const availableLocations = useMemo(() => Array.from(new Set(offers.map((offer) => (offer.canton || offer.location || '').split(/\|/)[0].trim()).filter((location) => location && location.length <= 40))).sort((a, b) => a.localeCompare(b, 'fr')), [offers]);
  const queue = useMemo(() => offers.filter((offer) => Number(offer.score || 0) >= minScore && (cantonFilter === 'all' || `${offer.canton || ''} ${offer.location || ''}`.toLowerCase().includes(cantonFilter.toLowerCase()))), [offers, minScore, cantonFilter]);
  const [current, next1, next2] = queue;

  const triggerDecision = useCallback(async (decision) => {
    if (!current || busy || flightRef.current || !onDecide) return;
    flightRef.current = true;
    setFlight(true);
    setSelectedOffer(null);
    const target = decision === 'keep' ? window.innerWidth + 400 : decision === 'reject' ? -window.innerWidth - 400 : 250;
    try {
      if (decision === 'unsure') {
        await animate(y, target, { duration: 0.3, ease: [0.3, 0.7, 0.25, 1] });
        await animate(y, 52, { duration: 0.14 });
      } else {
        await animate(x, target, { duration: 0.28, ease: [0.25, 0.8, 0.35, 1] });
      }
      await onDecide(current, decision);
    } finally {
      x.set(0);
      y.set(0);
      flightRef.current = false;
      setFlight(false);
    }
  }, [current, busy, onDecide, x, y]);

  const handleDragEnd = (_, info) => {
    const { x: dx, y: dy } = info.offset;
    const { x: vx, y: vy } = info.velocity;
    if (dy < -90 && Math.abs(dy) > Math.abs(dx)) {
      animate(x, 0, spring); animate(y, 0, spring); setSelectedOffer(current);
    } else if (Math.abs(dx) > 110 || Math.abs(vx) > 500) {
      triggerDecision(dx > 0 || (dx === 0 && vx > 0) ? 'keep' : 'reject');
    } else if ((dy > 95 || vy > 500) && Math.abs(dy) > Math.abs(dx)) {
      triggerDecision('unsure');
    } else {
      animate(x, 0, spring); animate(y, 0, spring);
    }
  };

  useEffect(() => {
    const handleKey = (event) => {
      if (event.target instanceof Element && event.target.closest('input, textarea, select, button, a, [contenteditable="true"]')) return;
      if (selectedOffer) return;
      if (event.key === 'ArrowLeft') { event.preventDefault(); triggerDecision('reject'); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); triggerDecision('keep'); }
      else if (event.key === 'ArrowDown') { event.preventDefault(); triggerDecision('unsure'); }
      else if (event.key === 'ArrowUp' || event.key === ' ') { event.preventDefault(); if (current) setSelectedOffer(current); }
      else if ((event.ctrlKey && event.key.toLowerCase() === 'z') || event.key === 'Backspace') { event.preventDefault(); if (!busy && onUndo) onUndo(); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [triggerDecision, current, selectedOffer, busy, onUndo]);

  return <main className={`match-experience ${selectedOffer ? 'details-open' : ''}`}>
    <div className="match-context">
      <div className="match-context-title"><span>STAGEHUNTER / MATCHING</span><h1>Les opportunités</h1></div>
      <div className="match-context-tools"><span className="match-count" aria-live="polite"><strong>{queue.length}</strong> à parcourir</span><button type="button" className="match-filter-toggle" onClick={() => setFiltersOpen((open) => !open)} aria-expanded={filtersOpen} aria-controls="match-filters">Filtres {minScore > 0 || cantonFilter !== 'all' ? '· actifs' : ''} <span aria-hidden="true">{filtersOpen ? '−' : '+'}</span></button></div>
    </div>
    <div id="match-filters" className={`match-filters ${filtersOpen ? 'is-open' : ''}`}>
      <label>Score minimum<select value={minScore} onChange={(event) => setMinScore(Number(event.target.value))}><option value={0}>Tous les scores</option><option value={30}>30+</option><option value={50}>50+</option><option value={70}>70+</option><option value={80}>80+</option></select></label>
      {availableLocations.length > 0 && <label>Lieu<select value={cantonFilter} onChange={(event) => setCantonFilter(event.target.value)}><option value="all">Tous les lieux</option>{availableLocations.map((location) => <option key={location} value={location}>{location}</option>)}</select></label>}
      {stats.unsure > 0 && onRequeue && <button type="button" onClick={() => onRequeue({ all_unsure: true })} disabled={busy}>Reprendre les offres à revoir ({stats.unsure}) ↗</button>}
    </div>

    <div className="match-deck-area">
      {current ? <div className="match-stack">
        {next2 && <Underlay key={`third-${next2.id || next2.url || next2.title}`} offer={next2} depth={2} progress={dragDistance} />}
        {next1 && <Underlay key={`second-${next1.id || next1.url || next1.title}`} offer={next1} depth={1} progress={dragDistance} />}
        <TinderCard key={`front-${current.id || current.url || current.title}`} offer={current} isFront x={x} y={y} rotate={rotate} disabled={busy || flight || !!selectedOffer} onDragEnd={handleDragEnd} onOpenDetails={setSelectedOffer} />
      </div> : <div className="match-empty"><span>LA FILE EST VIDE</span><h2>{offers.length ? 'Aucune offre avec ces filtres.' : 'Toutes les offres sont parcourues.'}</h2><p>{offers.length ? 'Ajustez le score ou le lieu pour retrouver des opportunités.' : 'Vous pouvez reprendre les offres mises à revoir ou lancer une nouvelle recherche.'}</p><div>{offers.length > 0 && <button onClick={() => { setMinScore(0); setCantonFilter('all'); }}>Effacer les filtres</button>}{stats.unsure > 0 && onRequeue && <button onClick={() => onRequeue({ all_unsure: true })} disabled={busy}>Reprendre à revoir ({stats.unsure})</button>}{onGoToPage && <button onClick={() => onGoToPage('search')}>Nouvelle recherche ↗</button>}</div></div>}
    </div>

    {current && <div className="match-action-area"><div className="match-action-rail">
      <motion.button whileTap={{ scale: 0.94 }} className="match-action secondary" onClick={onUndo} disabled={busy || flight || !onUndo} title="Annuler le dernier choix (Ctrl+Z ou Retour arrière)"><span className="match-action-icon">↶</span><span>UNDO</span></motion.button>
      <motion.button whileTap={{ scale: 0.94 }} className="match-action primary pass" onClick={() => triggerDecision('reject')} disabled={busy || flight} title="Passer (flèche gauche)"><span className="match-action-icon">←</span><span>PASS</span></motion.button>
      <motion.button whileTap={{ scale: 0.94 }} className="match-action primary later" onClick={() => triggerDecision('unsure')} disabled={busy || flight} title="À revoir (flèche bas)"><span className="match-action-icon">↓</span><span>LATER</span></motion.button>
      <motion.button whileTap={{ scale: 0.94 }} className="match-action primary keep" onClick={() => triggerDecision('keep')} disabled={busy || flight} title="Garder (flèche droite)"><span className="match-action-icon">→</span><span>KEEP</span></motion.button>
      <motion.button whileTap={{ scale: 0.94 }} className="match-action secondary" onClick={() => setSelectedOffer(current)} disabled={busy || flight} title="Détails (espace ou flèche haut)"><span className="match-action-icon">↗</span><span>DETAILS</span></motion.button>
    </div><div className="match-key-hint">← Passer &nbsp; · &nbsp; ↓ À revoir &nbsp; · &nbsp; → Garder &nbsp; · &nbsp; ↑ Détails</div></div>}

    <AnimatePresence>{selectedOffer && <OfferDetailModal offer={selectedOffer} busy={busy} onClose={() => setSelectedOffer(null)} onDecide={(_, decision) => triggerDecision(decision)} onTransferCandidature={onTransferCandidature} />}</AnimatePresence>
  </main>;
}
