import React, { useEffect, useState } from 'react';
import { Icon } from '../Common/Icons';

export function ConnectionsView({ profile = {}, onSave, onCommand, busy = false }) {
  const [form, setForm] = useState(profile);
  const google = form.integrations?.google || {};

  useEffect(() => {
    setForm(profile);
  }, [profile]);

  const patchGoogle = (key, value) => {
    setForm((prev) => ({
      ...prev,
      integrations: {
        ...(prev.integrations || {}),
        google: {
          ...((prev.integrations || {}).google || {}),
          [key]: value,
        },
      },
    }));
  };

  const actionButtons = [
    { id: 'google-check', label: 'Tester la connexion', icon: 'shield' },
    { id: 'google-auth', label: 'Autoriser Google (OAuth)', icon: 'external' },
    { id: 'google-create-sheet', label: 'Créer un Google Sheet', icon: 'spark' },
    { id: 'google-setup-sheet', label: 'Configurer / Réparer le Sheet', icon: 'sliders' },
    { id: 'review-sync', label: 'Envoyer les offres gardées', icon: 'heart' },
    { id: 'actions', label: 'Synchroniser l’historique Gmail', icon: 'clock' },
  ];

  return (
    <div className="sh-view connections-view">
      <div className="sh-view-header">
        <div>
          <span className="sh-eyebrow">INTÉGRATIONS EXTERNES</span>
          <h1>Google Sheets & Gmail</h1>
          <p>Connecte ton profil à ton espace Google pour exporter automatiquement tes opportunités.</p>
        </div>
      </div>

      {/* Configuration Settings */}
      <section className="sh-form-section">
        <div className="sh-section-header">
          <div>
            <h2>Paramètres de synchronisation</h2>
            <p>Chaque profil peut posséder son propre Google Sheet et ses onglets dédiés.</p>
          </div>
        </div>

        {/* Toggles */}
        <div className="sh-toggles-grid">
          <label className="sh-checkbox-card">
            <input
              type="checkbox"
              checked={!!google.sheets_enabled}
              onChange={(e) => patchGoogle('sheets_enabled', e.target.checked)}
            />
            <div>
              <strong>Synchronisation Google Sheets</strong>
              <small>Exporte automatiquement les offres retenues</small>
            </div>
          </label>

          <label className="sh-checkbox-card">
            <input
              type="checkbox"
              checked={!!google.gmail_enabled}
              onChange={(e) => patchGoogle('gmail_enabled', e.target.checked)}
            />
            <div>
              <strong>Lecture de la boîte Gmail</strong>
              <small>Détecte les réponses, refus ou convocations d'entretien</small>
            </div>
          </label>

          <label className="sh-checkbox-card">
            <input
              type="checkbox"
              checked={!!google.auto_create_sheet}
              onChange={(e) => patchGoogle('auto_create_sheet', e.target.checked)}
            />
            <div>
              <strong>Création automatique de Sheet</strong>
              <small>Crée le document si aucun identifiant n'est fourni</small>
            </div>
          </label>
        </div>

        {/* Sheet IDs */}
        <div className="sh-form-grid" style={{ marginTop: '1.5rem' }}>
          <div className="sh-field">
            <label>Identifiant du Google Sheet (ID ou URL)</label>
            <input
              type="text"
              value={google.sheet_id || ''}
              onChange={(e) => patchGoogle('sheet_id', e.target.value)}
              placeholder="ex: 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms"
            />
          </div>

          <div className="sh-field">
            <label>Nom de l'onglet des offres retenues</label>
            <input
              type="text"
              value={google.opportunity_tab || 'Opportunités'}
              onChange={(e) => patchGoogle('opportunity_tab', e.target.value)}
            />
          </div>

          <div className="sh-field">
            <label>Nom de l'onglet de suivi des candidatures</label>
            <input
              type="text"
              value={google.response_tab || 'Suivi'}
              onChange={(e) => patchGoogle('response_tab', e.target.value)}
            />
          </div>
        </div>

        <div className="sh-form-save-bar">
          <button
            type="button"
            className="sh-btn-primary"
            onClick={() => onSave(form)}
            disabled={busy}
          >
            <Icon name="check" size={17} />
            <span>Enregistrer la configuration</span>
          </button>

          {google.sheet_id && (
            <a
              href={`https://docs.google.com/spreadsheets/d/${encodeURIComponent(google.sheet_id)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="sh-btn-secondary"
            >
              <span>Ouvrir mon Google Sheet</span>
              <Icon name="external" size={16} />
            </a>
          )}
        </div>
      </section>

      {/* Action Commands */}
      <section className="sh-form-section">
        <div className="sh-section-header">
          <div>
            <h2>Actions & Outils Google</h2>
            <p>Lance un test de connectivité, régénère les jetons OAuth ou synchronise les données.</p>
          </div>
        </div>

        <div className="sh-action-buttons-grid">
          {actionButtons.map((btn) => (
            <button
              key={btn.id}
              className="sh-action-tool-btn"
              onClick={() => onCommand(btn.id)}
              disabled={busy}
            >
              <div className="sh-tool-icon">
                <Icon name={btn.icon} size={20} />
              </div>
              <div className="sh-tool-info">
                <strong>{btn.label}</strong>
                <span>Exécuter la commande</span>
              </div>
              <Icon name="arrow" size={16} className="sh-tool-arrow" />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
