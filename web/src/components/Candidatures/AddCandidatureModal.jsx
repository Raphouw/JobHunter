import React, { useState, useEffect } from 'react';
import { Icon } from '../Common/Icons';

export const SWISS_CANTONS_LIST = [
  { code: 'AG', label: 'Argovie | AG | AL' },
  { code: 'AI', label: 'Appenzell Rhodes-Intérieures | AI | AL' },
  { code: 'AR', label: 'Appenzell Rhodes-Extérieures | AR | AL' },
  { code: 'BE', label: 'Berne | BE | AL/FR' },
  { code: 'BL', label: 'Bâle-Campagne | BL | AL' },
  { code: 'BS', label: 'Bâle-Ville | BS | AL' },
  { code: 'FR', label: 'Fribourg | FR | FR/AL' },
  { code: 'GE', label: 'Genève | GE | FR' },
  { code: 'GL', label: 'Glaris | GL | AL' },
  { code: 'GR', label: 'Grisons | GR | AL/ROM/IT' },
  { code: 'JU', label: 'Jura | JU | FR' },
  { code: 'LU', label: 'Lucerne | LU | AL' },
  { code: 'NE', label: 'Neuchâtel | NE | FR' },
  { code: 'NW', label: 'Nidwald | NW | AL' },
  { code: 'OW', label: 'Obwald | OW | AL' },
  { code: 'SG', label: 'Saint-Gall | SG | AL' },
  { code: 'SH', label: 'Schaffhouse | SH | AL' },
  { code: 'SO', label: 'Soleure | SO | AL' },
  { code: 'SZ', label: 'Schwytz | SZ | AL' },
  { code: 'TG', label: 'Thurgovie | TG | AL' },
  { code: 'TI', label: 'Tessin | TI | IT' },
  { code: 'UR', label: 'Uri | UR | AL' },
  { code: 'VD', label: 'Vaud | VD | FR' },
  { code: 'VS', label: 'Valais | VS | FR/AL' },
  { code: 'ZG', label: 'Zoug | ZG | AL' },
  { code: 'ZH', label: 'Zurich | ZH | AL' },
];

