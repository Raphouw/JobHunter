import React, { useState, useEffect } from 'react';
import { Icon } from '../Common/Icons';
import { COUNTRIES, REGIONS_BY_COUNTRY, geocodeCandidature } from './europeMapData';

export function AddCandidatureModal({ prefill = null, onClose, onSave, busy = false }) {
  const [company, setCompany] = useState('');
  const [country, setCountry] = useState('CH');
  const [region, setRegion] = useState('VD');
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

  // Update region when country changes if current region doesn't belong to new country
  const availableRegions = REGIONS_BY_COUNTRY[country] || [];

  const handleCountryChange = (newCountry) => {
    setCountry(newCountry);
    const regs = REGIONS_BY_COUNTRY[newCountry] || [];
    if (regs.length > 0) {
      setRegion(regs[0].code);
    }
  };

  useEffect(() => {
    if (prefill) {
      if (prefill.company) setCompany(prefill.company);
      if (prefill.location) setLocation(prefill.location);
      if (prefill.sector || prefill.domain_category) {
        setSector(prefill.sector || prefill.domain_category);
      }
      if (prefill.detailed_activity || prefill.title) {
        setDetailedActivity(
          prefill.detailed_activity ||
            `${prefill.title || ''}${prefill.snippet ? ' — ' + prefill.snippet : ''}`
        );
      }
      if (prefill.link1 || prefill.url) setLink1(prefill.link1 || prefill.url);
      if (prefill.link2) setLink2(prefill.link2);
      if (prefill.link3) setLink3(prefill.link3);
      if (prefill.demarche) setDemarche(prefill.demarche);
      if (prefill.rating || prefill.score) {
        const r = prefill.rating
          ? Number(prefill.rating)
          : Math.round(Number(prefill.score || 80) / 10);
        setRating(String(Math.max(1, Math.min(10, r))));
      }
      if (prefill.status) setStatus(prefill.status);
      if (prefill.contact_email || prefill.email) {
        setContactEmail(prefill.contact_email || prefill.email);
      }

      // Geocode to infer Country & Region
      const geo = geocodeCandidature({
        location: prefill.location,
        canton: prefill.canton || prefill.region,
        country: prefill.country,
        company: prefill.company,
      });

      if (geo && geo.country) {
        setCountry(geo.country);
        if (geo.region) setRegion(geo.region);
      } else if (prefill.canton) {
        setRegion(String(prefill.canton).slice(0, 4).toUpperCase());
      }
    }
  }, [prefill]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!company.trim()) {
      setError("Le nom de l'entreprise est obligatoire.");
      return;
    }
    setError('');

    const candidature = {
      company: company.trim(),
      country: country || 'CH',
      canton: region || 'VD',
      region: region || 'VD',
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
      offer_id: prefill?.offer_id || (prefill?.status_history ? null : prefill?.id) || null,
    };

    const saved = await onSave(candidature);
    if (saved === false) setError('Enregistrement impossible. Vérifie les champs puis réessaie.');
  };

  const selectableCountries = COUNTRIES.filter((c) => c.code !== 'ALL');

  return (
    <div className="sh-modal-backdrop" onClick={onClose}>
      <div className="sh-modal-card candidature-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sh-modal-header">
          <div className="sh-modal-title">
            <span className="sh-modal-icon">💼</span>
            <div>
              <h3>
                {prefill?.id
                  ? 'Modifier la candidature'
                  : prefill?.company
                  ? 'Ajouter aux candidatures postulées'
                  : 'Nouvelle Candidature'}
              </h3>
            </div>
          </div>
          <button className="sh-modal-close" onClick={onClose} aria-label="Fermer">
            <Icon name="x" size={18} />
          </button>
        </div>

        {error && <div className="sh-toast error modal-err">{error}</div>}

        <form onSubmit={handleSubmit} className="cand-form">
          <div className="cand-row">
            <div className="cand-field" style={{ flex: 1.2 }}>
              <label>Entreprise *</label>
              <input
                type="text"
                required
                placeholder="ex: Logitech, Airbus, Novartis, Sanofi..."
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              />
            </div>

            <div className="cand-field" style={{ flex: 1 }}>
              <label>Pays *</label>
              <select value={country} onChange={(e) => handleCountryChange(e.target.value)}>
                {selectableCountries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.flag} {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="cand-field" style={{ flex: 1.2 }}>
              <label>Région / Canton *</label>
              <select value={region} onChange={(e) => setRegion(e.target.value)}>
                {availableRegions.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.name} ({r.code})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="cand-row">
            <div className="cand-field">
              <label>Ville de l'Entreprise</label>
              <input
                type="text"
                placeholder="ex: Lausanne, Paris, Munich, Bruxelles..."
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>

            <div className="cand-field">
              <label>Secteur d'activité</label>
              <input
                type="text"
                placeholder="ex: MedTech, FinTech, Luxe, Aérospatial..."
                value={sector}
                onChange={(e) => setSector(e.target.value)}
              />
            </div>

            <div className="cand-field">
              <label>Note d'intérêt (/10)</label>
              <select value={rating} onChange={(e) => setRating(e.target.value)}>
                <option value="10">⭐⭐⭐⭐⭐ 10/10 (Top Priorité)</option>
                <option value="9">⭐⭐⭐⭐ 9/10</option>
                <option value="8">⭐⭐⭐⭐ 8/10 (Très intéressé)</option>
                <option value="7">⭐⭐⭐ 7/10</option>
                <option value="6">⭐⭐⭐ 6/10</option>
                <option value="5">⭐⭐ 5/10 (Moyen)</option>
                <option value="3">⭐ 3/10 (File d'attente)</option>
              </select>
            </div>
          </div>

          <div className="cand-field">
            <label>Activité détaillée (l'entreprise / le poste visé)</label>
            <textarea
              rows="2"
              placeholder="ex: Stage Data & IA, modélisation prédictive et automatisation..."
              value={detailedActivity}
              onChange={(e) => setDetailedActivity(e.target.value)}
            />
          </div>

          <div className="cand-row">
            <div className="cand-field">
              <label>Lien 1 (Offre / Site)</label>
              <input
                type="url"
                placeholder="https://..."
                value={link1}
                onChange={(e) => setLink1(e.target.value)}
              />
            </div>
            <div className="cand-field">
              <label>Lien 2 (Contact / RH)</label>
              <input
                type="url"
                placeholder="https://..."
                value={link2}
                onChange={(e) => setLink2(e.target.value)}
              />
            </div>
            <div className="cand-field">
              <label>Email contact / RH</label>
              <input
                type="email"
                placeholder="recrutement@entreprise.com"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
              />
            </div>
          </div>

          <div className="cand-row">
            <div className="cand-field">
              <label>Démarches effectuées</label>
              <input
                type="text"
                placeholder="ex: Candidature spontanée envoyée via formulaire + message LinkedIn"
                value={demarche}
                onChange={(e) => setDemarche(e.target.value)}
              />
            </div>

            <div className="cand-field">
              <label>Statut initial</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="Demande initiale">Demande initiale (Envoyé)</option>
                <option value="Réponse obtenue">Réponse obtenue</option>
                <option value="Entretien">Entretien fixé</option>
                <option value="Validé">Validé / Offre reçue</option>
                <option value="Refusé">Refusé</option>
              </select>
            </div>
          </div>

          <div className="sh-modal-actions">
            <button type="button" className="sh-btn-secondary" onClick={onClose} disabled={busy}>
              Annuler
            </button>
            <button type="submit" className="sh-btn-primary" disabled={busy}>
              {busy ? 'Enregistrement…' : prefill?.id ? 'Mettre à jour' : '🚀 Ajouter & Placer sur la carte'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AddCandidatureModal;
