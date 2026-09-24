import React, { useEffect } from 'react';
import { Icon } from '../Common/Icons';
import { descriptionText } from './descriptionText';

export function OfferDetailModal({ offer, onClose, onDecide, busy }) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!offer) return null;

  const score = Math.max(0, Math.min(100, Math.round(Number(offer.score) || 0)));
  const confidence = Math.round(Number(offer.confidence) || 0);
  const isOpen = offer.availability_status === 'open';

  // Format description text or snippet
  const rawText = descriptionText(offer.body_preview || offer.body || offer.snippet || '');
  const paragraphs = rawText
    .split(/\n{2,}|\r\n\r\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const reasonsList = (offer.reasons || '')
    .split(/\n/)
    .map((r) => r.trim())
    .filter(Boolean);

  return (
    <div className="sh-modal-backdrop" onClick={onClose}>
      <div className="sh-modal-drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header className="sh-modal-header">
          <div className="sh-modal-titlebox">
            <span className="sh-modal-eyebrow">Détails complets de l’opportunité</span>
            <h2>{offer.title || 'Offre sans titre'}</h2>
            <div className="sh-modal-meta">
              <span className="sh-modal-company">{offer.company || 'Entreprise inconnue'}</span>
              <span>·</span>
              <span>{offer.location || offer.canton || 'Lieu à confirmer'}</span>
              {offer.source && (
                <>
                  <span>·</span>
                  <span className="sh-badge-source">{offer.source}</span>
                </>
              )}
            </div>
          </div>
          <button className="sh-modal-close" onClick={onClose} aria-label="Fermer">
            <Icon name="x" size={20} />
          </button>
        </header>

        <div className="sh-modal-body">
          {/* Quick Metrics Bar */}
          <div className="sh-modal-metrics">
            <div className={`sh-metric-pill score-${score >= 70 ? 'high' : score >= 45 ? 'mid' : 'low'}`}>
              <strong>{score}%</strong>
              <span>Compatibilité</span>
            </div>
            <div className="sh-metric-pill">
              <strong>{confidence}%</strong>
              <span>Confiance</span>
            </div>
            <div className={`sh-metric-pill ${isOpen ? 'status-open' : 'status-pending'}`}>
              <strong>{isOpen ? 'Ouverte' : 'À vérifier'}</strong>
              <span>Disponibilité</span>
            </div>
            {offer.duration && (
              <div className="sh-metric-pill">
                <strong>{offer.duration}</strong>
                <span>Durée</span>
              </div>
            )}
            {offer.start_date && (
              <div className="sh-metric-pill">
                <strong>{offer.start_date}</strong>
                <span>Date début</span>
              </div>
            )}
          </div>

          {/* Section: Why it matches */}
          {reasonsList.length > 0 && (
            <div className="sh-modal-section">
              <div className="sh-section-title">
                <Icon name="spark" size={17} />
                <h3>Analyse de correspondance</h3>
              </div>
              <ul className="sh-reasons-list">
                {reasonsList.map((reason, idx) => (
                  <li key={idx}>
                    <span className="sh-bullet">✦</span>
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Section: Skills */}
          {offer.skills_found && (
            <div className="sh-modal-section">
              <div className="sh-section-title">
                <Icon name="briefcase" size={17} />
                <h3>Compétences détectées</h3>
              </div>
              <div className="sh-tags-cloud">
                {offer.skills_found.split(/,|\n/).map((s, i) => {
                  const cleaned = s.trim();
                  return cleaned ? <span key={i} className="sh-tag-skill">{cleaned}</span> : null;
                })}
              </div>
            </div>
          )}

          {/* Section: Job Description */}
          <div className="sh-modal-section">
            <div className="sh-section-title">
              <Icon name="fileText" size={17} />
              <h3>Description du poste & contenu extrait</h3>
            </div>
            {paragraphs.length > 0 ? (
              <div className="sh-job-text">
                {paragraphs.map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
            ) : (
              <div className="sh-empty-text">
                <p>Aucun texte brut extrait disponible pour cette offre. Consultez directement la page carrière officielle.</p>
              </div>
            )}
          </div>
        </div>

        {/* Modal Sticky Footer Actions */}
        <footer className="sh-modal-footer">
          {offer.url && (
            <a
              href={offer.url}
              target="_blank"
              rel="noopener noreferrer"
              className="sh-btn-external"
            >
              <span>Voir l'offre officielle</span>
              <Icon name="external" size={16} />
            </a>
          )}
          <div className="sh-modal-decide-buttons">
            <button
              className="sh-btn-action pass"
              disabled={busy}
              onClick={() => {
                onDecide(offer, 'reject');
                onClose();
              }}
              title="Passer cette offre"
            >
              <Icon name="x" size={18} />
              <span>Passer</span>
            </button>
            <button
              className="sh-btn-action later"
              disabled={busy}
              onClick={() => {
                onDecide(offer, 'unsure');
                onClose();
              }}
              title="Revoir plus tard"
            >
              <Icon name="clock" size={18} />
              <span>À revoir</span>
            </button>
            <button
              className="sh-btn-action love"
              disabled={busy}
              onClick={() => {
                onDecide(offer, 'keep');
                onClose();
              }}
              title="Garder cette offre"
            >
              <Icon name="heart" size={18} />
              <span>Garder</span>
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
