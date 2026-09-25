import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { animate, AnimatePresence, motion, useMotionValue, useTransform } from 'framer-motion';
import { Icon } from '../Common/Icons';
import { TinderCard } from './TinderCard';
import { OfferDetailModal } from './OfferDetailModal';

const spring = { type: 'spring', stiffness: 450, damping: 30 };

function Underlay({ offer, depth, progress }) {
  const scale = useTransform(progress, [0, 1], depth === 1 ? [0.95, 1] : [0.90, 0.95]);
  const y = useTransform(progress, [0, 1], depth === 1 ? [16, 0] : [32, 16]);
  const opacity = useTransform(progress, [0, 1], depth === 1 ? [0.85, 1] : [0.6, 0.85]);
  return <motion.div layout className="card-underlay-wrapper" style={{ scale, y, opacity, zIndex: 3 - depth }} aria-hidden="true"><TinderCard offer={offer} /></motion.div>;
}

export function TinderDeck({
  offers = [],
  stats = {},
  busy = false,
  onDecide,
  onUndo,
  onRequeue,
  onGoToPage,
  onTransferCandidature,
}) {
  const [minScore, setMinScore] = useState(0);
  const [cantonFilter, setCantonFilter] = useState('all');
  const [selectedOffer, setSelectedOffer] = useState(null);

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-300, 300], [-18, 18]);
  const dragDistance = useTransform(x, (value) => Math.min(Math.abs(value) / 200, 1));
  const flightRef = useRef(false);
  const [flight, setFlight] = useState(false);

  // Extract available regions/cantons/locations for quick filtering
  const availableLocations = useMemo(() => {
    const set = new Set();
    offers.forEach((o) => {
      const loc = o.canton || o.location;
      if (loc) {
        // Take clean region, canton or city name
        const clean = loc.split(/\|/)[0].trim();
        if (clean && clean.length <= 40) set.add(clean);
      }
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'fr'));
  }, [offers]);

  // Filtered deck queue
  const queue = useMemo(() => {
    return offers.filter((o) => {
      const score = Number(o.score || 0);
      if (score < minScore) return false;
      if (cantonFilter !== 'all') {
        const loc = `${o.canton || ''} ${o.location || ''}`.toLowerCase();
        if (!loc.includes(cantonFilter.toLowerCase())) return false;
      }
      return true;
    });
  }, [offers, minScore, cantonFilter]);

  const current = queue[0];
  const next1 = queue[1];
  const next2 = queue[2];

  const triggerDecision = useCallback(
    async (decision) => {
      if (!current || busy || flightRef.current || !onDecide) return;
      flightRef.current = true;
      setFlight(true);
      const target = decision === 'keep' ? window.innerWidth + 400 : decision === 'reject' ? -window.innerWidth - 400 : window.innerHeight + 400;
      try {
        await animate(decision === 'unsure' ? y : x, target, { duration: 0.32, ease: [0.25, 0.8, 0.35, 1] });
        await onDecide(current, decision);
      } finally {
        x.set(0);
        y.set(0);
        flightRef.current = false;
        setFlight(false);
      }
    },
    [current, busy, onDecide, x, y]
  );

  const handleDragEnd = (_, info) => {
    const { x: dx, y: dy } = info.offset;
    const { x: vx, y: vy } = info.velocity;
    if (dy < -90 && Math.abs(dy) > Math.abs(dx)) {
      animate(x, 0, spring);
      animate(y, 0, spring);
      setSelectedOffer(current);
    } else if (Math.abs(dx) > 110 || Math.abs(vx) > 500) {
      triggerDecision(dx > 0 || (dx === 0 && vx > 0) ? 'keep' : 'reject');
    } else if ((dy > 95 || vy > 500) && Math.abs(dy) > Math.abs(dx)) {
      triggerDecision('unsure');
    } else {
      animate(x, 0, spring);
      animate(y, 0, spring);
    }
  };

  // Keyboard controls
  useEffect(() => {
    const handleKey = (e) => {
      if (e.target instanceof Element && e.target.closest('input, textarea, select, button, a, [contenteditable="true"]')) return;
      if (selectedOffer) return; // Modal has focus

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        triggerDecision('reject');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        triggerDecision('keep');
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        triggerDecision('unsure');
      } else if (e.key === 'ArrowUp' || e.key === ' ') {
        e.preventDefault();
        if (current) setSelectedOffer(current);
      } else if ((e.ctrlKey && e.key === 'z') || e.key === 'Backspace') {
        e.preventDefault();
        if (!busy && onUndo) onUndo();
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [triggerDecision, current, selectedOffer, busy, onUndo]);


  return (
    <div className="sh-swiper-container">
      <div className="sh-swipe-intro">
        <div>
          <span className="sh-swipe-eyebrow">DÉCOUVRIR · DÉCIDER · AVANCER</span>
          <h1>Vos offres, à votre rythme.</h1>
          <p>Une opportunité à la fois. Consultez la fiche, puis gardez, passez ou remettez à plus tard.</p>
        </div>
        <div className="sh-swipe-progress" aria-live="polite">
          <strong>{queue.length}</strong>
          <span>à parcourir</span>
        </div>
      </div>
      {/* Top Deck Toolbar */}
      <div className="sh-deck-toolbar">
        <div className="sh-deck-queue-info">
          <div className="sh-queue-badge">
            <span className="sh-pulse-dot" />
            <strong>{queue.length}</strong>
            <span>{queue.length > 1 ? 'offres prêtes' : 'offre prête'}</span>
          </div>
          {offers.length > queue.length && (
            <span className="sh-queue-filtered">
              ({offers.length - queue.length} masquée{offers.length - queue.length > 1 ? 's' : ''} par les filtres)
            </span>
          )}
        </div>

        <div className="sh-deck-filters">
          <label className="sh-filter-item">
            <span>Score min.</span>
            <select
              value={minScore}
              onChange={(e) => setMinScore(Number(e.target.value))}
              aria-label="Score minimum"
            >
              <option value={0}>Tous (0+)</option>
              <option value={30}>30+</option>
              <option value={50}>50+</option>
              <option value={70}>70+ (Recommandé)</option>
              <option value={80}>80+ (Top)</option>
            </select>
          </label>

          {availableLocations.length > 0 && (
            <label className="sh-filter-item">
              <span>Région</span>
              <select
                value={cantonFilter}
                onChange={(e) => setCantonFilter(e.target.value)}
                aria-label="Filtrer par région, canton ou lieu"
              >
                <option value="all">Toutes les régions / lieux</option>
                {availableLocations.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          )}

          {stats.unsure > 0 && onRequeue && (
            <button
              className="sh-btn-requeue"
              onClick={() => onRequeue({ all_unsure: true })}
              disabled={busy}
              title="Remettre les offres 'À revoir' dans la file de swipe"
            >
              <Icon name="refresh" size={14} />
              <span>Remettre à revoir ({stats.unsure})</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Deck Stack Area */}
      <div className="sh-deck-stage">
        {current ? (
          <div className="sh-card-stack">
            <AnimatePresence mode="popLayout">
            {/* 3rd Card in background (subtle depth) */}
            {next2 && (
              <Underlay key={`third-${next2.id || next2.url || next2.title}`} offer={next2} depth={2} progress={dragDistance} />
            )}

            {/* 2nd Card in background (full render for smooth swipe reveal) */}
            {next1 && (
              <Underlay key={`second-${next1.id || next1.url || next1.title}`} offer={next1} depth={1} progress={dragDistance} />
            )}

            {/* Front Interactive Card */}
            {!selectedOffer && <TinderCard
              key={`front-${current.id || current.url || current.title}`}
              offer={current}
              isFront={true}
              x={x}
              y={y}
              rotate={rotate}
              disabled={busy || flight || !!selectedOffer}
              onDragEnd={handleDragEnd}
              onOpenDetails={(o) => setSelectedOffer(o)}
            />}
            </AnimatePresence>
          </div>
        ) : (
          /* Empty Deck State */
          <div className="sh-deck-empty">
            <div className="sh-empty-celebration">
              <div className="sh-celebration-sparkles">✨</div>
              <h2>
                {offers.length === 0
                  ? 'Toutes les offres ont été triées !'
                  : 'Aucune offre avec ces filtres'}
              </h2>
              <p>
                {offers.length === 0
                  ? 'Félicitations ! Vous avez passé en revue toutes les opportunités trouvées pour ce profil.'
                  : 'Essayez de baisser le score minimum ou de réinitialiser le filtre de lieu.'}
              </p>

              {/* Stats pill recap */}
              <div className="sh-empty-stats-row">
                <div className="sh-stat-chip green">
                  <Icon name="heart" size={16} />
                  <strong>{stats.keep || 0}</strong>
                  <span>Coups de cœur</span>
                </div>
                <div className="sh-stat-chip amber">
                  <Icon name="clock" size={16} />
                  <strong>{stats.unsure || 0}</strong>
                  <span>À revoir</span>
                </div>
                <div className="sh-stat-chip red">
                  <Icon name="x" size={16} />
                  <strong>{stats.reject || 0}</strong>
                  <span>Passées</span>
                </div>
              </div>

              <div className="sh-empty-actions">
                {minScore > 0 && (
                  <button className="sh-btn-primary" onClick={() => setMinScore(0)}>
                    <Icon name="filter" size={16} />
                    <span>Afficher toutes les offres</span>
                  </button>
                )}
                {stats.unsure > 0 && onRequeue && (
                  <button
                    className="sh-btn-secondary"
                    onClick={() => onRequeue({ all_unsure: true })}
                    disabled={busy}
                  >
                    <Icon name="refresh" size={16} />
                    <span>Revoir les {stats.unsure} offres en doute</span>
                  </button>
                )}
                {onGoToPage && (
                  <button className="sh-btn-primary" onClick={() => onGoToPage('search')}>
                    <Icon name="spark" size={16} />
                    <span>Lancer un nouveau scan</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Floating Tinder Decision Action Buttons */}
      {current && (
        <div className="sh-tinder-controls-bar">
          <div className="sh-tinder-controls">
            {/* Rewind / Undo Button */}
            <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.92 }}
              className="sh-ctrl-btn ctrl-undo"
              onClick={onUndo}
              disabled={busy || !!flight}
              title="Annuler le dernier choix (Ctrl+Z ou Backspace)"
              aria-label="Annuler le dernier choix"
            >
              <Icon name="undo" size={20} />
              <span className="sh-ctrl-label">Annuler</span>
            </motion.button>

            {/* Nope / Reject Button */}
            <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.92 }}
              className="sh-ctrl-btn ctrl-reject"
              onClick={() => triggerDecision('reject')}
              disabled={busy || !!flight}
              title="Passer cette offre (Flèche gauche ←)"
              aria-label="Passer cette offre"
            >
              <Icon name="x" size={28} />
              <span className="sh-ctrl-label">Passer</span>
            </motion.button>

            {/* Star / Later Button */}
            <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.92 }}
              className="sh-ctrl-btn ctrl-later"
              onClick={() => triggerDecision('unsure')}
              disabled={busy || !!flight}
              title="À revoir plus tard (Flèche bas ↓)"
              aria-label="Revoir plus tard"
            >
              <Icon name="clock" size={24} />
              <span className="sh-ctrl-label">À revoir</span>
            </motion.button>

            {/* Like / Keep Button */}
            <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.92 }}
              className="sh-ctrl-btn ctrl-keep"
              onClick={() => triggerDecision('keep')}
              disabled={busy || !!flight}
              title="Garder en coup de cœur (Flèche droite →)"
              aria-label="Garder en coup de cœur"
            >
              <Icon name="heart" size={30} />
              <span className="sh-ctrl-label">Garder</span>
            </motion.button>

            {/* Open Detail Drawer Button */}
            <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.92 }}
              className="sh-ctrl-btn ctrl-details"
              onClick={() => setSelectedOffer(current)}
              disabled={busy || !!flight}
              title="Ouvrir la description complète (Espace ou Flèche haut ↑)"
              aria-label="Description complète"
            >
              <Icon name="fileText" size={20} />
              <span className="sh-ctrl-label">Détails</span>
            </motion.button>
          </div>

          <div className="sh-keyboard-hint">
            <span><kbd>←</kbd> Passer</span>
            <span>·</span>
            <span><kbd>↓</kbd> À revoir</span>
            <span>·</span>
            <span>Garder <kbd>→</kbd></span>
            <span>·</span>
            <span><kbd>↑</kbd> / <kbd>Espace</kbd> Détails</span>
          </div>
        </div>
      )}

      {/* Detail Drawer Modal */}
      <AnimatePresence>
      {selectedOffer && (
        <OfferDetailModal
          layoutId="active-offer-card"
          offer={selectedOffer}
          busy={busy}
          onClose={() => setSelectedOffer(null)}
          onDecide={(offer, decision) => {
            triggerDecision(decision);
          }}
          onTransferCandidature={onTransferCandidature}
        />
      )}
      </AnimatePresence>
    </div>
  );
}
