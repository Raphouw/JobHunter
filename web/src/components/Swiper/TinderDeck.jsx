import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../Common/Icons';
import { TinderCard } from './TinderCard';
import { OfferDetailModal } from './OfferDetailModal';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

  // Drag physics state
  const cardRef = useRef(null);
  const originRef = useRef(null);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [flight, setFlight] = useState('');

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

  // Execute decision with flight animation
  const triggerDecision = useCallback(
    async (decision) => {
      if (!current || busy || flight) return;
      setFlight(decision);
      await sleep(280);
      try {
        await onDecide(current, decision);
      } finally {
        setFlight('');
        setDrag({ x: 0, y: 0 });
        setIsDragging(false);
      }
    },
    [current, busy, flight, onDecide]
  );

  // Keyboard controls
  useEffect(() => {
    const handleKey = (e) => {
      if (e.target.closest('input, textarea, select')) return;
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

  // Pointer drag events for the front card
  const handlePointerDown = (e) => {
    if (e.target.closest('a, button')) return;
    originRef.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    setIsDragging(true);
    if (cardRef.current && cardRef.current.setPointerCapture) {
      try {
        cardRef.current.setPointerCapture(e.pointerId);
      } catch (_) {}
    }
  };

  const handlePointerMove = (e) => {
    if (!originRef.current) return;
    const dx = e.clientX - originRef.current.x;
    const dy = e.clientY - originRef.current.y;
    setDrag({ x: dx, y: dy });
  };

  const handlePointerUp = () => {
    if (!originRef.current) return;
    originRef.current = null;
    setIsDragging(false);

    const threshold = 110;
    const { x, y } = drag;

    if (x > threshold) {
      triggerDecision('keep');
    } else if (x < -threshold) {
      triggerDecision('reject');
    } else if (y > 95 && Math.abs(y) > Math.abs(x)) {
      triggerDecision('unsure');
    } else {
      // Snap back smoothly
      setDrag({ x: 0, y: 0 });
    }
  };

  return (
    <div className="sh-swiper-container">
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
            {/* 3rd Card in background (subtle depth) */}
            {next2 && (
              <div className="card-underlay-wrapper depth-2" aria-hidden="true">
                <TinderCard offer={next2} isFront={false} onOpenDetails={() => {}} />
              </div>
            )}

            {/* 2nd Card in background (full render for smooth swipe reveal) */}
            {next1 && (
              <div className="card-underlay-wrapper depth-1" aria-hidden="true">
                <TinderCard offer={next1} isFront={false} onOpenDetails={() => {}} />
              </div>
            )}

            {/* Front Interactive Card */}
            <TinderCard
              cardRef={cardRef}
              offer={current}
              isFront={true}
              drag={drag}
              isDragging={isDragging}
              flight={flight}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onOpenDetails={(o) => setSelectedOffer(o)}
            />
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
            <button
              className="sh-ctrl-btn ctrl-undo"
              onClick={onUndo}
              disabled={busy || !!flight}
              title="Annuler le dernier choix (Ctrl+Z ou Backspace)"
              aria-label="Annuler le dernier choix"
            >
              <Icon name="undo" size={20} />
            </button>

            {/* Nope / Reject Button */}
            <button
              className="sh-ctrl-btn ctrl-reject"
              onClick={() => triggerDecision('reject')}
              disabled={busy || !!flight}
              title="Passer cette offre (Flèche gauche ←)"
              aria-label="Passer cette offre"
            >
              <Icon name="x" size={28} />
            </button>

            {/* Star / Later Button */}
            <button
              className="sh-ctrl-btn ctrl-later"
              onClick={() => triggerDecision('unsure')}
              disabled={busy || !!flight}
              title="À revoir plus tard (Flèche bas ↓)"
              aria-label="Revoir plus tard"
            >
              <Icon name="clock" size={24} />
            </button>

            {/* Like / Keep Button */}
            <button
              className="sh-ctrl-btn ctrl-keep"
              onClick={() => triggerDecision('keep')}
              disabled={busy || !!flight}
              title="Garder en coup de cœur (Flèche droite →)"
              aria-label="Garder en coup de cœur"
            >
              <Icon name="heart" size={30} />
            </button>

            {/* Open Detail Drawer Button */}
            <button
              className="sh-ctrl-btn ctrl-details"
              onClick={() => setSelectedOffer(current)}
              disabled={busy || !!flight}
              title="Ouvrir la description complète (Espace ou Flèche haut ↑)"
              aria-label="Description complète"
            >
              <Icon name="fileText" size={20} />
            </button>
          </div>

          <div className="sh-keyboard-hint">
            <span>← Refuser</span>
            <span>·</span>
            <span>↓ Doute</span>
            <span>·</span>
            <span>Garder →</span>
            <span>·</span>
            <span>Espace = Détails</span>
          </div>
        </div>
      )}

      {/* Detail Drawer Modal */}
      {selectedOffer && (
        <OfferDetailModal
          offer={selectedOffer}
          busy={busy}
          onClose={() => setSelectedOffer(null)}
          onDecide={(offer, decision) => {
            triggerDecision(decision);
          }}
          onTransferCandidature={onTransferCandidature}
        />
      )}
    </div>
  );
}
