import React, { useState } from 'react';
import { Icon } from '../Common/Icons';

export function ResetProfileModal({ profileName = '', onClose, onConfirm, busy = false }) {
  const [mode, setMode] = useState('all'); // all | decisions

  const handleConfirm = () => {
    onConfirm(mode);
  };

  return (
    <div className="sh-modal-backdrop" onClick={onClose}>
      <div
        className="sh-reset-modal-box"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="sh-reset-modal-header">
          <div className="sh-reset-icon-circle">
            <Icon name="trash" size={24} />
          </div>
          <div>
            <h2>Réinitialiser les données du profil</h2>
            <span className="sh-reset-profile-tag">Profil : {profileName || 'Actif'}</span>
          </div>
          <button className="sh-modal-close" onClick={onClose} aria-label="Fermer">
            <Icon name="x" size={20} />
          </button>
        </div>

        <div className="sh-reset-modal-body">
          {/* Important safety guarantee */}
          <div className="sh-reset-safety-banner">
            <Icon name="shield" size={18} />
            <div>
              <strong>Vos critères sont protégés</strong>
              <p>
                Vos intitulés ciblés, compétences, école, filtres géographiques et requêtes
                enregistrés dans votre profil YAML restent <u>100% conservés</u>.
              </p>
            </div>
          </div>

          <p className="sh-reset-prompt">
            Choisis comment tu souhaites réinitialiser les données de ce profil :
          </p>

          {/* Mode Choice Cards */}
          <div className="sh-reset-modes">
            <label
              className={`sh-reset-mode-card ${mode === 'all' ? 'selected' : ''}`}
              onClick={() => setMode('all')}
            >
              <input
                type="radio"
                name="reset-mode"
                checked={mode === 'all'}
                onChange={() => setMode('all')}
              />
              <div className="sh-reset-mode-content">
                <strong>Remise à zéro complète des scans & offres (Recommandé)</strong>
                <p>
                  Efface toutes les offres trouvées, swipes et historiques dans la base locale. Le
                  compteur revient à 0 offres, parfait pour relancer un scan complet à neuf.
                </p>
              </div>
            </label>

            <label
              className={`sh-reset-mode-card ${mode === 'decisions' ? 'selected' : ''}`}
              onClick={() => setMode('decisions')}
            >
              <input
                type="radio"
                name="reset-mode"
                checked={mode === 'decisions'}
                onChange={() => setMode('decisions')}
              />
              <div className="sh-reset-mode-content">
                <strong>Remettre toutes les offres dans le Swiper</strong>
                <p>
                  Conserve toutes les offres déjà téléchargées, mais réinitialise toutes les
                  décisions (gardées, écartées) pour te permettre de re-swiper sans relancer de scan.
                </p>
              </div>
            </label>
          </div>
        </div>

        <div className="sh-reset-modal-footer">
          <button type="button" className="sh-btn-secondary" onClick={onClose} disabled={busy}>
            Annuler
          </button>
          <button
            type="button"
            className="sh-btn-danger"
            onClick={handleConfirm}
            disabled={busy}
          >
            <Icon name="trash" size={16} />
            <span>{busy ? 'Réinitialisation...' : 'Confirmer la réinitialisation'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