export function AddCandidatureModal({ prefill = null, onClose, onSave, busy = false }) {
  const [company, setCompany] = useState('');
  const [canton, setCanton] = useState('VD');
  const [location, setLocation] = useState('');
  const [sector, setSector] = useState('');
  const [detailedActivity, setDetailedActivity] = useState('');
  const [link1, setLink1] = useState('');
  const [link2, setLink2] = useState('');
  const [link3, setLink3] = useState('');
  const [demarche, setDemarche] = useState('');
  const [rating, setRating] = useState('8');
  const [status, setStatus] = useState('Demande initiale');
  const [contactEmail, setContactEmail] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (prefill) {
      if (prefill.company) setCompany(prefill.company);
      if (prefill.canton) {
        const raw = String(prefill.canton).trim().toUpperCase();
        const found = SWISS_CANTONS_LIST.find((c) => raw.includes(c.code) || c.label.toUpperCase().includes(raw));
        if (found) setCanton(found.code);
      }
      if (prefill.location) setLocation(prefill.location);
      if (prefill.sector || prefill.domain_category) setSector(prefill.sector || prefill.domain_category);
      if (prefill.detailed_activity || prefill.title) setDetailedActivity(prefill.detailed_activity || `${prefill.title || ''}${prefill.snippet ? ' — ' + prefill.snippet : ''}`);
      if (prefill.link1 || prefill.url) setLink1(prefill.link1 || prefill.url);
      if (prefill.link2) setLink2(prefill.link2);
      if (prefill.link3) setLink3(prefill.link3);
      if (prefill.demarche) setDemarche(prefill.demarche);
      if (prefill.rating || prefill.score) {
        const r = prefill.rating ? Number(prefill.rating) : Math.round(Number(prefill.score || 80) / 10);
        setRating(String(Math.max(1, Math.min(10, r))));
      }
      if (prefill.status) setStatus(prefill.status);
      if (prefill.contact_email || prefill.email) setContactEmail(prefill.contact_email || prefill.email);
    }
  }, [prefill]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!company.trim()) {
      setError("Le nom de l'entreprise est obligatoire.");
      return;
    }
    setError('');

    const candidature = {
      company: company.trim(),
      canton: canton || 'VD',
      location: location.trim(),
      sector: sector.trim(),
      detailed_activity: detailedActivity.trim(),
      link1: link1.trim(),
      link2: link2.trim(),
      link3: link3.trim(),
      demarche: demarche.trim(),
      rating: Number(rating) || 0,
      status: status || 'Demande initiale',
      contact_email: contactEmail.trim(),
      offer_id: prefill?.offer_id || prefill?.id || null,
    };

    onSave(candidature);
  };

  return (
    <div className="sh-modal-backdrop" onClick={onClose}>
      <div className="sh-modal-card candidature-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sh-modal-header">
          <div className="sh-modal-title">
            <span className="sh-modal-icon">✨</span>
            <div>
              <h3>{prefill?.id ? 'Modifier la candidature' : prefill?.company ? 'Transférer en candidature' : 'Nouvelle Candidature'}</h3>
              <p>Suis tes démarches, entretiens et relances pour ce stage.</p>
            </div>
          </div>
          <button className="sh-modal-close" onClick={onClose} aria-label="Fermer">
            <Icon name="x" size={18} />
          </button>
        </div>

        {error && <div className="sh-toast error modal-err">{error}</div>}

        <form onSubmit={handleSubmit} className="cand-form">
          <div className="cand-row">
            <div className="cand-field">
              <label>Canton *</label>
              <select value={canton} onChange={(e) => setCanton(e.target.value)}>
                {SWISS_CANTONS_LIST.map((c) => (
                  <option key={c.code} value={c.code}>{c.label}</option>
                ))}
              </select>
            </div>

            <div className="cand-field" style={{ flex: 1.5 }}>
              <label>Entreprise *</label>
              <input
                type="text"
                required
                placeholder="ex: Logitech, EPFL, Rolex..."
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              />
            </div>
          </div>

          <div className="cand-row">
            <div className="cand-field">
              <label>Ville de l'Entreprise</label>
              <input
                type="text"
                placeholder="ex: Lausanne, Genève, Zurich..."
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>

            <div className="cand-field">
              <label>Secteur d'activité</label>
              <input
                type="text"
                placeholder="ex: MedTech, FinTech, Robotique..."
                value={sector}
                onChange={(e) => setSector(e.target.value)}
              />
            </div>
          </div>

          <div className="cand-field">
            <label>Activité détaillée (l'entreprise / le poste)</label>
            <textarea
              rows="2"
              placeholder="ex: Stage Data Engineer, développement de pipelines..."
              value={detailedActivity}
              onChange={(e) => setDetailedActivity(e.target.value)}
            />
          </div>

          <div className="cand-row">
            <div className="cand-field">
              <label>Lien 1 (Offre)</label>
              <input
                type="url"
                placeholder="https://..."
                value={link1}
                onChange={(e) => setLink1(e.target.value)}
              />
            </div>
            <div className="cand-field">
              <label>Lien 2</label>
              <input
                type="url"
                placeholder="https://..."
                value={link2}
                onChange={(e) => setLink2(e.target.value)}
              />
            </div>
            <div className="cand-field">
              <label>Lien 3</label>
              <input
                type="url"
                placeholder="https://..."
                value={link3}
                onChange={(e) => setLink3(e.target.value)}
              />
            </div>
          </div>

          <div className="cand-field">
            <label>Statut / Démarche effectuée</label>
            <textarea
              rows="2"
              placeholder="ex: Candidature spontanée envoyée par mail, message LinkedIn envoyé..."
              value={demarche}
              onChange={(e) => setDemarche(e.target.value)}
            />
          </div>

          <div className="cand-row">
            <div className="cand-field" style={{ flex: 0.6 }}>
              <label>Note d'intérêt (/10)</label>
              <select value={rating} onChange={(e) => setRating(e.target.value)}>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <option key={n} value={String(n)}>{n} / 10</option>
                ))}
              </select>
            </div>

            <div className="cand-field">
              <label>Statut actuel</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="Demande initiale">Demande initiale</option>
                <option value="Réponse obtenue">Réponse obtenue</option>
                <option value="Entretien">Entretien</option>
                <option value="Validé">Validé / Offre</option>
                <option value="Refusé">Refusé</option>
              </select>
            </div>

            <div className="cand-field" style={{ flex: 1.2 }}>
              <label>Email de contact</label>
              <input
                type="email"
                placeholder="contact@entreprise.ch"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
              />
            </div>
          </div>

          <div className="sh-modal-actions">
            <button type="button" className="sh-btn-secondary" onClick={onClose} disabled={busy}>
              Annuler
            </button>
            <button type="submit" className="sh-btn-primary" disabled={busy}>
              {busy ? 'Enregistrement…' : prefill?.company ? 'Ajouter aux Candidatures' : 'Créer la fiche'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AddCandidatureModal;
