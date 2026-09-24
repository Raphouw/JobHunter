import React, { useState } from 'react';
import { Icon } from '../Common/Icons';

export function PackEditorModal({
  packId = '',
  packData = {},
  isNew = false,
  onClose,
  onSave,
  busy = false,
}) {
  const [label, setLabel] = useState(packData.label || '');
  const [domains, setDomains] = useState(packData.domains || []);
  const [fixedUrls, setFixedUrls] = useState(packData.fixed_urls || []);
  const [countries, setCountries] = useState(packData.countries || []);
  const [newDomain, setNewDomain] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [idInput, setIdInput] = useState(packId || '');

  const handleAddDomain = (e) => {
    e?.preventDefault();
    const clean = newDomain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (clean && !domains.includes(clean)) {
      setDomains([...domains, clean]);
      setNewDomain('');
    }
  };

  const handleRemoveDomain = (dom) => {
    setDomains(domains.filter((d) => d !== dom));
  };

  const handleAddUrl = (e) => {
    e?.preventDefault();
    const clean = newUrl.trim();
    if (clean && !fixedUrls.includes(clean)) {
      setFixedUrls([...fixedUrls, clean]);
      setNewUrl('');
    }
  };

  const handleRemoveUrl = (url) => {
    setFixedUrls(fixedUrls.filter((u) => u !== url));
  };

  const handleSubmit = (e) => {
    e?.preventDefault();
    const finalId = (isNew ? idInput.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_') : packId) || 'pack_custom';
    const updatedPack = {
      ...packData,
      label: label.trim() || finalId,
      domains,
      ...(fixedUrls.length > 0 ? { fixed_urls: fixedUrls } : {}),
      ...(countries.length > 0 ? { countries } : {}),
    };
    onSave(finalId, updatedPack);
  };

  return (
    <div className="sh-modal-backdrop" onClick={onClose}>
      <div
        className="sh-pack-modal-box"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="sh-pack-modal-header">
          <div className="sh-pack-icon-circle">
            <Icon name="sliders" size={22} />
          </div>
          <div>
            <h2>{isNew ? 'Créer un pack de sources' : `Éditer le pack : ${packData.label || packId}`}</h2>
            <span className="sh-pack-subtitle">Configure les sites et pages carrières interrogés par ce pack</span>
          </div>
          <button className="sh-modal-close" onClick={onClose} aria-label="Fermer">
            <Icon name="x" size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="sh-pack-modal-body">
          {isNew && (
            <div className="sh-field">
              <label>Identifiant unique du pack (clé code)</label>
              <input
                type="text"
                placeholder="ex: suisses_romande_tech"
                value={idInput}
                onChange={(e) => setIdInput(e.target.value)}
                required
              />
            </div>
          )}

          <div className="sh-field">
            <label>Nom affiché du pack</label>
            <input
              type="text"
              placeholder="ex: Suisse — plateformes d'ingénierie"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              required
            />
          </div>

          {/* Domains Section */}
          <div className="sh-pack-section">
            <label className="sh-pack-section-label">
              Domaines carrières & Job boards ({domains.length})
            </label>
            <p className="sh-pack-hint">
              Domaines web explorés lors du scan (ex : careers.roche.com, jobup.ch).
            </p>

            {/* Add Domain Input Bar */}
            <div className="sh-pack-add-row">
              <input
                type="text"
                placeholder="Ajouter un domaine (ex: jobs.logitech.com)..."
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddDomain())}
              />
              <button
                type="button"
                className="sh-btn-pack-add"
                onClick={handleAddDomain}
                disabled={!newDomain.trim()}
              >
                + Ajouter
              </button>
            </div>

            {/* Domains Chips Cloud */}
            <div className="sh-pack-chips-cloud">
              {domains.length > 0 ? (
                domains.map((dom) => (
                  <span key={dom} className="sh-pack-chip">
                    <span className="sh-chip-name">{dom}</span>
                    <button
                      type="button"
                      className="sh-chip-remove"
                      onClick={() => handleRemoveDomain(dom)}
                      title={`Retirer ${dom}`}
                    >
                      ×
                    </button>
                  </span>
                ))
              ) : (
                <span className="sh-pack-empty-chips">Aucun domaine dans ce pack pour l'instant.</span>
              )}
            </div>
          </div>

          {/* Direct URLs Section */}
          <div className="sh-pack-section">
            <label className="sh-pack-section-label">
              URLs carrières directes ({fixedUrls.length})
            </label>
            <p className="sh-pack-hint">
              Pages spécifiques ou listings fixes à explorer en priorité absolue.
            </p>

            <div className="sh-pack-add-row">
              <input
                type="url"
                placeholder="https://company.com/fr/careers/internships"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddUrl())}
              />
              <button
                type="button"
                className="sh-btn-pack-add"
                onClick={handleAddUrl}
                disabled={!newUrl.trim()}
              >
                + Ajouter
              </button>
            </div>

            <div className="sh-pack-urls-list">
              {fixedUrls.map((url, idx) => (
                <div key={idx} className="sh-pack-url-row">
                  <span className="sh-pack-url-text" title={url}>
                    {url}
                  </span>
                  <button
                    type="button"
                    className="sh-chip-remove"
                    onClick={() => handleRemoveUrl(url)}
                    title="Supprimer cette URL"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="sh-pack-modal-footer">
            <button type="button" className="sh-btn-secondary" onClick={onClose} disabled={busy}>
              Annuler
            </button>
            <button type="submit" className="sh-btn-primary" disabled={busy}>
              <Icon name="check" size={16} />
              <span>{busy ? 'Enregistrement...' : 'Enregistrer le pack'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
