import React, { useEffect, useState } from 'react';

const fields = ['detail_link', 'title', 'company', 'location', 'contract', 'date', 'description', 'application_link'];
const labels = ['Lien de détail', 'Titre', 'Entreprise', 'Lieu', 'Contrat', 'Date', 'Description', 'Lien de candidature'];
const empty = () => ({ name: '', listing_url: '', enabled: false,
  query: { keyword_param: '', location_param: '' },
  selectors: { card: '', ...Object.fromEntries(fields.map((key) => [key, ''])) },
  detail_selectors: Object.fromEntries(fields.slice(1).map((key) => [key, ''])),
  pagination: { next_selector: '', page_param: '', start: 1, step: 1 },
  limits: { max_pages: 1, max_offers: 40, max_detail_pages: 3 },
});

export function SiteConfigEditor({ profile, accessToken, onSaved, busy }) {
  const [site, setSite] = useState(empty);
  const [preview, setPreview] = useState(null);
  const [token, setToken] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => { setSite(empty()); setPreview(null); setToken(''); }, [profile?.id]);
  const edit = (entry) => { setSite(structuredClone(entry)); setPreview(null); setToken(''); setError(''); };
  const change = (section, key, value) => {
    setSite((current) => section ? { ...current, [section]: { ...current[section], [key]: value }, enabled: false }
      : { ...current, [key]: value, enabled: false });
    setPreview(null); setToken(''); setNotice('');
  };
  const run = async (action, nextSite) => {
    setWorking(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/sites', { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ action, profile_id: profile.id, site: nextSite, preview_token: token }) });
      const result = await response.json();
      if (result.preview) setPreview(result.preview);
      if (!response.ok) throw new Error(result.error || 'Opération impossible');
      setSite(result.site);
      if (action === 'preview') { setPreview(result.preview); setToken(result.preview_token); }
      else { setNotice(result.site.enabled ? 'Site activé.' : 'Brouillon enregistré.'); await onSaved(); }
    } catch (failure) { setError(failure.message); }
    finally { setWorking(false); }
  };
  const input = (label, value, section, key, options = {}) => <label key={`${section}-${key}`}>{label}
    <input value={value ?? ''} type={options.type || 'text'} min={options.min} max={options.max}
      placeholder={options.placeholder || ''} onChange={(event) => change(section, key, event.target.value)} /></label>;
  return <section className="sh-search-section sh-site-config">
    <div className="sh-section-header"><div><h2>Configurer les sites de listings</h2>
      <p>Ajoute des sélecteurs CSS, teste une page réelle, puis active le site.</p></div></div>
    <div className="sh-site-config-list">{(profile?.sources?.sites || []).map((item) =>
      <button key={item.id} type="button" className="sh-btn-secondary" onClick={() => edit(item)}>
        {item.name} · {item.enabled ? 'Actif' : 'Brouillon'}</button>)}
      <button type="button" className="sh-btn-secondary" onClick={() => edit(empty())}>+ Ajouter un site</button></div>
    <div className="sh-site-config-grid">
      {input('Nom du site', site.name, null, 'name')}
      {input('URL du listing', site.listing_url, null, 'listing_url', { type: 'url', placeholder: 'https://exemple.com/jobs' })}
      {input('Paramètre des mots du profil', site.query.keyword_param, 'query', 'keyword_param', { placeholder: 'q' })}
      {input('Paramètre de localisation', site.query.location_param, 'query', 'location_param', { placeholder: 'location' })}
    </div>
    <p>Le scanner utilise le premier intitulé de poste et le premier pays du profil. Pour une URL à chemin variable, utilise aussi {'{keywords}'} et {'{location}'} dans l’URL.</p>
    <h3>Cartes du listing</h3><div className="sh-site-config-grid">
      {input('Carte d’offre', site.selectors.card, 'selectors', 'card', { placeholder: '.job-card' })}
      {fields.map((key, index) => input(labels[index], site.selectors[key], 'selectors', key, { placeholder: key.includes('link') ? 'a[href]' : '.champ' }))}
    </div>
    <h3>Page de détail (facultatif)</h3><div className="sh-site-config-grid">
      {fields.slice(1).map((key, index) => input(labels[index + 1], site.detail_selectors[key], 'detail_selectors', key))}
    </div>
    <h3>Pagination et limites</h3><div className="sh-site-config-grid">
      {input('Lien page suivante', site.pagination.next_selector, 'pagination', 'next_selector', { placeholder: 'a.next' })}
      {input('Ou paramètre de page', site.pagination.page_param, 'pagination', 'page_param', { placeholder: 'page' })}
      {input('Page initiale', site.pagination.start, 'pagination', 'start', { type: 'number', min: 0 })}
      {input('Pas', site.pagination.step, 'pagination', 'step', { type: 'number', min: 1 })}
      {input('Pages maximum (1–5)', site.limits.max_pages, 'limits', 'max_pages', { type: 'number', min: 1, max: 5 })}
      {input('Offres maximum (1–100)', site.limits.max_offers, 'limits', 'max_offers', { type: 'number', min: 1, max: 100 })}
      {input('Détails testés (0–10)', site.limits.max_detail_pages, 'limits', 'max_detail_pages', { type: 'number', min: 0, max: 10 })}
    </div>
    <div className="sh-site-config-test">
      <button type="button" className="sh-btn-secondary" disabled={busy || working} onClick={() => run('save', { ...site, enabled: false })}>Enregistrer le brouillon</button>
      <button type="button" className="sh-btn-secondary" disabled={busy || working} onClick={() => run('preview', { ...site, enabled: false })}>{working ? 'Test en cours…' : 'Tester sur le site'}</button>
      <button type="button" className="sh-btn-primary" disabled={busy || working || !token} onClick={() => run('save', { ...site, enabled: true })}>Activer après test</button>
      {site.enabled && <button type="button" className="sh-btn-secondary" disabled={busy || working} onClick={() => run('save', { ...site, enabled: false })}>Désactiver</button>}
    </div>
    {error && <p role="alert" className="sh-history-error-msg">{error}</p>}{notice && <p role="status">{notice}</p>}
    {preview && <div className="sh-site-config-preview"><h3>Aperçu : {preview.offers.length} offre(s), {preview.pages} page(s)</h3>
      <p>URL testée : <a href={preview.listing_url} target="_blank" rel="noreferrer">{preview.listing_url}</a></p>
      {preview.offers.map((offer, index) => <details key={offer.detail_link} open={index === 0}>
        <summary>{offer.title || 'Titre manquant'} · {offer.company || 'Entreprise manquante'}</summary>
        <dl>{fields.map((key, fieldIndex) => <React.Fragment key={key}><dt>{labels[fieldIndex]}</dt><dd>{offer[key] || <em>Manquant</em>}</dd></React.Fragment>)}</dl>
        <p>Champs manquants : {preview.missing[index].length
          ? preview.missing[index].map((key) => labels[fields.indexOf(key)] || key).join(', ') : 'aucun'}</p>
      </details>)}</div>}
  </section>;
}
