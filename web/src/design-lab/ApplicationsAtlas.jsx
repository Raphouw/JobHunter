import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Common/Icons';
import { COUNTRIES, REGIONS_BY_COUNTRY, EUROPE_REGIONS_GEO, geocodeCandidature } from '../components/Candidatures/europeMapData';
import { AddCandidatureModal } from '../components/Candidatures/AddCandidatureModal';
import { AddNoteModal } from '../components/Candidatures/AddNoteModal';
import './applications-atlas.css';

const DAY = 86400000;
const STATUS_FILTERS = [['all', 'Toutes'], ['urgent', 'À relancer'], ['sent', 'Envoyées'], ['reply', 'Réponses'], ['interview', 'Entretiens'], ['offer', 'Offres'], ['refused', 'Refus']];
const STATUS_LABELS = { sent: 'Envoyée', reply: 'Réponse reçue', interview: 'Entretien', offer: 'Offre / validation', refused: 'Refus' };
const normalize = (value) => String(value || '').toLocaleLowerCase('fr').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function parseDate(value) {
  const match = String(value || '').match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  const date = match ? new Date(+match[3], +match[2] - 1, +match[1]) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
function stage(item) {
  const value = normalize(item.status);
  if (value.includes('refus') || value.includes('rejet')) return 'refused';
  if (value.includes('valid') || value.includes('offre') || value.includes('accept')) return 'offer';
  if (value.includes('entretien')) return 'interview';
  if (value.includes('initiale') || value.includes('envoy') || !value) return 'sent';
  return 'reply';
}
function fitBounds(points, maxScale = 8.5) {
  if (!points.length) return { x: 500, y: 490, scale: 1 };
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs), right = Math.max(...xs);
  const top = Math.min(...ys), bottom = Math.max(...ys);
  const spanX = Math.max(right - left, 38);
  const spanY = Math.max(bottom - top, 38);
  return { x: (left + right) / 2, y: (top + bottom) / 2, scale: clamp(Math.min(1000 / (spanX * 1.25), 980 / (spanY * 1.25)), 1, maxScale) };
}
function pathPoints(path) {
  return [...String(path).matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((match) => ({ x: +match[1], y: +match[2] }));
}
function mapPoint(svg, clientX, clientY) {
  const point = svg.createSVGPoint();
  point.x = clientX; point.y = clientY;
  return point.matrixTransform(svg.getScreenCTM().inverse());
}
function regionCodeFor(item, geo, country) {
  const value = normalize(item.region || item.canton);
  const match = (REGIONS_BY_COUNTRY[country] || []).find((entry) => normalize(entry.code) === value || normalize(entry.name) === value);
  return match?.code || geo.region || '';
}

export function ApplicationsAtlas({ candidatures = [], profileId, accessToken, busy = false, onSaveCandidature, onUpdateStatus, onAddNote, onDeleteCandidature, onPullGoogleSheets, onSyncGoogleSheets, googleConnected = false, prefillFromOffer, onClearPrefill }) {
  const [country, setCountry] = useState('ALL');
  const [region, setRegion] = useState('');
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('recent');
  const [selectedId, setSelectedId] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const returnFocusRef = useRef(null);
  const detailRef = useRef(null);
  const [groupIds, setGroupIds] = useState(null);
  const [view, setView] = useState({ x: 500, y: 490, scale: 1 });
  const [mobileTab, setMobileTab] = useState('map');
  const [modal, setModal] = useState(null);
  const [noteTarget, setNoteTarget] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [cityIndexes, setCityIndexes] = useState({});
  const [gmail, setGmail] = useState({ open: false, loading: false, notice: '', updates: [] });
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const pointersRef = useRef(new Map());
  const gestureRef = useRef(null);
  const suppressClickRef = useRef(false);

  useEffect(() => { if (prefillFromOffer) setModal(prefillFromOffer); }, [prefillFromOffer]);
  useEffect(() => {
    setCountry('ALL'); setRegion(''); setStatus('all'); setQuery('');
    setSelectedId(null); setGroupIds(null); setView({ x: 500, y: 490, scale: 1 });
  }, [profileId]);
  const usedCountries = useMemo(() => [...new Set(candidatures.map((item) => item.country || 'CH'))], [candidatures]);
  useEffect(() => {
    let live = true;
    usedCountries.forEach((code) => {
      if (cityIndexes[code]) return;
      fetch(`/cities/${code}.json`).then((response) => response.ok ? response.json() : null).then((data) => {
        if (live && data) setCityIndexes((current) => ({ ...current, [code]: data }));
      }).catch(() => {});
    });
    return () => { live = false; };
  }, [usedCountries, cityIndexes]);

  const items = useMemo(() => candidatures.map((item) => {
    const geo = geocodeCandidature(item, cityIndexes);
    const countryCode = item.country || geo.country || 'CH';
    const phase = stage(item);
    const days = Math.max(0, Math.floor((Date.now() - (parseDate(item.created_at)?.getTime() || Date.now())) / DAY));
    return { ...item, geo, countryCode, regionCode: regionCodeFor(item, geo, countryCode), phase, days, urgent: phase === 'sent' && days >= 10 };
  }), [candidatures, cityIndexes]);
  const countries = useMemo(() => COUNTRIES.map((entry) => ({ ...entry, count: entry.code === 'ALL' ? items.length : items.filter((item) => item.countryCode === entry.code).length })).filter((entry) => entry.code === 'ALL' || entry.count), [items]);
  const baseFiltered = useMemo(() => items.filter((item) => {
    if (country !== 'ALL' && item.countryCode !== country) return false;
    if (region && item.regionCode !== region) return false;
    if (status === 'urgent' ? !item.urgent : status !== 'all' && item.phase !== status) return false;
    return normalize([item.company, item.location, item.regionCode, item.countryCode, item.sector, item.detailed_activity, item.demarche].join(' ')).includes(normalize(query));
  }).sort((a, b) => sort === 'rating' ? (+b.rating || 0) - (+a.rating || 0) : sort === 'waiting' ? b.days - a.days : (parseDate(b.created_at)?.getTime() || 0) - (parseDate(a.created_at)?.getTime() || 0)), [items, country, region, status, query, sort]);
  const filtered = useMemo(() => groupIds ? baseFiltered.filter((item) => groupIds.includes(item.id)) : baseFiltered, [baseFiltered, groupIds]);
  const counts = useMemo(() => ({ total: filtered.length, replies: filtered.filter((item) => item.phase !== 'sent').length, interviews: filtered.filter((item) => item.phase === 'interview').length, offers: filtered.filter((item) => item.phase === 'offer').length, urgent: filtered.filter((item) => item.urgent).length }), [filtered]);
  const selected = filtered.find((item) => item.id === selectedId) || null;
  const urgent = filtered.filter((item) => item.urgent).sort((a, b) => b.days - a.days);
  const unlocatedCount = filtered.filter((item) => !item.geo.located).length;

  useEffect(() => { if (selectedId && !filtered.some((item) => item.id === selectedId)) setSelectedId(null); }, [filtered, selectedId]);
  useEffect(() => { setGroupIds(null); setSelectedId(null); }, [country, region, status, query]);
  useEffect(() => {
    if (!detailOpen) return undefined;
    const previous = document.activeElement;
    detailRef.current?.focus();
    const onKey = (event) => {
      if (event.key === 'Escape') setDetailOpen(false);
      if (event.key === 'Tab') {
        const focusable = [...(detailRef.current?.querySelectorAll('button:not(:disabled), a[href], select:not(:disabled)') || [])];
        if (!focusable.length) return;
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); (returnFocusRef.current?.isConnected ? returnFocusRef.current : previous)?.focus?.(); };
  }, [detailOpen]);

  const focusCountry = (code) => {
    const target = COUNTRIES.find((entry) => entry.code === code) || COUNTRIES[0];
    setCountry(code); setRegion(''); setSelectedId(null); setGroupIds(null);
    if (code === 'ALL') setView({ x: 500, y: 490, scale: 1 });
    else {
      const [x, y, width, height] = target.viewBox.split(' ').map(Number);
      setView(fitBounds([{ x, y }, { x: x + width, y: y + height }], 7));
    }
  };
  const focusRegion = (entry) => {
    setCountry(entry.country); setRegion(entry.code); setSelectedId(null); setGroupIds(null);
    setView(fitBounds(pathPoints(entry.path), 8));
  };
  const focusItem = (item) => {
    returnFocusRef.current = document.activeElement;
    setSelectedId(item.id); setExpanded(false); setMobileTab('map');
    if (item.geo.located) setView({ x: item.geo.x, y: item.geo.y, scale: Math.max(view.scale, 6) });
    setDetailOpen(true);
  };
  const focusGroup = (group) => {
    setSelectedId(null); setGroupIds(group.items.map((item) => item.id)); setMobileTab('map');
    setView((current) => ({ ...fitBounds(group.items.map((item) => item.geo), 9), scale: Math.min(9, Math.max(current.scale * 1.5, fitBounds(group.items.map((item) => item.geo), 9).scale)) }));
  };
  const resetMap = () => { focusCountry('ALL'); setMobileTab('map'); };
  const zoomAt = useCallback((point, factor) => setView((current) => {
    const scale = clamp(current.scale * factor, 1, 9);
    return { x: point.x - (point.x - current.x) * current.scale / scale, y: point.y - (point.y - current.y) * current.scale / scale, scale };
  }), []);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event) => {
      event.preventDefault();
      zoomAt(mapPoint(svg, event.clientX, event.clientY), event.deltaY < 0 ? 1.14 : 1 / 1.14);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [zoomAt]);
  const panStart = (event) => {
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size === 2) {
      const [first, second] = [...pointersRef.current.values()];
      gestureRef.current = { distance: Math.hypot(first.x - second.x, first.y - second.y), view, midpoint: mapPoint(svgRef.current, (first.x + second.x) / 2, (first.y + second.y) / 2) };
      dragRef.current = null;
      return;
    }
    if (event.target.closest?.('[data-point]')) return;
    dragRef.current = { x: event.clientX, y: event.clientY, origin: mapPoint(svgRef.current, event.clientX, event.clientY) };
  };
  const panMove = (event) => {
    if (pointersRef.current.has(event.pointerId)) pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (gestureRef.current && pointersRef.current.size === 2) {
      const [first, second] = [...pointersRef.current.values()];
      const distance = Math.hypot(first.x - second.x, first.y - second.y);
      const scale = clamp(gestureRef.current.view.scale * distance / gestureRef.current.distance, 1, 9);
      const point = gestureRef.current.midpoint;
      setView({ x: point.x - (point.x - gestureRef.current.view.x) * gestureRef.current.view.scale / scale, y: point.y - (point.y - gestureRef.current.view.y) * gestureRef.current.view.scale / scale, scale });
      suppressClickRef.current = true;
      return;
    }
    if (!dragRef.current) return;
    if (Math.hypot(event.clientX - dragRef.current.x, event.clientY - dragRef.current.y) < 4) return;
    if (!svgRef.current.hasPointerCapture(event.pointerId)) svgRef.current.setPointerCapture(event.pointerId);
    const current = mapPoint(svgRef.current, event.clientX, event.clientY);
    setView((previous) => ({ ...previous, x: previous.x + dragRef.current.origin.x - current.x, y: previous.y + dragRef.current.origin.y - current.y }));
    suppressClickRef.current = true;
  };
  const panEnd = (event) => { pointersRef.current.delete(event.pointerId); dragRef.current = null; if (pointersRef.current.size < 2) gestureRef.current = null; window.setTimeout(() => { suppressClickRef.current = false; }, 0); };
  const blockDragClick = () => { if (!suppressClickRef.current) return false; suppressClickRef.current = false; return true; };

  const clusters = useMemo(() => {
    const grid = clamp(120 / view.scale, 9, 120);
    const map = new Map();
    filtered.forEach((item) => {
      if (!item.geo.located) return;
      const key = `${Math.round(item.geo.x / grid)}:${Math.round(item.geo.y / grid)}`;
      const group = map.get(key) || { x: 0, y: 0, items: [] };
      group.x += item.geo.x; group.y += item.geo.y; group.items.push(item); map.set(key, group);
    });
    return [...map.values()].map((group) => ({ ...group, x: group.x / group.items.length, y: group.y / group.items.length }));
  }, [filtered, view.scale]);
  const mapViewBox = `${view.x - 500 / view.scale} ${view.y - 490 / view.scale} ${1000 / view.scale} ${980 / view.scale}`;
  const scopeName = region ? EUROPE_REGIONS_GEO.find((entry) => entry.country === country && entry.code === region)?.name || region : COUNTRIES.find((entry) => entry.code === country)?.name;

  const scanGmail = async () => {
    setGmail({ open: true, loading: true, notice: '', updates: [] });
    try {
      const response = await fetch('/api/google?action=scan-gmail', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken || localStorage.getItem('sb_access_token') || ''}` }, body: JSON.stringify({ profileId, candidatures: items.map((item) => ({ id: item.id, company: item.company, status: item.status })) }) });
      if (!response.ok) throw new Error(`Erreur HTTP ${response.status}`);
      const data = await response.json();
      setGmail({ open: true, loading: false, notice: data.updates?.length ? `${data.updates.length} réponse(s) possibles détectée(s).` : `${data.scannedCount || 0} emails analysés. Aucun changement détecté.`, updates: data.updates || [] });
    } catch (error) {
      setGmail({ open: true, loading: false, notice: `Analyse impossible : ${error.message}`, updates: [] });
    }
  };
  const applyGmailUpdate = (update) => {
    onUpdateStatus?.(update.candidatureId, update.detectedStatus);
    onAddNote?.(update.candidatureId, { id: `gmail_${Date.now()}`, date: new Date().toLocaleDateString('fr-FR'), text: `Email détecté : « ${update.emailSubject} » de ${update.emailFrom} → ${update.detectedStatus}` });
    setGmail((current) => ({ ...current, updates: current.updates.filter((item) => item.messageId !== update.messageId) }));
  };

  return <div className="atlas sh-view">
    <header className="atlas-header"><div><span className="sh-eyebrow">ESPACE CANDIDATURES</span><h1>Candidatures & Carte</h1><p>Suivez vos démarches, explorez leur emplacement et choisissez la prochaine action.</p></div><div className="atlas-header-actions"><button className="sh-btn-secondary" onClick={scanGmail} disabled={busy || gmail.loading}><Icon name="mail" size={16} /> Scanner Gmail</button>{onPullGoogleSheets && <button className="sh-btn-secondary" onClick={onPullGoogleSheets} disabled={busy}><Icon name="refresh" size={16} /> Importer Sheets</button>}{googleConnected && onSyncGoogleSheets && <button className="sh-btn-secondary" onClick={onSyncGoogleSheets} disabled={busy}><Icon name="external" size={16} /> Exporter</button>}<button className="sh-btn-primary" onClick={() => setModal({})}><Icon name="plus" size={16} /> Nouvelle candidature</button></div></header>
    <section className="atlas-overview" aria-label="Vue d’ensemble"><div className="atlas-overview-primary"><span>Candidatures envoyées</span><strong>{counts.total}</strong></div><div className="atlas-overview-progress"><div><span>Retours reçus</span><strong>{counts.replies}</strong></div><div className="atlas-bar"><i style={{ width: `${counts.total ? counts.replies / counts.total * 100 : 0}%` }} /></div><small>{counts.total ? Math.round(counts.replies / counts.total * 100) : 0}% des candidatures</small></div><div className="atlas-overview-small"><span>Entretiens</span><strong>{counts.interviews}</strong></div><div className="atlas-overview-small"><span>Offres & validations</span><strong>{counts.offers}</strong></div><button className="atlas-overview-urgent" onClick={() => setStatus(status === 'urgent' ? 'all' : 'urgent')}><span>À relancer</span><strong>{counts.urgent}</strong><small>Après 10 jours sans réponse →</small></button></section>
    <section className="atlas-controls" aria-label="Portée et filtres"><div className="atlas-scope"><span className="atlas-control-label">TERRITOIRE</span><div className="atlas-country-list">{countries.map((entry) => <button key={entry.code} className={country === entry.code ? 'active' : ''} aria-pressed={country === entry.code} onClick={() => focusCountry(entry.code)}>{entry.code === 'ALL' ? 'Europe' : entry.name}<em>{entry.count}</em></button>)}</div><select aria-label="Région" value={region} onChange={(event) => { const entry = EUROPE_REGIONS_GEO.find((item) => item.country === country && item.code === event.target.value); if (entry) focusRegion(entry); else { setRegion(''); setSelectedId(null); setGroupIds(null); focusCountry(country); } }} disabled={country === 'ALL'}><option value="">Toutes les régions</option>{(REGIONS_BY_COUNTRY[country] || []).map((entry) => <option key={entry.code} value={entry.code}>{entry.name}</option>)}</select></div><div className="atlas-filter-row"><label className="atlas-search"><Icon name="search" size={16} /><input aria-label="Rechercher par entreprise, ville ou région" placeholder="Entreprise, ville, région…" value={query} onChange={(event) => setQuery(event.target.value)} /></label><div className="atlas-status" role="group" aria-label="Statut">{STATUS_FILTERS.map(([key, label]) => <button key={key} className={status === key ? 'active' : ''} aria-pressed={status === key} onClick={() => setStatus(key)}>{label}</button>)}</div><select aria-label="Trier les candidatures" value={sort} onChange={(event) => setSort(event.target.value)}><option value="recent">Plus récentes</option><option value="rating">Mieux notées</option><option value="waiting">Plus longue attente</option></select></div></section>
    <div className="atlas-mobile-tabs"><button className={mobileTab === 'map' ? 'active' : ''} onClick={() => setMobileTab('map')}>Carte</button><button className={mobileTab === 'details' ? 'active' : ''} onClick={() => setMobileTab('details')}>Suivi · {filtered.length}</button></div>
    <div className={`atlas-workspace atlas-show-${mobileTab}`}>
      <section className="atlas-map-panel" aria-label="Carte des candidatures"><div className="atlas-map-heading"><div><span>EXPLORATION GÉOGRAPHIQUE</span><h2>{scopeName}</h2><p>{filtered.length} candidature{filtered.length !== 1 ? 's' : ''} correspondant aux filtres{unlocatedCount ? ` · ${unlocatedCount} sans ville localisée` : ''}</p></div><div className="atlas-map-tools"><button aria-label="Zoomer" onClick={() => zoomAt(view, 1.3)}>+</button><button aria-label="Dézoomer" onClick={() => zoomAt(view, 1 / 1.3)}>−</button><button aria-label="Réinitialiser la carte" onClick={resetMap}>⌖</button></div></div>
        <svg ref={svgRef} className="atlas-map" viewBox={mapViewBox} onPointerDown={panStart} onPointerMove={panMove} onPointerUp={panEnd} onPointerCancel={panEnd} role="img" aria-label="Carte interactive des candidatures en Europe de l’Ouest"><rect width="1000" height="980" fill="#f4f5f9" />{EUROPE_REGIONS_GEO.map((entry) => <path key={entry.id} d={entry.path} className={`atlas-region ${entry.country === country || country === 'ALL' ? '' : 'muted'} ${region === entry.code && country === entry.country ? 'selected' : ''}`} onClick={() => { if (!blockDragClick()) focusRegion(entry); }}><title>{entry.name}</title></path>)}{clusters.map((group, index) => { const aggregate = group.items.length > 1; const city = group.items.map((entry) => entry.location).filter(Boolean)[0] || group.items[0].regionCode || "Zone non précisée"; const item = group.items[0]; const isSelected = !aggregate && item.id === selectedId; const radius = (aggregate ? 15 : 5.5) / view.scale; const activate = () => { if (blockDragClick()) return; if (aggregate) focusGroup(group); else focusItem(item); }; return <g key={index} data-point="true" role="button" tabIndex="0" aria-label={aggregate ? `Zoomer sur ${group.items.length} candidatures à ${city}` : `Ouvrir ${item.company} à ${city}`} className={`atlas-point ${isSelected ? 'selected' : ''}`} transform={`translate(${group.x} ${group.y})`} onClick={activate} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); } }}><circle r={22 / view.scale} fill="transparent" /><circle r={radius + 5 / view.scale} fill={isSelected ? '#8b5cf633' : '#ffffffaa'} /><circle r={radius} fill={aggregate ? '#6b4cc0' : item.urgent ? '#e66c80' : isSelected ? '#6b4cc0' : '#8b5cf6'} /><title>{aggregate ? `${city} · ${group.items.length} candidatures — cliquer pour zoomer` : `${city} · ${item.company} — cliquer pour ouvrir`}</title>{aggregate && <text textAnchor="middle" dominantBaseline="central" fontSize={12 / view.scale} fill="white" fontWeight="700">{group.items.length}</text>}</g>; })}</svg>
        <div className="atlas-map-foot"><span><i /> Candidature <i className="urgent" /> À relancer <i className="cluster" /> Groupe</span><small>Glisser pour explorer · molette ou geste pour zoomer</small></div>
        {groupIds && <div className="atlas-map-selection"><div><strong>{filtered.length} candidatures dans cette zone</strong><span>Choisissez une ligne ci-dessous pour ouvrir la fiche.</span></div><button onClick={() => setMobileTab('details')}>Voir la liste →</button></div>}
      </section>
      <section className="atlas-results" aria-label="Liste des candidatures">
        <div className="atlas-results-heading"><div><span className="sh-eyebrow">SUIVI DES DÉMARCHES</span><h2>{filtered.length} candidature{filtered.length !== 1 ? 's' : ''}</h2></div>{groupIds && <button className="atlas-clear-group" onClick={() => setGroupIds(null)}>Afficher toutes les candidatures ×</button>}</div>
        {filtered.length ? <div className="atlas-results-list">{filtered.map((item) => <div key={item.id} className={`atlas-result ${selectedId === item.id ? 'active' : ''}`}>
          <button className="atlas-result-main" onClick={() => focusItem(item)} aria-label={`Ouvrir la candidature ${item.company}`}><span className="atlas-list-mark">{String(item.company || '?').slice(0, 1).toUpperCase()}</span><span><strong>{item.company}</strong><small>{item.job_title || item.title || item.demarche || item.sector || 'Candidature spontanée'}</small></span></button>
          <div className="atlas-result-location"><strong>{item.location || item.regionCode || item.countryCode}</strong><small>{item.geo.located ? [item.regionCode, item.countryCode].filter(Boolean).join(' · ') : 'Position non localisée'}</small></div>
          <span className={`atlas-phase phase-${item.phase}`}>{STATUS_LABELS[item.phase]}</span>
          <div className="atlas-result-date"><strong>{item.days} j</strong><small>depuis l’ajout</small></div>
          <div className="atlas-result-next">{item.urgent ? <><strong>À relancer</strong><small>Depuis {item.days - 10} j</small></> : <small>{item.updated_at ? `Mise à jour ${parseDate(item.updated_at)?.toLocaleDateString('fr-FR') || ''}` : 'Suivi en cours'}</small>}</div>
          <div className="atlas-result-actions">{item.urgent && <a href={item.contact_email ? `mailto:${item.contact_email}?subject=${encodeURIComponent(`Relance candidature - ${item.company}`)}` : `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(item.company)}`} target={item.contact_email ? undefined : '_blank'} rel="noopener noreferrer">Relancer</a>}<button onClick={() => focusItem(item)}>Détail ↗</button></div>
        </div>)}</div> : <div className="atlas-empty"><h3>{items.length ? 'Aucune candidature avec ces filtres' : 'Aucune candidature pour le moment'}</h3><p>{items.length ? 'Essayez une autre recherche, région ou statut.' : 'Ajoutez votre première candidature pour commencer le suivi.'}</p><button onClick={() => items.length ? (setQuery(''), setStatus('all'), focusCountry('ALL')) : setModal({})}>{items.length ? 'Effacer les filtres' : 'Ajouter une candidature'}</button></div>}
      </section>
    </div>
    {detailOpen && selected && <div className="sh-modal-backdrop atlas-detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetailOpen(false); }}><div ref={detailRef} tabIndex={-1} className="sh-modal-card atlas-detail" role="dialog" aria-modal="true" aria-labelledby="atlas-detail-title"><div className="sh-modal-header"><div><span className="sh-eyebrow">FICHE CANDIDATURE</span><h2 id="atlas-detail-title">{selected.company}</h2><p>{selected.job_title || selected.title || selected.demarche || selected.sector || 'Candidature spontanée'}</p></div><button className="sh-modal-close" aria-label="Fermer la fiche" onClick={() => setDetailOpen(false)}>×</button></div><div className="atlas-detail-body"><div className="atlas-detail-summary"><span className={`atlas-phase phase-${selected.phase}`}>{STATUS_LABELS[selected.phase]}</span><span>{selected.location || selected.regionCode || selected.countryCode}{!selected.geo.located ? ' · Position non localisée' : ''}</span><span>Ajoutée il y a {selected.days} jours</span>{selected.updated_at && <span>Mise à jour {parseDate(selected.updated_at)?.toLocaleDateString('fr-FR')}</span>}{selected.rating && <span>Intérêt {selected.rating}/10</span>}</div>{selected.urgent && <div className="atlas-detail-reminder"><strong>Relance à faire · {selected.days} jours sans réponse</strong><a href={selected.contact_email ? `mailto:${selected.contact_email}?subject=${encodeURIComponent(`Relance candidature - ${selected.company}`)}` : `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(selected.company)}`} target={selected.contact_email ? undefined : '_blank'} rel="noopener noreferrer">Relancer ↗</a></div>}<div className="atlas-detail-actions"><label>Statut <select value={selected.status || 'Demande initiale'} onChange={(event) => onUpdateStatus?.(selected.id, event.target.value)}><option value="Demande initiale">Envoyée</option><option value="Réponse obtenue">Réponse reçue</option><option value="Entretien">Entretien</option><option value="Validé">Offre / validée</option><option value="Refusé">Refusée</option></select></label><button onClick={() => { setDetailOpen(false); setModal(selected); }}>Modifier</button><button onClick={() => { setDetailOpen(false); setNoteTarget(selected); }}>Ajouter une note</button></div><div className="atlas-detail-links">{selected.contact_email && <a href={`mailto:${selected.contact_email}`}>{selected.contact_email} ↗</a>}{[selected.link1, selected.link2, selected.link3].filter(Boolean).map((link, index) => <a key={index} href={link} target="_blank" rel="noopener noreferrer">Lien {index + 1} ↗</a>)}</div>{selected.detailed_activity && <section><h3>Activité</h3><p>{selected.detailed_activity}</p></section>}{(selected.notes || []).length > 0 && <section><h3>Notes</h3>{selected.notes.map((note, index) => <p key={index}><strong>{note.date || 'Note'}</strong> · {note.text || note}</p>)}</section>}{(selected.status_history || []).length > 0 && <section><h3>Historique</h3>{selected.status_history.map((entry, index) => <p key={index}><strong>{entry.date}</strong> · {entry.status || entry.text}</p>)}</section>}{onDeleteCandidature && <button className="atlas-delete" onClick={() => { if (window.confirm(`Supprimer la candidature ${selected.company} ?`)) { onDeleteCandidature(selected.id); setDetailOpen(false); } }}>Supprimer la candidature</button>}</div></div></div>}
    {modal && <AddCandidatureModal prefill={modal.id ? modal : prefillFromOffer} busy={busy} onClose={() => { setModal(null); onClearPrefill?.(); }} onSave={async (data) => { const result = await onSaveCandidature?.(modal.id ? { ...data, id: modal.id } : data); if (result !== false) { setModal(null); onClearPrefill?.(); } return result !== false; }} />}
    {noteTarget && <AddNoteModal candidature={noteTarget} busy={busy} onClose={() => setNoteTarget(null)} onSave={(id, note) => { onAddNote?.(id, note); setNoteTarget(null); }} />}
    {gmail.open && <div className="sh-modal-backdrop" onClick={() => setGmail((current) => ({ ...current, open: false }))}><div className="sh-modal-card gmail-scan-modal" role="dialog" aria-modal="true" aria-label="Recherche de réponses Gmail" onClick={(event) => event.stopPropagation()}><div className="sh-modal-header"><div className="sh-modal-title"><Icon name="mail" size={20} /><h3>Réponses Gmail</h3></div><button className="sh-modal-close" aria-label="Fermer" onClick={() => setGmail((current) => ({ ...current, open: false }))}>×</button></div><div className="gmail-scan-body">{gmail.loading ? <p>Analyse des emails récents…</p> : <><p className="gmail-summary-notice">{gmail.notice}</p>{gmail.updates.map((update) => <div className="gmail-update-item" key={update.messageId}><div><strong>{update.company}</strong><p>{update.emailSubject}</p><small>{update.emailFrom} · {update.detectedStatus}</small></div><button className="sh-btn-primary sm" onClick={() => applyGmailUpdate(update)}>Appliquer</button></div>)}</>}</div><div className="sh-modal-actions"><button className="sh-btn-secondary" onClick={() => setGmail((current) => ({ ...current, open: false }))}>Fermer</button></div></div></div>}
  </div>;
}
