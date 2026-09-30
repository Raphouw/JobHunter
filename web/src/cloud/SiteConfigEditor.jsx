import React, { useEffect, useState } from 'react';
import { VisualSitePicker } from './VisualSitePicker';
import { Icon } from '../components/Common/Icons';
import './site-reference-list.css';
import { selectorErrors } from './site-selector-utils';

const fields = ['detail_link', 'title', 'company', 'location', 'contract', 'date', 'description', 'application_link', 'salary', 'work_time', 'experience', 'sector', 'education'];
const labels = ['Lien de détail *', 'Titre *', 'Entreprise', 'Lieu', 'Contrat', 'Date', 'Description', 'Lien de candidature', 'Rémunération', 'Temps partiel / temps plein', 'Expérience demandée', 'Secteur d’activité', 'Diplôme demandé'];
const countryOptions = [['FR', 'France'], ['CH', 'Suisse'], ['BE', 'Belgique'], ['DE', 'Allemagne'], ['ES', 'Espagne'], ['IT', 'Italie'], ['LU', 'Luxembourg']];
const countryAliases = { FR: ['france'], CH: ['suisse', 'switzerland', 'schweiz', 'svizzera'], BE: ['belgique', 'belgium'], DE: ['allemagne', 'germany', 'deutschland'], ES: ['espagne', 'spain', 'espana'], IT: ['italie', 'italy', 'italia'], LU: ['luxembourg'] };
const countryCode = (value) => {
  const normalized = String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return Object.keys(countryAliases).find((code) => normalized === code.toLowerCase() || countryAliases[code].includes(normalized)) || value;
};

const empty = () => ({
  name: '',
  listing_url: '',
  enabled: false,
  countries: [],
  absent_fields: { selectors: [], detail_selectors: [], pagination: [] },
  query: { keyword_param: '', location_param: '' },
  selectors: { card: '', ...Object.fromEntries(fields.map((key) => [key, ''])) },
  detail_selectors: Object.fromEntries(fields.slice(1).map((key) => [key, ''])),
  pagination: { next_selector: '', page_param: '', start: 1, step: 1 },
  limits: { max_pages: 1, max_offers: 40, max_detail_pages: 3 },
});

function SelectorControl({ section, fieldKey, label, site, change, markAbsent, error, diagnostic, optional = true }) {
  const value = site[section]?.[fieldKey] || '';
  const absent = (site.absent_fields?.[section] || []).includes(fieldKey);
  const id = `site-${section}-${fieldKey}`;
  return <div className="sh-field">
    <label htmlFor={id}>{label}</label>
    <input id={id} type="text" value={value} aria-invalid={Boolean(error)} aria-describedby={`${id}-feedback`}
      onChange={(event) => change(section, fieldKey, event.target.value)} placeholder={absent ? 'Absent sur cette page' : fieldKey.includes('link') ? 'a[href]' : '.champ'} />
    <div id={`${id}-feedback`}>
      {error && <small className="sh-selector-error" role="alert">{error}</small>}
      {!error && absent && <small className="sh-label-hint">Absent sur cette page · facultatif</small>}
      {!error && !absent && diagnostic && <small className={diagnostic.count && diagnostic.sample ? 'sh-selector-sample' : 'sh-selector-warning'}>
        {diagnostic.count ? `${diagnostic.count} élément(s) trouvé(s) · ${diagnostic.sample || 'aucun texte ou lien extrait : vérifie la cible'}` : 'Aucun élément trouvé dans cet aperçu. Vérifie la sélection ou indique que ce champ est absent.'}
      </small>}
    </div>
    <div className="sh-selector-actions">
      {optional && <button type="button" className="sh-btn-secondary sm" onClick={() => markAbsent(section, fieldKey)}>Absent sur cette page</button>}
      {(value || absent) && <button type="button" className="sh-btn-secondary sm" onClick={() => change(section, fieldKey, '')}>Effacer</button>}
    </div>
  </div>;
}

