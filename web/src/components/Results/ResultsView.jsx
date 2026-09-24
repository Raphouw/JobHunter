import React, { useMemo, useState } from 'react';
import { Icon } from '../Common/Icons';
import { OfferDetailModal } from '../Swiper/OfferDetailModal';

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #ec4899 0%, #f43f5e 100%)', // Rose/Salmon
  'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)', // Violet/Indigo
  'linear-gradient(135deg, #06b6d4 0%, #0ea5e9 100%)', // Cyan/Sky
  'linear-gradient(135deg, #10b981 0%, #059669 100%)', // Emerald
  'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)', // Amber/Orange
  'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)', // Purple
  'linear-gradient(135deg, #f43f5e 0%, #e11d48 100%)', // Coral
];

function getAvatarGradient(name = '') {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const idx = Math.abs(hash) % AVATAR_GRADIENTS.length;
  return AVATAR_GRADIENTS[idx];
}

export function ResultsView({
  results = [],
  profileId,
  busy = false,
  onDecide,
  onRequeue,
  onCommand,
}) {
  const [query, setQuery] = useState('');
  const [filterTab, setFilterTab] = useState('all'); // all | keep | unsure
  const [selectedOffer, setSelectedOffer] = useState(null);

  // Filter results
  const filtered = useMemo(() => {
    return results.filter((o) => {
      if (filterTab !== 'all' && o.review_decision !== filterTab) return false;
      if (!query.trim()) return true;
      const haystack = `${o.title || ''} ${o.company || ''} ${o.location || ''} ${o.canton || ''} ${o.skills_found || ''} ${o.reasons || ''}`.toLowerCase();
      return haystack.includes(query.trim().toLowerCase());
    });
  }, [results, filterTab, query]);

  const keepCount = results.filter((o) => o.review_decision === 'keep').length;
  const unsureCount = results.filter((o) => o.review_decision === 'unsure').length;

  return (
    <div className="sh-view results-view">
      {/* Header */}
      <div className="sh-view-header">
        <div>
          <span className="sh-eyebrow">MES OPPORTUNITÉS</span>
          <h1>Offres sauvegardées</h1>
          <p>Retrouve tes coups de cœur et les offres mises de côté pour analyse approfondie.</p>
        </div>

        {/* Global actions */}
        <div className="sh-header-actions">
          <a
            href={`/api/export-csv?profile=${encodeURIComponent(profileId)}`}
            download
            className="sh-btn-secondary"
            title="Télécharger un tableau CSV de ces offres"
          >
            <Icon name="download" size={16} />
            <span>Exporter CSV</span>
          </a>

          {onCommand && (
            <button
              className="sh-btn-primary"
              onClick={() => onCommand('review-sync')}
              disabled={busy}
              title="Envoyer les offres gardées vers Google Sheets"
            >
              <Icon name="external" size={16} />
              <span>Sync Google Sheets</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="sh-results-toolbar">
        <div className="sh-search-box">
          <Icon name="search" size={18} />
          <input
            type="text"
            placeholder="Rechercher par métier, entreprise, ville, compétence..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              className="sh-btn-clear"
              onClick={() => setQuery('')}
              aria-label="Effacer la recherche"
            >
              <Icon name="x" size={16} />
            </button>
          )}
        </div>

        <div className="sh-segmented-tabs">
          <button
            className={`sh-tab ${filterTab === 'all' ? 'active' : ''}`}
            onClick={() => setFilterTab('all')}
          >
            Toutes ({results.length})
          </button>
          <button
            className={`sh-tab ${filterTab === 'keep' ? 'active' : ''}`}
            onClick={() => setFilterTab('keep')}
          >
            ♥ Coups de cœur ({keepCount})
          </button>
          <button
            className={`sh-tab ${filterTab === 'unsure' ? 'active' : ''}`}
            onClick={() => setFilterTab('unsure')}
          >
            🕒 À revoir ({unsureCount})
          </button>
        </div>
      </div>

      {/* Results Count & Batch Requeue */}
      <div className="sh-results-subbar">
        <span className="sh-results-count">
          {filtered.length} offre{filtered.length > 1 ? 's' : ''} affichée{filtered.length > 1 ? 's' : ''}
        </span>
        {filterTab === 'unsure' && filtered.length > 0 && onRequeue && (
          <button
            className="sh-link-btn"
            disabled={busy}
            onClick={() => onRequeue({ all_unsure: true })}
          >
            <Icon name="refresh" size={14} />
            <span>Remettre toutes les offres 'À revoir' dans le Swiper</span>
          </button>
        )}
      </div>

      {/* List of cards */}
      {filtered.length > 0 ? (
        <div className="sh-results-grid">
          {filtered.map((offer) => {
            const score = Math.max(0, Math.min(100, Math.round(Number(offer.score) || 0)));
            const isKeep = offer.review_decision === 'keep';
            const isOpen = offer.availability_status === 'open';

            return (
              <article key={offer.id} className="sh-result-item">
                <div className="sh-result-top">
                  <div className="sh-result-company-badge">
                    <div
                      className="brand-avatar sm"
                      style={{ background: getAvatarGradient(offer.company || 'SH') }}
                    >
                      {String(offer.company || 'SH').slice(0, 2).toUpperCase()}
                    </div>
                    <div className="sh-company-text">
                      <strong>{offer.company || 'Entreprise inconnue'}</strong>
                      <span className="sh-location">
                        <Icon name="pin" size={12} />
                        {offer.location || offer.canton || 'Lieu à confirmer'}
                      </span>
                    </div>
                  </div>

                  <div className="sh-result-score-box">
                    <span className={`sh-score-badge ${score >= 70 ? 'high' : score >= 45 ? 'mid' : 'low'}`}>
                      {score}%
                    </span>
                    <span className={`sh-status-indicator ${isKeep ? 'keep' : 'unsure'}`}>
                      {isKeep ? '♥ Gardée' : '🕒 À revoir'}
                    </span>
                  </div>
                </div>

                <h3 className="sh-result-title">{offer.title || 'Offre sans titre'}</h3>

                <div className="sh-result-chips">
                  {offer.duration && <span className="sh-chip">{offer.duration}</span>}
                  {offer.start_date && <span className="sh-chip">Dès {offer.start_date}</span>}
                  {offer.language && <span className="sh-chip">{offer.language}</span>}
                  <span className={`sh-chip ${isOpen ? 'open' : ''}`}>
                    {isOpen ? 'Candidature ouverte' : 'À vérifier'}
                  </span>
                </div>

                {offer.skills_found && (
                  <div className="sh-result-skills">
                    {offer.skills_found.split(/,|\n/).slice(0, 4).map((s, i) => (
                      <span key={i} className="sh-skill-mini">
                        {s.trim()}
                      </span>
                    ))}
                  </div>
                )}

                <div className="sh-result-actions">
                  <button
                    className="sh-btn-text"
                    onClick={() => setSelectedOffer(offer)}
                  >
                    <Icon name="info" size={15} />
                    <span>Détails & motifs</span>
                  </button>

                  <div className="sh-result-btn-group">
                    {onRequeue && (
                      <button
                        className="sh-btn-icon"
                        title="Remettre dans le Swiper"
                        onClick={() => onRequeue({ offer_ids: [offer.id] })}
                        disabled={busy}
                      >
                        <Icon name="refresh" size={16} />
                      </button>
                    )}

                    {offer.url && (
                      <a
                        href={offer.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="sh-btn-icon"
                        title="Voir l'offre officielle"
                      >
                        <Icon name="external" size={16} />
                      </a>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="sh-empty-state">
          <Icon name="search" size={32} />
          <h3>Aucune offre trouvée</h3>
          <p>Modifie ta recherche ou change d’onglet de filtre pour explorer les autres opportunités.</p>
          {query && (
            <button className="sh-btn-secondary" onClick={() => setQuery('')}>
              Effacer la recherche
            </button>
          )}
        </div>
      )}

      {/* Details Modal */}
      {selectedOffer && (
        <OfferDetailModal
          offer={selectedOffer}
          busy={busy}
          onClose={() => setSelectedOffer(null)}
          onDecide={(offer, decision) => {
            if (onDecide) onDecide(offer, decision);
            setSelectedOffer(null);
          }}
        />
      )}
    </div>
  );
}