export function SiteConfigEditor({ profile, accessToken, onSaved, busy }) {
  const [site, setSite] = useState(empty);
  const [editingShared, setEditingShared] = useState(null);
  const [preview, setPreview] = useState(null);
  const [token, setToken] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [inspection, setInspection] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [references, setReferences] = useState([]);
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);
  const [detailUrl, setDetailUrl] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [diagnostics, setDiagnostics] = useState({});
  const currentErrors = { ...fieldErrors, ...selectorErrors(site) };

  const profileKeywords = profile?.target?.job_titles?.[0] || 'Ingénieur / Développeur';
  const profileCountries = profile?.location?.countries || [];
  const profileLocation = (site.countries?.length ? profileCountries.find((country) => site.countries.includes(countryCode(country))) : profileCountries[0]) || '';

  const evaluatedUrl = React.useMemo(() => {
    if (!site.listing_url) return '';
    let url = site.listing_url;
    url = url.replace('{keywords}', encodeURIComponent(profileKeywords));
    url = url.replace('{location}', encodeURIComponent(profileLocation));
    try {
      const parsed = new URL(url);
      if (site.query?.keyword_param) {
        parsed.searchParams.set(site.query.keyword_param, profileKeywords);
      }
      if (site.query?.location_param) {
        parsed.searchParams.set(site.query.location_param, profileLocation);
      }
      return parsed.toString();
    } catch (_) {
      return url;
    }
  }, [site.listing_url, site.query?.keyword_param, site.query?.location_param, profileKeywords, profileLocation]);

  useEffect(() => {
    setSite(empty());
    setEditingShared(null);
    setPreview(null);
    setToken('');
    setInspection(null);
    setDetailUrl('');
    setFieldErrors({});
    setDiagnostics({});
    setCatalog([]);
    setReferences([]);
    setIsAdmin(false);
  }, [profile?.id]);

  useEffect(() => {
    if (!profile?.id || !accessToken) return;
    let active = true;
    fetch('/api/sites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ action: 'catalog', profile_id: profile.id }),
    })
      .then(async (res) => {
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Catalogue indisponible');
        return result;
      })
      .then((result) => {
        if (!active) return;
        setCatalog(result.recipes || []);
        setReferences(result.references || []);
        setIsAdmin(Boolean(result.is_admin));
      })
      .catch(() => {
        if (!active) return;
        setCatalog([]);
        setReferences([]);
        setIsAdmin(false);
      });
    return () => { active = false; };
  }, [profile?.id, accessToken, JSON.stringify(profile?.location?.countries), JSON.stringify(profile?.sources), catalogVersion]);

  const edit = (entry, shared = null) => {
    setEditingShared(shared);
    setDetailUrl('');
    const defaults = empty();
    setSite({ ...defaults, ...structuredClone(entry), query: { ...defaults.query, ...entry.query },
      selectors: { ...defaults.selectors, ...entry.selectors }, detail_selectors: { ...defaults.detail_selectors, ...entry.detail_selectors } });
    setPreview(null);
    setToken('');
    setInspection(null);
    setError('');
    setNotice('');
    setFieldErrors({});
    setDiagnostics({});
  };

  const change = (section, key, value) => {
    setSite((current) =>
      section
        ? { ...current, [section]: { ...current[section], [key]: value }, enabled: false,
            absent_fields: { ...current.absent_fields, [section]: (current.absent_fields?.[section] || []).filter((field) => field !== key) } }
        : { ...current, [key]: value, enabled: false }
    );
    setPreview(null);
    setToken('');
    setFieldErrors((previous) => Object.fromEntries(Object.entries(previous).filter(([path]) => path !== `${section}.${key}`)));
    setError('');
  };

  const markAbsent = (section, key) => {
    change(section, key, '');
    setSite((current) => ({ ...current, absent_fields: { ...current.absent_fields,
      [section]: [...new Set([...(current.absent_fields?.[section] || []), key])] } }));
  };

  const run = async (action, nextSite) => {
    if (['save', 'preview', 'publish'].includes(action)) {
      const issues = selectorErrors(nextSite, action !== 'save' || Boolean(nextSite.enabled));
      setFieldErrors(issues);
      if (Object.keys(issues).length) {
        setError('Corrige les champs signalés avant de continuer.');
        return;
      }
    }
    setWorking(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          action,
          profile_id: profile.id,
          site: nextSite,
          listing_url: nextSite?.listing_url,
          enabled: nextSite?.enabled,
          preview_token: token,
          recipe_id: action === 'publish' ? editingShared?.id : undefined,
          site_id: nextSite?.id,
          name: nextSite?.name,
          use_entered_url: action === 'preview' && !nextSite.listing_url.includes('{keywords}') && !nextSite.listing_url.includes('{location}'),
        }),
      });
      const result = await response.json();
      if (result.field_errors) setFieldErrors(result.field_errors);
      if (result.preview) setPreview(result.preview);
      if (!response.ok) throw new Error(result.error || 'Opération impossible');
      if (result.site) setSite(result.site);
      if (action === 'preview') {
        setPreview(result.preview);
        setToken(result.preview_token);
        if (result.preview?.offers?.[0]?.detail_link) {
          setDetailUrl(result.preview.offers[0].detail_link);
        }
        if (result.sample_tested) {
          setNotice(`Test réussi sur l'URL d'exemple : ${result.preview.offers.length} offre(s) extraite(s). Note : avec les critères actuels de ton profil, ce site ne renvoie aucune offre pour le moment, mais les sélecteurs sont validés et le site est activable !`);
        } else {
          setNotice(`Test réussi : ${result.preview.offers.length} offre(s) extraite(s). Tu peux maintenant activer le site.`);
        }
      } else if (action === 'save') {
        setNotice(result.site.enabled ? 'Site validé et activé pour les scans.' : 'Brouillon enregistré.');
        await onSaved();
      } else if (action === 'delete' || action === 'delete_private') {
        edit(empty());
        setNotice('Site supprimé.');
        await onSaved();
        setCatalogVersion((value) => value + 1);
      } else if (action === 'toggle') {
        setNotice(nextSite.enabled ? 'Site réactivé pour ce profil.' : 'Site désactivé pour ce profil.');
        await onSaved();
        setCatalogVersion((value) => value + 1);
      } else {
        setNotice(action === 'publish' ? 'Recette publiée pour tous les utilisateurs.' : 'Recette désactivée.');
        const refreshRes = await fetch('/api/sites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ action: 'catalog', profile_id: profile.id }),
        });
        const refreshed = await refreshRes.json();
        setCatalog(refreshed.recipes || []);
        setReferences(refreshed.references || []);
      }
    } catch (failure) {
      setError(failure.message);
    } finally {
      setWorking(false);
    }
  };

  const inspectPage = async (kind, url = '') => {
    setWorking(true);
    setError('');
    try {
      const response = await fetch('/api/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          action: 'inspect',
          profile_id: profile.id,
          ...(kind === 'detail' ? { url } : { site }),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Impossible de charger la page');
      setInspection({ ...result, kind });
    } catch (failure) {
      setError(failure.message);
    } finally {
      setWorking(false);
    }
  };

  const mySites = profile?.sources?.sites || [];
  const referenceGroups = new Map();
  const selectedCountries = new Set(profileCountries.map(countryCode));
  const countrySites = [...references, ...catalog.map((row) => ({ ...row, countries: row.config?.countries || [] }))];
  countrySites.forEach((row) => {
    const countries = row.countries?.length ? [...new Set(row.countries.map(countryCode))].filter((code) => selectedCountries.has(code)) : [...selectedCountries];
    countries.forEach((code) => {
      if (!referenceGroups.has(code)) referenceGroups.set(code, {
        code, label: code === 'all' ? 'Tous les pays' : countryOptions.find(([key]) => key === code)?.[1] || code, sites: [],
      });
      referenceGroups.get(code).sites.push(row);
    });
  });
  const sortedReferenceGroups = [...referenceGroups.values()].sort((a, b) =>
    a.code === b.code ? 0 : a.code === 'all' ? 1 : b.code === 'all' ? -1 : a.label.localeCompare(b.label, 'fr'));
  const isDisabled = (url) => {
    try {
      const host = new URL(url).hostname.replace(/^www\./, '');
      return (profile?.sources?.disabled_sites || []).some((entry) => new URL(entry).hostname.replace(/^www\./, '') === host);
    } catch (_) { return false; }
  };

  const handleUrlChange = (newUrl) => {
    setInspection(null);
    setDetailUrl('');
    setDiagnostics({});
    let nextQuery = { ...site.query };
    let cleanedUrl = newUrl;
    try {
      if (newUrl.startsWith('http')) {
        const parsed = new URL(newUrl);

        // Auto-clean noise or autocomplete session params (like HelloWork l_autocomplete / k_autocomplete)
        let modified = false;
        for (const p of ['k_autocomplete', 'l_autocomplete', 'msa']) {
          if (parsed.searchParams.has(p)) {
            parsed.searchParams.delete(p);
            modified = true;
          }
        }
        if (modified) {
          cleanedUrl = parsed.toString();
        }

        const searchParamKeys = Array.from(parsed.searchParams.keys()).map((k) => k.toLowerCase());

        const commonKw = ['term', 'q', 'query', 'keywords', 'keyword', 'k', 'what', 'search'];
        const commonLoc = ['loc', 'location', 'where', 'place', 'city', 'l'];

        const matchedKw = searchParamKeys.find((k) => commonKw.includes(k));
        if (matchedKw && !site.query.keyword_param) {
          nextQuery.keyword_param = matchedKw;
        }

        const matchedLoc = searchParamKeys.find((k) => commonLoc.includes(k));
        if (matchedLoc && !site.query.location_param) {
          nextQuery.location_param = matchedLoc;
        }
      }
    } catch (_) {}

    setSite((current) => ({
      ...current,
      listing_url: cleanedUrl,
      query: nextQuery,
      enabled: false,
    }));
    setPreview(null);
    setToken('');
  };

  const kwSuggestions = ['term', 'q', 'keywords', 'query', 'what'];
  const locSuggestions = ['location', 'loc', 'where', 'place'];

  const effectiveDetailLink = detailUrl || preview?.offers?.[0]?.detail_link || '';

  return (
    <div className="sh-site-config-view">
      <div className="sh-view-header">
        <div>
          <span className="sh-eyebrow">PORTAILS CARRIÈRES & DIRECTS</span>
          <h1>Configuration des sites de listings</h1>
          <p>
            Configure l'extraction automatique d'offres directement sur les sites carrières ou jobboards partenaires.
            Inspecte visuellement une page, sélectionne les champs clés, teste en conditions réelles et active la recette.
          </p>
        </div>
      </div>

      {/* Recettes existantes */}
      <section className="sh-form-section">
        <div className="sh-section-header">
          <div>
            <h2>Mes recettes personnelles</h2>
            <p>Sites explorés spécifiquement pour ton profil.</p>
          </div>
          <button type="button" className="sh-btn-secondary" onClick={() => edit(empty())}>
            <Icon name="plus" size={15} />
            <span>Ajouter un site</span>
          </button>
        </div>

        <div className="sh-catalog-box">
          <h4>Sites de référence pour les pays du profil</h4>
          <p>{(profile?.location?.countries || []).join(', ') || 'Configure les pays de recherche dans ton profil.'} · Chaque activation est propre à ce profil.</p>
          {sortedReferenceGroups.map((group) => (
            <section key={group.code} className="sh-reference-country" aria-label={`Sites de référence : ${group.label}`}>
              <h5>{group.label} · {group.sites.length} site{group.sites.length > 1 ? 's' : ''}</h5>
              <div className="sh-reference-list">
            {group.sites.toSorted((a, b) => a.name.localeCompare(b.name, 'fr')).map((row) => (
              <div key={row.listing_url} className={`sh-reference-row ${row.enabled ? '' : 'is-disabled'}`}>
                <label><input type="checkbox" checked={Boolean(row.enabled)} disabled={busy || working || (row.status && row.status !== 'published')}
                  onChange={(event) => run('toggle', { listing_url: row.listing_url, enabled: event.target.checked })} />
                  <span title={row.name}>{row.name}</span>
                </label>
                {isAdmin && <button type="button" className="sh-site-edit-icon" disabled={busy || working}
                  title={`Modifier ${row.name} pour tous`} aria-label={`Modifier ${row.name} pour tous`}
                  onClick={() => edit({ ...empty(), ...row.config, name: row.name, listing_url: row.listing_url, countries: row.countries, enabled: false }, { id: row.id, name: row.name })}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m16 3 5 5M3 21l5-1L21 7a2.1 2.1 0 0 0-4-4L4 16Z" /></svg>
                </button>}
                {row.config && !isAdmin && <button type="button" className="sh-site-edit-icon" disabled={busy || working}
                  title={`Personnaliser ${row.name}`} aria-label={`Personnaliser ${row.name}`}
                  onClick={() => edit({ ...row.config, id: '', enabled: false })}><Icon name="copy" size={14} /></button>}
                {isAdmin && row.status === 'published' && <button type="button" className="sh-site-edit-icon" disabled={busy || working}
                  title={`Désactiver ${row.name} pour tous`} aria-label={`Désactiver ${row.name} pour tous`}
                  onClick={() => run('unpublish', { listing_url: row.listing_url })}><Icon name="x" size={14} /></button>}
                {isAdmin && <button type="button" className="sh-site-edit-icon" disabled={busy || working}
                  title={`Supprimer ${row.name} pour tous`} aria-label={`Supprimer ${row.name} pour tous`}
                  onClick={() => { if (window.confirm(`Supprimer ${row.name} pour tous les profils ?`)) run('delete', row); }}><Icon name="trash" size={14} /></button>}
                <a href={row.listing_url} target="_blank" rel="noreferrer" title={row.listing_url} aria-label={`Ouvrir ${row.name}`}><Icon name="external" size={14} /></a>
              </div>
            ))}
              </div>
            </section>
          ))}
        </div>

        <div className="sh-site-recipe-cards">
          {mySites.map((item) => (
            <div key={item.id} className={`sh-recipe-card ${site.id === item.id ? 'active' : ''}`}>
              <div className="sh-recipe-card-top">
                <strong>{item.name || 'Site sans nom'}</strong>
                <span className={`sh-status-tag ${item.enabled ? 'success' : 'queued'}`}>
                  {item.enabled ? (isDisabled(item.listing_url) ? 'Désactivé pour moi' : 'Publié pour moi') : 'Brouillon'}
                </span>
              </div>
              <span className="sh-recipe-card-url">{item.listing_url}</span>
              {item.enabled && <label><input type="checkbox" checked={!isDisabled(item.listing_url)} disabled={busy || working}
                onChange={(event) => run('toggle', { listing_url: item.listing_url, enabled: event.target.checked })} /> Activer pour moi</label>}
              <button type="button" className="sh-btn-secondary sm" onClick={() => edit(item)}>Modifier</button>
              <button type="button" className="sh-site-edit-icon" disabled={busy || working} title={`Supprimer ${item.name}`} aria-label={`Supprimer ${item.name}`}
                onClick={() => { if (window.confirm(`Supprimer ${item.name} de ce profil ?`)) run('delete_private', item); }}><Icon name="trash" size={14} /></button>
            </div>
          ))}
          {mySites.length === 0 && (
            <p className="sh-site-empty-note">Aucune recette personnalisée pour le moment. Remplis les champs ci-dessous pour configurer un site.</p>
          )}
        </div>


      </section>

      {/* Formulaire de configuration */}
      {editingShared && <div className="sh-toast" role="status">Modification du site par défaut : {editingShared.name}. Teste l’extraction puis enregistre pour tous les profils.</div>}
      <section className="sh-form-section">
        <div className="sh-section-header">
          <div>
            <h2>1. URL et paramètres de recherche</h2>
            <p>Indique l’URL de base du moteur du site et comment injecter les critères du profil.</p>
          </div>
        </div>

        <div className="sh-form-grid">
          <div className="sh-field">
            <label>Pays couverts par ce site</label>
            <div className="sh-param-chips">
              {countryOptions.map(([code, name]) => (
                <label key={code}><input type="checkbox" checked={(site.countries || []).includes(code)}
                  onChange={(event) => change(null, 'countries', event.target.checked ? [...(site.countries || []), code] : site.countries.filter((country) => country !== code))} /> {name}</label>
              ))}
            </div>
            <span className="sh-label-hint">Aucun pays coché : le site apparaît dans chaque pays du profil. Le catalogue et les scans suivent les pays du profil.</span>
          </div>
          <div className="sh-field">
            <label>Nom du site</label>
            <input
              type="text"
              value={site.name}
              onChange={(e) => change(null, 'name', e.target.value)}
              placeholder="ex: JobUp Suisse, WTTJ, etc."
            />
          </div>
          <div className="sh-field">
            <label>URL du listing d'offres</label>
            <input
              type="url"
              value={site.listing_url}
              onChange={(e) => handleUrlChange(e.target.value)}
              placeholder="https://exemple.ch/jobs?q={keywords}&loc={location}"
            />
            <span className="sh-label-hint">Tu peux inclure {'{keywords}'} et {'{location}'} directement dans le chemin de l'URL ou utiliser les paramètres ci-dessous.</span>
          </div>
          <div className="sh-field">
            <label>Paramètre URL des mots-clés du profil</label>
            <input
              type="text"
              value={site.query.keyword_param}
              onChange={(e) => change('query', 'keyword_param', e.target.value)}
              placeholder="ex: term, q, keywords"
            />
            <div className="sh-param-chips">
              <span className="sh-chips-label">Suggestions :</span>
              {kwSuggestions.map((sug) => (
                <button
                  type="button"
                  key={sug}
                  className={`sh-param-chip ${site.query.keyword_param === sug ? 'active' : ''}`}
                  onClick={() => change('query', 'keyword_param', sug)}
                >
                  {sug}
                </button>
              ))}
            </div>
          </div>
          <div className="sh-field">
            <label>Paramètre URL de localisation</label>
            <input
              type="text"
              value={site.query.location_param}
              onChange={(e) => change('query', 'location_param', e.target.value)}
              placeholder="ex: location, loc, where"
            />
            <div className="sh-param-chips">
              <span className="sh-chips-label">Suggestions :</span>
              {locSuggestions.map((sug) => (
                <button
                  type="button"
                  key={sug}
                  className={`sh-param-chip ${site.query.location_param === sug ? 'active' : ''}`}
                  onClick={() => change('query', 'location_param', sug)}
                >
                  {sug}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Live Evaluated URL Banner */}
        {site.listing_url && (
          <div className="sh-url-preview-banner">
            <div className="sh-url-preview-top">
              <span className="sh-url-preview-label">
                <Icon name="link" size={14} />
                <span>URL qui sera réellement explorée pour ton profil :</span>
              </span>
              <span className="sh-url-preview-badge ok">Prête pour le scan</span>
            </div>
            <code className="sh-url-preview-code">{evaluatedUrl}</code>
            <div className="sh-url-preview-params">
              <span>
                Mots-clés injectés : <strong>"{profileKeywords}"</strong> {site.query.keyword_param ? `(?${site.query.keyword_param}=)` : (site.listing_url.includes('{keywords}') ? '({keywords})' : '(aucun)')}
              </span>
              <span>
                Lieu injecté : <strong>"{profileLocation}"</strong> {site.query.location_param ? `(?${site.query.location_param}=)` : (site.listing_url.includes('{location}') ? '({location})' : '(aucun)')}
              </span>
            </div>
          </div>
        )}

        {/* Sample Detail URL Input (Optional) */}
        <div className="sh-form-grid" style={{ marginTop: '14px' }}>
          <div className="sh-field full-width">
            <label>URL d'une fiche de détail exemple (pour inspecter et configurer la description)</label>
            <div className="sh-input-with-button">
              <input
                type="url"
                value={detailUrl}
                onChange={(e) => setDetailUrl(e.target.value)}
                placeholder="https://exemple.ch/offres/detail/12345 (auto-rempli dès qu'une offre est détectée)"
              />
              <button
                type="button"
                className="sh-btn-secondary"
                disabled={busy || working || !detailUrl}
                onClick={() => inspectPage('detail', detailUrl)}
              >
                <Icon name="external" size={14} />
                <span>Inspecter cette fiche</span>
              </button>
            </div>
          </div>
        </div>

        <div className="sh-site-inspect-action-bar">
          <button
            type="button"
            className="sh-btn-primary"
            disabled={busy || working || !site.listing_url}
            onClick={() => inspectPage('listing')}
          >
            <Icon name="eye" size={16} />
            <span>{working ? 'Chargement…' : 'Prévisualiser le lien saisi et sélectionner'}</span>
          </button>
          {effectiveDetailLink && (
            <button
              type="button"
              className="sh-btn-secondary"
              disabled={busy || working}
              onClick={() => inspectPage('detail', effectiveDetailLink)}
            >
              <Icon name="external" size={16} />
              <span>Inspecter une fiche de détail réelle</span>
            </button>
          )}
        </div>

        {/* Visual Picker */}
        <VisualSitePicker
          inspection={inspection}
          site={site}
          onSelector={change}
          onAbsent={markAbsent}
          onDiagnostics={setDiagnostics}
          onInspectDetail={(url) => {
            setDetailUrl(url);
            inspectPage('detail', url);
          }}
          onInspectListing={() => inspectPage('listing')}
          firstDetailLink={effectiveDetailLink}
        />

        {/* Sélecteurs avancés */}
        <div className="sh-advanced-selectors-block">
          <h3>2. Sélecteurs CSS des cartes</h3>
          <p>Ces sélecteurs sont automatiquement remplis par les clics dans l'aperçu ci-dessus, mais restent ajustables à la main.</p>
          <div className="sh-form-grid">
            <SelectorControl section="selectors" fieldKey="card" label="Carte d’offre complète (conteneur répétitif) *" site={site}
              change={change} markAbsent={markAbsent} optional={false} error={currentErrors['selectors.card']} diagnostic={diagnostics['selectors.card']} />
            {fields.map((key, index) => (
              <SelectorControl key={key} section="selectors" fieldKey={key} label={labels[index]} site={site} change={change} markAbsent={markAbsent}
                optional={!['title', 'detail_link'].includes(key)} error={currentErrors[`selectors.${key}`]} diagnostic={diagnostics[`selectors.${key}`]} />
            ))}
          </div>
        </div>

        {/* Sélecteurs fiche de détail */}
        <div className="sh-advanced-selectors-block">
          <h3>3. Sélecteurs de la fiche de détail / Cockpit (facultatif)</h3>
          <p>
            Renseigne ces sélecteurs si certaines données (notamment la description complète) ne figurent pas sur la carte de listing mais dans le volet latéral (Cockpit) ou sur la page de détail.
            <em> Si laissé vide, Job Hunter extrait automatiquement le corps du texte lors du scan.</em>
          </p>
          <div className="sh-form-grid">
            {fields.slice(1).map((key, index) => (
              <SelectorControl key={key} section="detail_selectors" fieldKey={key} label={labels[index + 1].replace(' *', '')} site={site}
                change={change} markAbsent={markAbsent} error={currentErrors[`detail_selectors.${key}`]} diagnostic={diagnostics[`detail_selectors.${key}`]} />
            ))}
          </div>
        </div>

        {/* Pagination & Limites */}
        <div className="sh-advanced-selectors-block">
          <h3>4. Pagination et limites de sécurité</h3>
          <div className="sh-form-grid">
            <SelectorControl section="pagination" fieldKey="next_selector" label="Sélecteur du lien Page Suivante" site={site}
              change={change} markAbsent={markAbsent} error={currentErrors['pagination.next_selector']} diagnostic={diagnostics['pagination.next_selector']} />
            <div className="sh-field">
              <label>OU paramètre de page URL</label>
              <input
                type="text"
                value={site.pagination.page_param}
                onChange={(e) => change('pagination', 'page_param', e.target.value)}
                placeholder="ex: page ou p"
              />
            </div>
            <div className="sh-field">
              <label>Pages max par scan (1–5)</label>
              <input
                type="number"
                min="1"
                max="5"
                value={site.limits.max_pages}
                onChange={(e) => change('limits', 'max_pages', Number(e.target.value))}
              />
            </div>
            <div className="sh-field">
              <label>Offres max par site (1–100)</label>
              <input
                type="number"
                min="1"
                max="1000"
                value={site.limits.max_offers}
                onChange={(e) => change('limits', 'max_offers', Number(e.target.value))}
              />
            </div>
          </div>
        </div>

        {/* Boutons d'action */}
        {Object.keys(currentErrors).length > 0 && <div className="sh-selector-error-summary" role="alert">
          <strong>{Object.keys(currentErrors).length} champ(s) à corriger</strong>
          <ul>{Object.entries(currentErrors).map(([path, message]) => <li key={path}>{path.startsWith('detail_selectors.') ? 'Fiche de détail' : path.startsWith('pagination.') ? 'Pagination' : 'Carte'} · {path.endsWith('.card') ? 'Carte d’offre' : path.endsWith('.next_selector') ? 'Page suivante' : labels[fields.indexOf(path.split('.')[1])]} : {message}</li>)}</ul>
        </div>}
        <div className="sh-site-actions-bar">
          <button
            type="button"
            className="sh-btn-secondary"
            disabled={busy || working || Boolean(editingShared)}
            onClick={() => run('save', { ...site, enabled: false })}
          >
            Enregistrer le brouillon privé
          </button>
          <button
            type="button"
            className="sh-btn-secondary"
            disabled={busy || working || !site.listing_url}
            onClick={() => run('preview', { ...site, enabled: false })}
          >
            <Icon name="play" size={15} />
            <span>{working ? 'Test en cours…' : 'Tester l’extraction réelle'}</span>
          </button>
          <button
            type="button"
            className="sh-btn-primary"
            disabled={busy || working || !token || Boolean(editingShared)}
            onClick={() => run('save', { ...site, enabled: true })}
          >
            <Icon name="check" size={16} />
            <span>Publier pour moi uniquement</span>
          </button>
          {isAdmin && (
            <button
              type="button"
              className="sh-btn-primary"
              disabled={busy || working || !token}
              onClick={() => run('publish', { ...site, enabled: true })}
            >
              {editingShared ? 'Enregistrer pour tous les profils' : 'Publier pour tous les profils'}
            </button>
          )}
          {site.enabled && (
            <button
              type="button"
              className="sh-btn-secondary"
              disabled={busy || working}
              onClick={() => run('save', { ...site, enabled: false })}
            >
              Désactiver
            </button>
          )}
        </div>

        {error && <div className="sh-history-error-msg"><Icon name="alert" size={14} /><small>{error}</small></div>}
        {notice && <div className="sh-toast success" role="status">{notice}</div>}

        {/* Rapport de prévisualisation */}
        {preview && (
          <div className="sh-site-config-preview">
            <h3>Résultats du test : {preview.offers.length} offre(s) extraite(s) sur {preview.pages} page(s)</h3>
            <p className="sh-preview-test-url">
              URL testée : <a href={preview.listing_url} target="_blank" rel="noreferrer">{preview.listing_url}</a>
            </p>
            <div className="sh-preview-offers-list">
              {preview.offers.map((offer, index) => (
                <div key={`${offer.detail_link}-${index}`} className="sh-preview-offer-card">
                  <div className="sh-preview-offer-header">
                    <strong>{offer.title || 'Titre manquant'}</strong>
                    <span className="sh-preview-company">{offer.company || 'Entreprise manquante'}</span>
                    {offer.location && <span className="sh-preview-location">{offer.location}</span>}
                  </div>
                  <dl className="sh-preview-details-grid">
                    {fields.map((key, fieldIndex) => (
                      <div key={key} className="sh-preview-detail-row">
                        <dt>{labels[fieldIndex]}</dt>
                        <dd>{offer[key] || <em className="missing">Non renseigné</em>}</dd>
                      </div>
                    ))}
                  </dl>
                  {preview.missing?.[index]?.length > 0 && (
                    <div className="sh-missing-fields-warning">
                      <Icon name="alert" size={13} />
                      <span>
                        Champs manquants : {preview.missing[index].map((key) => labels[fields.indexOf(key)] || key).join(', ')}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
