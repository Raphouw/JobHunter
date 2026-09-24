import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Icon } from '../Common/Icons';
import {
  COUNTRIES,
  REGIONS_BY_COUNTRY,
  EUROPE_REGIONS_GEO,
  geocodeCandidature,
  projectGpsEurope,
} from './europeMapData';
import { AddCandidatureModal } from './AddCandidatureModal';
import { AddNoteModal } from './AddNoteModal';

const CITY_COUNTRIES = new Set(['CH', 'FR', 'DE', 'BE', 'LU', 'IT', 'ES']);

function normalizeString(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function parseCustomDate(str) {
  if (!str) return null;
  const match = String(str).match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
  if (match) {
    const [, d, m, y] = match;
    const timeMatch = String(str).match(/(\d{1,2}):(\d{1,2})/);
    const h = timeMatch ? parseInt(timeMatch[1], 10) : 12;
    const min = timeMatch ? parseInt(timeMatch[2], 10) : 0;
    return new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10), h, min);
  }
  const iso = new Date(str);
  return isNaN(iso.getTime()) ? null : iso;
}

function getAvatarGradient(name = 'Stage') {
  const gradients = [
    'linear-gradient(135deg, #8b5cf6, #6366f1)',
    'linear-gradient(135deg, #fb7185, #f43f5e)',
    'linear-gradient(135deg, #0ea5e9, #2563eb)',
    'linear-gradient(135deg, #10b981, #059669)',
    'linear-gradient(135deg, #f59e0b, #d97706)',
    'linear-gradient(135deg, #ec4899, #be185d)',
    'linear-gradient(135deg, #14b8a6, #0d9488)',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash += name.charCodeAt(i);
  return gradients[Math.abs(hash) % gradients.length];
}

export function CandidaturesView({
  candidatures = [],
  profileId,
  busy = false,
  onSaveCandidature,
  onUpdateStatus,
  onAddNote,
  onDeleteCandidature,
  onSyncGoogleSheets,
  onPullGoogleSheets,
  googleConnected = false,
  prefillFromOffer = null,
  onClearPrefill = null,
}) {
  const [selectedCountry, setSelectedCountry] = useState('ALL'); // ALL, CH, FR, DE, BE, LU, IT, ES
  const [activeRegionCode, setActiveRegionCode] = useState(null);
  const [activeCityKey, setActiveCityKey] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all'); // all | urgent | envoi | entretien | valide | refus
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState('recent'); // recent | note | urgent
  const [showAddModal, setShowAddModal] = useState(!!prefillFromOffer);
  const [editingCandidature, setEditingCandidature] = useState(null);
  const [noteTargetCandidature, setNoteTargetCandidature] = useState(null);
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, title: '', subtitle: '' });
  const [manualZoom, setManualZoom] = useState(1);
  const mapContainerRef = useRef(null);
  const [cityIndexes, setCityIndexes] = useState({});

  const usedCountries = useMemo(() => [...new Set(candidatures.map((item) => item.country || 'CH'))]
    .filter((code) => CITY_COUNTRIES.has(code)), [candidatures]);
  useEffect(() => {
    let active = true;
    for (const country of usedCountries) {
      if (cityIndexes[country]) continue;
      fetch(`/cities/${country}.json`).then((response) => {
        if (!response.ok) throw new Error(`Index des villes ${country} indisponible`);
        return response.json();
      }).then((cities) => {
        if (active) setCityIndexes((current) => ({ ...current, [country]: cities }));
      }).catch(() => {});
    }
    return () => { active = false; };
  }, [usedCountries, cityIndexes]);

  // Gmail scanning states
  const [gmailScanning, setGmailScanning] = useState(false);
  const [gmailScanResults, setGmailScanResults] = useState(null);
  const [showGmailModal, setShowGmailModal] = useState(false);
  const [gmailNotice, setGmailNotice] = useState('');

  const [lastUpdated, setLastUpdated] = useState(() => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  });

  useEffect(() => {
    if (prefillFromOffer) setShowAddModal(true);
  }, [prefillFromOffer]);

  // Geocode each candidature and enrich with normalized Country and Region
  const enrichedCandidatures = useMemo(() => {
    return candidatures.map((c) => {
      const geo = geocodeCandidature(c, cityIndexes);
      const now = new Date();
      const createdDate = parseCustomDate(c.created_at) || now;
      const waitingDays = Math.max(0, Math.floor((now - createdDate) / (1000 * 60 * 60 * 24)));

      return {
        ...c,
        _geo: geo,
        _country: c.country || geo.country || 'CH',
        _region: c.region || c.canton || geo.region || 'VD',
        _waitingDays: waitingDays,
      };
    });
  }, [candidatures, cityIndexes]);

  // Counts per country
  const countryCounts = useMemo(() => {
    const counts = { ALL: enrichedCandidatures.length, CH: 0, FR: 0, DE: 0, BE: 0, LU: 0, IT: 0, ES: 0 };
    enrichedCandidatures.forEach((c) => {
      if (counts[c._country] !== undefined) {
        counts[c._country] += 1;
      }
    });
    return counts;
  }, [enrichedCandidatures]);

  // Counts per region
  const regionCounts = useMemo(() => {
    const counts = {};
    enrichedCandidatures.forEach((c) => {
      const key = `${c._country}-${c._region}`;
      counts[key] = (counts[key] || 0) + 1;
      counts[c._region] = (counts[c._region] || 0) + 1;
    });
    return counts;
  }, [enrichedCandidatures]);

  // City pins coordinates across Europe
  const cityPins = useMemo(() => {
    const map = new Map();
    enrichedCandidatures.forEach((c) => {
      if (!c._geo.located) return;
      const cityName = String(c.location || c._geo.cityName || '').trim();
      if (!cityName) return;
      const key = `${c._country}---${normalizeString(cityName)}`;

      if (!map.has(key)) {
        map.set(key, {
          key,
          name: cityName,
          country: c._country,
          region: c._region,
          x: c._geo.x,
          y: c._geo.y,
          count: 0,
          items: [],
        });
      }
      const entry = map.get(key);
      entry.count += 1;
      entry.items.push(c);
    });

    return Array.from(map.values());
  }, [enrichedCandidatures]);

  // Top funnel summary stats
  const funnel = useMemo(() => {
    const total = enrichedCandidatures.length;
    const replies = enrichedCandidatures.filter((d) => {
      const s = String(d.status || '').toLowerCase();
      return !s.includes('initiale') && !s.includes('envoy') && s !== '';
    }).length;
    const interviews = enrichedCandidatures.filter((d) => {
      const s = String(d.status || '').toLowerCase();
      return s.includes('entretien');
    }).length;
    const offers = enrichedCandidatures.filter((d) => {
      const s = String(d.status || '').toLowerCase();
      return s.includes('accept') || s.includes('valid') || s.includes('offre');
    }).length;
    const urgentCount = enrichedCandidatures.filter((d) => {
      const s = String(d.status || '').toLowerCase();
      return (s.includes('initiale') || s.includes('envoy') || !s) && d._waitingDays >= 10;
    }).length;

    return { total, replies, interviews, offers, urgentCount };
  }, [enrichedCandidatures]);

  // Urgent list (> 10 days waiting without reply)
  const urgentList = useMemo(() => {
    return enrichedCandidatures
      .filter((c) => {
        const s = String(c.status || '').toLowerCase();
        const isInitial = s.includes('initiale') || s.includes('envoy') || !s;
        return isInitial && c._waitingDays >= 10;
      })
      .sort((a, b) => b._waitingDays - a._waitingDays);
  }, [enrichedCandidatures]);

  // Handle country switch with animated auto-zoom
  const handleSelectCountry = (countryCode) => {
    setSelectedCountry(countryCode);
    setActiveRegionCode(null);
    setActiveCityKey(null);
    setManualZoom(1);

  };

  const stepBackMap = () => {
    setTooltip((current) => ({ ...current, visible: false }));
    if (activeCityKey || activeRegionCode) {
      setActiveCityKey(null);
      setActiveRegionCode(null);
    } else if (selectedCountry !== 'ALL') {
      setSelectedCountry('ALL');
    }
    setManualZoom(1);
  };

  useEffect(() => {
    const element = mapContainerRef.current;
    if (!element) return undefined;
    const onWheel = (event) => {
      event.preventDefault();
      setManualZoom((zoom) => Math.max(1, Math.min(3.5,
        Number((zoom * (event.deltaY < 0 ? 1.14 : 1 / 1.14)).toFixed(2)))));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  const sortedCountries = useMemo(() => [
    ...COUNTRIES.filter((country) => country.code === 'ALL'),
    ...COUNTRIES.filter((country) => country.code !== 'ALL')
      .sort((a, b) => (countryCounts[b.code] || 0) - (countryCounts[a.code] || 0)),
  ], [countryCounts]);

  // Zoom transform calculation for the Western Europe SVG map (1000x980)
  const zoomTransform = useMemo(() => {
    let baseScale = 1;
    let cx = 500;
    let cy = 490;

    const countryObj = COUNTRIES.find((c) => c.code === selectedCountry);
    if (countryObj && countryObj.code !== 'ALL') {
      baseScale = countryObj.scale;
      cx = countryObj.cx;
      cy = countryObj.cy;
    }

    if (activeCityKey) {
      const pin = cityPins.find((p) => p.key === activeCityKey);
      if (pin) {
        cx = pin.x;
        cy = pin.y;
        baseScale = Math.max(baseScale, 4.5);
      }
    } else if (activeRegionCode) {
      const regGeo = EUROPE_REGIONS_GEO.find(
        (r) => r.code === activeRegionCode && (selectedCountry === 'ALL' || r.country === selectedCountry)
      );
      if (regGeo) {
        cx = regGeo.cx;
        cy = regGeo.cy;
        baseScale = Math.max(baseScale, 3.2);
      }
    }

    const effectiveScale = baseScale * manualZoom;
    if (effectiveScale <= 1.05) return 'translate(0px, 0px) scale(1)';

    const dx = 500 - cx * effectiveScale;
    const dy = 490 - cy * effectiveScale;
    return `translate(${dx}px, ${dy}px) scale(${effectiveScale})`;
  }, [selectedCountry, activeRegionCode, activeCityKey, cityPins, manualZoom]);

  // Filtered & sorted candidatures
  const filteredCandidatures = useMemo(() => {
    let list = enrichedCandidatures.filter((d) => {
      // 1. Country filter
      if (selectedCountry !== 'ALL' && d._country !== selectedCountry) {
        return false;
      }

      // 2. Region / Canton filter
      if (activeRegionCode && d._region !== activeRegionCode && !String(d.canton || '').includes(activeRegionCode)) {
        return false;
      }

      // 3. City Pin filter
      if (activeCityKey) {
        const cKey = `${d._country}---${normalizeString(d.location || d._geo.cityName || '')}`;
        if (cKey !== activeCityKey) return false;
      }

      // 4. Status pill filter
      const s = String(d.status || '').toLowerCase();
      if (filterStatus === 'urgent') {
        const isInit = s.includes('envoy') || s.includes('initiale') || !s;
        if (!isInit || d._waitingDays < 10) return false;
      }
      if (filterStatus === 'envoi' && !(s.includes('envoy') || s.includes('initiale') || !s)) return false;
      if (filterStatus === 'entretien' && !s.includes('entretien')) return false;
      if (filterStatus === 'valide' && !(s.includes('accept') || s.includes('offre') || s.includes('valid'))) return false;
      if (filterStatus === 'refus' && !(s.includes('refus') || s.includes('rejet'))) return false;

      // 5. Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const text = `${d.company} ${d.location} ${d._region} ${d._country} ${d.sector} ${d.detailed_activity} ${d.demarche}`.toLowerCase();
        if (!text.includes(q)) return false;
      }

      return true;
    });

    // Sort
    const now = new Date();
    list.sort((a, b) => {
      if (sortOrder === 'note') {
        return (Number(b.rating) || 0) - (Number(a.rating) || 0);
      }
      if (sortOrder === 'urgent') {
        return b._waitingDays - a._waitingDays;
      }
      // 'recent' by default
      const dateA = parseCustomDate(a.created_at) || new Date(0);
      const dateB = parseCustomDate(b.created_at) || new Date(0);
      return dateB - dateA;
    });

    return list;
  }, [enrichedCandidatures, selectedCountry, activeRegionCode, activeCityKey, filterStatus, searchQuery, sortOrder]);

  const handleStatusChange = (candId, newStatus) => {
    if (onUpdateStatus) {
      onUpdateStatus(candId, newStatus);
    }
  };

  const handleRefresh = () => {
    const now = new Date();
    setLastUpdated(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
    if (onPullGoogleSheets) onPullGoogleSheets();
  };

  // Gmail scanning trigger
  const handleScanGmail = async () => {
    setGmailScanning(true);
    setGmailNotice('');
    setShowGmailModal(true);

    try {
      const res = await fetch('/api/google?action=scan-gmail', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('sb_access_token') || ''}`,
        },
        body: JSON.stringify({
          profileId,
          candidatures: enrichedCandidatures.map((c) => ({
            id: c.id,
            company: c.company,
            status: c.status,
          })),
        }),
      });

      if (!res.ok) {
        throw new Error(`Erreur lors du scan Gmail (HTTP ${res.status})`);
      }

      const data = await res.json();
      setGmailScanResults(data);
      if (data.updates && data.updates.length > 0) {
        setGmailNotice(`🎉 ${data.updates.length} correspondance(s) détectée(s) dans tes emails !`);
      } else {
        setGmailNotice(`${data.scannedCount || 0} emails récents analysés. Aucun changement détecté.`);
      }
    } catch (err) {
      setGmailNotice(`Scan impossible : ${err.message}`);
    } finally {
      setGmailScanning(false);
    }
  };

  // Apply a detected Gmail update with 1 click
  const applyGmailUpdate = (update) => {
    handleStatusChange(update.candidatureId, update.detectedStatus);
    if (onAddNote) {
      onAddNote(update.candidatureId, {
        id: `gmail_${Date.now()}`,
        date: new Date().toLocaleDateString('fr-FR'),
        text: `📬 Email détecté : "${update.emailSubject}" de ${update.emailFrom} -> Statut passé à ${update.detectedStatus}`,
      });
    }
    setGmailScanResults((prev) => ({
      ...prev,
      updates: prev.updates.filter((u) => u.messageId !== update.messageId),
    }));
  };

  return (
    <div className="sh-view candidatures-view-native">
      {/* ── HEADER ── */}
      <div className="sh-view-header">
        <div>
          <span className="sh-eyebrow">ESPACE CANDIDATURES</span>
          <h1>Candidatures & Carte</h1>
        </div>

        <div className="sh-header-actions">
          <button
            type="button"
            className="sh-btn-secondary"
            onClick={handleScanGmail}
            disabled={busy || gmailScanning}
            title="Analyser mes emails Gmail pour détecter les réponses, invitations et refus"
          >
            <Icon name="mail" size={16} />
            <span>Scanner Gmail</span>
          </button>

          <button
            type="button"
            className="sh-btn-secondary"
            onClick={handleRefresh}
            disabled={busy}
            title="Relire les candidatures depuis Google Sheets"
          >
            <Icon name="refresh" size={16} />
            <span>Importer Sheets</span>
          </button>

          {googleConnected && onSyncGoogleSheets && (
            <button
              type="button"
              className="sh-btn-secondary"
              onClick={onSyncGoogleSheets}
              disabled={busy}
              title="Exporter vers Google Sheets (Onglets Opportunités + Réponses)"
            >
              <Icon name="external" size={16} />
              <span>Exporter</span>
            </button>
          )}

          <button
            type="button"
            className="sh-btn-primary"
            onClick={() => {
              setEditingCandidature(null);
              setShowAddModal(true);
            }}
          >
            <Icon name="plus" size={16} />
            <span>Nouvelle candidature</span>
          </button>
        </div>
      </div>

      {/* ── STATS FUNNEL CARDS (LIGHT THEME) ── */}
      <div className="cand-funnel-grid">
        <div className="cand-stat-card">
          <div className="cand-stat-icon purple">📬</div>
          <div>
            <span className="cand-stat-val">{funnel.total}</span>
            <span className="cand-stat-label">Candidatures envoyées</span>
          </div>
        </div>

        <div className="cand-stat-card">
          <div className="cand-stat-icon blue">💬</div>
          <div>
            <span className="cand-stat-val">{funnel.replies}</span>
            <span className="cand-stat-label">
              Retours reçus ({funnel.total > 0 ? Math.round((funnel.replies / funnel.total) * 100) : 0}%)
            </span>
          </div>
        </div>

        <div className="cand-stat-card">
          <div className="cand-stat-icon emerald">🎯</div>
          <div>
            <span className="cand-stat-val">{funnel.interviews}</span>
            <span className="cand-stat-label">Entretiens planifiés</span>
          </div>
        </div>

        <div className="cand-stat-card">
          <div className="cand-stat-icon gold">🏆</div>
          <div>
            <span className="cand-stat-val">{funnel.offers}</span>
            <span className="cand-stat-label">Offres & Validations</span>
          </div>
        </div>

        {funnel.urgentCount > 0 && (
          <div
            className="cand-stat-card urgent-highlight"
            onClick={() => setFilterStatus(filterStatus === 'urgent' ? 'all' : 'urgent')}
            title="Cliquer pour filtrer les candidatures en attente depuis plus de 10 jours"
          >
            <div className="cand-stat-icon red">🚨</div>
            <div>
              <span className="cand-stat-val text-red">{funnel.urgentCount}</span>
              <span className="cand-stat-label text-red">À relancer (&gt; 10j)</span>
            </div>
          </div>
        )}
      </div>

      {/* ── COUNTRY SWITCHER TABS (7 COUNTRIES + EUROPE) ── */}
      <div className="cand-country-tabs-wrapper">
        <div className="cand-country-tabs">
          {sortedCountries.map((c) => {
            const count = countryCounts[c.code] || 0;
            const isSelected = selectedCountry === c.code;

            return (
              <button
                key={c.code}
                type="button"
                className={`cand-country-tab ${isSelected ? 'active' : ''}`}
                onClick={() => handleSelectCountry(c.code)}
              >
                <span className="cand-tab-flag">{c.flag}</span>
                <span className="cand-tab-name">{c.name}</span>
                <span className={`cand-tab-badge ${count > 0 ? 'has-cand' : ''}`}>{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── TOOLBAR: SEARCH & STATUS PILLS ── */}
      <div className="cand-sub-toolbar">
        <div className="cand-search-bar">
          <Icon name="search" size={16} />
          <input
            type="text"
            placeholder="Rechercher par entreprise, ville, région, secteur..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="sh-btn-clear" onClick={() => setSearchQuery('')}>
              <Icon name="x" size={14} />
            </button>
          )}
        </div>

        <div className="cand-status-pills">
          <button
            className={`cand-pill ${filterStatus === 'all' ? 'active' : ''}`}
            onClick={() => setFilterStatus('all')}
          >
            Tout ({enrichedCandidatures.length})
          </button>
          <button
            className={`cand-pill urgent ${filterStatus === 'urgent' ? 'active' : ''}`}
            onClick={() => setFilterStatus('urgent')}
          >
            🚨 À relancer ({funnel.urgentCount})
          </button>
          <button
            className={`cand-pill ${filterStatus === 'envoi' ? 'active' : ''}`}
            onClick={() => setFilterStatus('envoi')}
          >
            ✉️ Envoyés ({enrichedCandidatures.filter((c) => String(c.status || '').includes('initiale') || String(c.status || '').includes('envoy') || !c.status).length})
          </button>
          <button
            className={`cand-pill ${filterStatus === 'entretien' ? 'active' : ''}`}
            onClick={() => setFilterStatus('entretien')}
          >
            💬 Entretiens ({funnel.interviews})
          </button>
          <button
            className={`cand-pill ${filterStatus === 'valide' ? 'active' : ''}`}
            onClick={() => setFilterStatus('valide')}
          >
            ✅ Validés ({funnel.offers})
          </button>
          <button
            className={`cand-pill ${filterStatus === 'refus' ? 'active' : ''}`}
            onClick={() => setFilterStatus('refus')}
          >
            ❌ Refus ({enrichedCandidatures.filter((c) => String(c.status || '').includes('refus')).length})
          </button>
        </div>

        <select
          className="cand-sort-dropdown"
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
        >
          <option value="recent">⏱️ Plus récentes</option>
          <option value="note">⭐ Mieux notées</option>
          <option value="urgent">⏳ Plus longue attente</option>
        </select>
      </div>

      {/* ── SPLIT VIEW: EUROPE MAP (LEFT) & CANDIDATURES LIST (RIGHT) ── */}
      <div className="cand-interactive-layout">
        {/* LEFT: WESTERN EUROPE SVG MAP */}
        <div className="cand-map-card">
          <div className="cand-map-card-header">
            <div className="cand-map-title">
              <strong>
                {COUNTRIES.find((c) => c.code === selectedCountry)?.flag}{' '}
                {COUNTRIES.find((c) => c.code === selectedCountry)?.name}
              </strong>
              <small>
                {activeRegionCode
                  ? `Région : ${activeRegionCode}`
                  : activeCityKey
                  ? `Ville : ${activeCityKey.split('---')[1]}`
                  : 'Molette pour zoomer · clic dans le vide pour reculer'}
              </small>
            </div>

            <div className="cand-map-floating-controls">
              <button
                type="button"
                title="Zoomer (+)"
                onClick={() => setManualZoom((z) => Math.min(Number((z + 0.3).toFixed(1)), 3.5))}
              >
                +
              </button>
              <button
                type="button"
                title="Dézoomer (−)"
                onClick={() => setManualZoom((z) => Math.max(Number((z - 0.3).toFixed(1)), 1))}
              >
                −
              </button>
              <button
                type="button"
                title="Vue globale"
                onClick={() => {
                  setSelectedCountry('ALL');
                  setActiveRegionCode(null);
                  setActiveCityKey(null);
                  setManualZoom(1);
                }}
              >
                ⤢
              </button>
            </div>
          </div>

          <div className="cand-svg-container" ref={mapContainerRef}>
            <svg
              viewBox="0 0 1000 980"
              className="cand-europe-svg"
              onClick={(event) => { if (event.target === event.currentTarget) stepBackMap(); }}
              onMouseLeave={() => setTooltip((t) => ({ ...t, visible: false }))}
            >
              <defs>
                <filter id="pin-shadow" x="-30%" y="-30%" width="160%" height="160%">
                  <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor="#0f172a" floodOpacity="0.25" />
                </filter>
                <linearGradient id="regionGradient" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#f8fafc" />
                  <stop offset="100%" stopColor="#f1f5f9" />
                </linearGradient>
              </defs>

              <rect x="0" y="0" width="1000" height="980" fill="transparent" onClick={stepBackMap} />

              <g
                style={{
                  transform: zoomTransform,
                  transformOrigin: '0 0',
                  transition: 'transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
                }}
              >
                {/* 1. Regional Polygons Layer */}
                <g className="europe-regions-layer">
                  {EUROPE_REGIONS_GEO.map((reg) => {
                    const count = regionCounts[`${reg.country}-${reg.code}`] || regionCounts[reg.code] || 0;
                    const isCountryActive = selectedCountry === 'ALL' || selectedCountry === reg.country;
                    const isRegionActive = activeRegionCode === reg.code && selectedCountry === reg.country;

                    return (
                      <path
                        key={reg.id}
                        d={reg.path}
                        className={`cand-region-polygon ${isRegionActive ? 'active' : ''} ${
                          !isCountryActive ? 'dimmed' : ''
                        } ${count > 0 ? 'has-candidatures' : ''} ${count >= 5 ? 'high-density' : ''}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setActiveCityKey(null);
                          setSelectedCountry(reg.country);
                          setActiveRegionCode(isRegionActive ? null : reg.code);
                        }}
                        onMouseEnter={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          setTooltip({
                            visible: true,
                            x: rect.left + rect.width / 2,
                            y: rect.top - 12,
                            title: `${reg.flag} ${reg.name} (${reg.code})`,
                            subtitle: `${count} candidature${count > 1 ? 's' : ''}`,
                          });
                        }}
                      />
                    );
                  })}
                </g>

                {/* 2. Region Labels Layer (Centered coordinates) */}
                <g className="europe-labels-layer" pointerEvents="none">
                  {EUROPE_REGIONS_GEO.map((reg) => {
                    const count = regionCounts[`${reg.country}-${reg.code}`] || regionCounts[reg.code] || 0;
                    const isCountryActive = selectedCountry === 'ALL' || selectedCountry === reg.country;
                    if (!isCountryActive || (selectedCountry === 'ALL' && count === 0)) return null;

                    return (
                      <g key={`lbl-${reg.id}`}>
                        <text x={reg.cx} y={reg.cy - 3} className={`cand-region-count ${count > 0 ? 'active' : 'zero'}`}>
                          {count > 0 ? count : '·'}
                        </text>
                        <text x={reg.cx} y={reg.cy + 9} className="cand-region-code">
                          {reg.code}
                        </text>
                      </g>
                    );
                  })}
                </g>

                {/* 3. Accurate City Pins Layer */}
                <g className="europe-city-pins-layer">
                  {cityPins.map((pin) => {
                    const isCountryActive = selectedCountry === 'ALL' || selectedCountry === pin.country;
                    if (!isCountryActive) return null;
                    const isCityActive = activeCityKey === pin.key;

                    return (
                      <g
                        key={pin.key}
                        className={`cand-city-pin-group ${isCityActive ? 'active' : ''}`}
                        transform={`translate(${pin.x}, ${pin.y})`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedCountry(pin.country);
                          setActiveRegionCode(pin.region);
                          setActiveCityKey(isCityActive ? null : pin.key);
                        }}
                        onMouseEnter={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          const compNames = pin.items.map((i) => i.company).slice(0, 3).join(', ');
                          setTooltip({
                            visible: true,
                            x: rect.left + rect.width / 2,
                            y: rect.top - 16,
                            title: `📍 ${pin.name} (${pin.count})`,
                            subtitle: compNames + (pin.items.length > 3 ? '…' : ''),
                          });
                        }}
                      >
                        <path
                          className="cand-city-pin-marker"
                          d="M0,0 C-6,-8 -10,-14 -10,-19 A10,10 0 1,1 10,-19 C10,-14 6,-8 0,0 Z"
                          filter="url(#pin-shadow)"
                        />
                        <circle cx="0" cy="-19" r="4.5" fill="#ffffff" />
                        <text
                          x="0"
                          y="-18"
                          className="cand-city-pin-label"
                          textAnchor="middle"
                          dominantBaseline="central"
                        >
                          {pin.count > 1 ? pin.count : ''}
                        </text>
                      </g>
                    );
                  })}
                </g>
              </g>
            </svg>
          </div>

          {/* Map Legend */}
          <div className="cand-map-bottom-legend">
            <div className="cand-legend-swatch">
              <span className="swatch-color empty" /> 0
            </div>
            <div className="cand-legend-swatch">
              <span className="swatch-color low" /> 1-2
            </div>
            <div className="cand-legend-swatch">
              <span className="swatch-color med" /> 3-5
            </div>
            <div className="cand-legend-swatch">
              <span className="swatch-color high" /> 6+
            </div>
            <div className="cand-legend-swatch">
              <span className="swatch-color pin" /> Épingle ville
            </div>
            {enrichedCandidatures.some((c) => !c._geo.located) && (
              <div className="cand-legend-swatch">
                {enrichedCandidatures.filter((c) => !c._geo.located).length} ville(s) à préciser
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: CANDIDATURES LIST & ACTIONS */}
        <div className="cand-list-panel">
          {/* Active Filter Chips Bar */}
          <div className="cand-list-header">
            <div>
              <h3>
                {selectedCountry === 'ALL'
                  ? '🌍 Toute l’Europe'
                  : `${COUNTRIES.find((c) => c.code === selectedCountry)?.flag} ${
                      COUNTRIES.find((c) => c.code === selectedCountry)?.name
                    }`}
                {activeRegionCode && <span className="cand-active-subfilter"> › Région {activeRegionCode}</span>}
                {activeCityKey && <span className="cand-active-subfilter"> › {activeCityKey.split('---')[1]}</span>}
              </h3>
              <p>
                {filteredCandidatures.length} candidature{filteredCandidatures.length > 1 ? 's' : ''} affichée
                {filteredCandidatures.length > 1 ? 's' : ''}
              </p>
            </div>

            {(selectedCountry !== 'ALL' || activeRegionCode || activeCityKey || filterStatus !== 'all' || searchQuery) && (
              <button
                type="button"
                className="sh-link-btn"
                onClick={() => {
                  setSelectedCountry('ALL');
                  setActiveRegionCode(null);
                  setActiveCityKey(null);
                  setFilterStatus('all');
                  setSearchQuery('');
                  setManualZoom(1);
                }}
              >
                Réinitialiser
              </button>
            )}
          </div>

          {/* Urgent Relance Banner */}
          {urgentList.length > 0 && filterStatus !== 'urgent' && (
            <div className="cand-urgent-box">
              <div className="cand-urgent-head">
                <span className="urgent-badge">🚨 ACTIONS REQUISES ({urgentList.length})</span>
                <small>Plus de 10 jours sans réponse</small>
              </div>
              <div className="cand-urgent-items">
                {urgentList.slice(0, 3).map((u) => (
                  <div key={u.id} className="cand-urgent-card">
                    <div>
                      <strong>{u.company}</strong>
                      <span>
                        Attente depuis <strong className="text-red">{u._waitingDays} jours</strong> ({u.location || u._country})
                      </span>
                    </div>
                    {u.contact_email ? (
                      <a
                        href={`mailto:${u.contact_email}?subject=Relance candidature - ${encodeURIComponent(u.company)}`}
                        className="cand-urgent-action-btn"
                      >
                        Relancer ✉️
                      </a>
                    ) : (
                      <a
                        href={`https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(u.company)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="cand-urgent-action-btn linkedin"
                      >
                        LinkedIn 💼
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Cards List */}
          {filteredCandidatures.length > 0 ? (
            <div className="cand-cards-stack">
              {filteredCandidatures.map((c) => (
                <CandidatureCardNative
                  key={c.id}
                  candidature={c}
                  onEdit={() => setEditingCandidature(c)}
                  onStatusChange={(newStatus) => handleStatusChange(c.id, newStatus)}
                  onAddNote={() => setNoteTargetCandidature(c)}
                  onDelete={() => onDeleteCandidature && onDeleteCandidature(c.id)}
                />
              ))}
            </div>
          ) : (
            <div className="cand-empty-card">
              <span className="cand-empty-icon">📍</span>
              <h4>Aucune candidature dans cette sélection</h4>
              <p>
                Déplace-toi sur un autre pays ou clique sur le bouton pour enregistrer une nouvelle démarche.
              </p>
              <button
                type="button"
                className="sh-btn-primary"
                onClick={() => {
                  setEditingCandidature(null);
                  setShowAddModal(true);
                }}
              >
                ➕ Ajouter une candidature
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── TOOLTIP COMPONENT ── */}
      {tooltip.visible && (
        <div
          className="cand-floating-tooltip"
          style={{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }}
        >
          <div className="tooltip-title">{tooltip.title}</div>
          {tooltip.subtitle && <div className="tooltip-sub">{tooltip.subtitle}</div>}
        </div>
      )}

      {/* ── ADD / EDIT CANDIDATURE MODAL ── */}
      {showAddModal && (
        <AddCandidatureModal
          prefill={prefillFromOffer}
          busy={busy}
          onClose={() => {
            setShowAddModal(false);
            if (onClearPrefill) onClearPrefill();
          }}
          onSave={async (data) => {
            const saved = !onSaveCandidature || await onSaveCandidature(data);
            if (saved) {
              setShowAddModal(false);
              if (onClearPrefill) onClearPrefill();
            }
            return saved;
          }}
        />
      )}

      {editingCandidature && (
        <AddCandidatureModal
          prefill={editingCandidature}
          busy={busy}
          onClose={() => setEditingCandidature(null)}
          onSave={async (data) => {
            const saved = !onSaveCandidature || await onSaveCandidature({ ...data, id: editingCandidature.id });
            if (saved) {
              setEditingCandidature(null);
            }
            return saved;
          }}
        />
      )}

      {/* ── NOTE / MÉMO POST-IT MODAL ── */}
      {noteTargetCandidature && (
        <AddNoteModal
          candidature={noteTargetCandidature}
          busy={busy}
          onClose={() => setNoteTargetCandidature(null)}
          onSave={(candId, note) => {
            if (onAddNote) onAddNote(candId, note);
            setNoteTargetCandidature(null);
          }}
        />
      )}

      {/* ── GMAIL AUTO-SCAN MODAL ── */}
      {showGmailModal && (
        <div className="sh-modal-backdrop" onClick={() => setShowGmailModal(false)}>
          <div className="sh-modal-card gmail-scan-modal" onClick={(e) => e.stopPropagation()}>
            <div className="sh-modal-header">
              <div className="sh-modal-title">
                <span className="sh-modal-icon">📬</span>
                <div>
                  <h3>Synchronisation Gmail</h3>
                  <p>Détection intelligente des réponses RH et invitations d'entretien</p>
                </div>
              </div>
              <button className="sh-modal-close" onClick={() => setShowGmailModal(false)}>
                <Icon name="x" size={18} />
              </button>
            </div>

            <div className="gmail-scan-body">
              {gmailScanning ? (
                <div className="gmail-scanning-state">
                  <div className="sh-spinner lg" />
                  <h4>Analyse de ta boîte de réception en cours…</h4>
                  <p>Recherche des emails récents contenant des réponses à tes candidatures.</p>
                </div>
              ) : (
                <>
                  <div className="gmail-summary-notice">
                    {gmailNotice}
                  </div>

                  {gmailScanResults?.updates && gmailScanResults.updates.length > 0 ? (
                    <div className="gmail-updates-list">
                      <h4>Mises à jour suggérées ({gmailScanResults.updates.length})</h4>
                      {gmailScanResults.updates.map((upd, idx) => (
                        <div key={idx} className="gmail-update-item">
                          <div className="gmail-item-left">
                            <strong>{upd.company}</strong>
                            <div className="gmail-item-snippet">
                              <em>"{upd.snippet.slice(0, 140)}…"</em>
                            </div>
                            <small className="gmail-item-meta">
                              De : {upd.emailFrom} • Objet : {upd.emailSubject}
                            </small>
                          </div>
                          <div className="gmail-item-right">
                            <span className={`cand-badge b-${upd.detectedStatus.toLowerCase().replace(/\s+/g, '')}`}>
                              {upd.detectedStatus}
                            </span>
                            <button
                              type="button"
                              className="sh-btn-primary sm"
                              onClick={() => applyGmailUpdate(upd)}
                            >
                              Appliquer ✓
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="gmail-no-matches">
                      <p>Aucune nouvelle réponse n'a été détectée dans les 30 derniers emails.</p>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="sh-modal-actions">
              <button
                type="button"
                className="sh-btn-secondary"
                onClick={() => setShowGmailModal(false)}
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── NATIVE STAGE HUNTER CANDIDATURE CARD COMPONENT ──
function CandidatureCardNative({ candidature, onEdit, onStatusChange, onAddNote, onDelete }) {
  const [showDrawer, setShowDrawer] = useState(false);
  const [copied, setCopied] = useState(false);

  const status = candidature.status || 'Demande initiale';
  const sLow = status.toLowerCase();

  const badgeClass = useMemo(() => {
    if (sLow.includes('refus') || sLow.includes('rejet')) return 'badge-refus';
    if (sLow.includes('accept') || sLow.includes('valid') || sLow.includes('offre')) return 'badge-valide';
    if (sLow.includes('entretien')) return 'badge-entretien';
    if (sLow.includes('réponse') || sLow.includes('reponse')) return 'badge-reponse';
    return 'badge-envoi';
  }, [sLow]);

  const stepIndex = useMemo(() => {
    if (sLow.includes('refus')) return { step: 3, isRefused: true };
    if (sLow.includes('accept') || sLow.includes('valid') || sLow.includes('offre')) return { step: 3, isDone: true };
    if (sLow.includes('entretien')) return { step: 2 };
    if (sLow.includes('réponse') || sLow.includes('reponse')) return { step: 1 };
    return { step: 0 };
  }, [sLow]);

  const copyCompanyName = () => {
    navigator.clipboard.writeText(candidature.company);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isUrgent = (sLow.includes('initiale') || sLow.includes('envoy') || !candidature.status) && candidature._waitingDays >= 10;

  return (
    <article className={`cand-native-card ${isUrgent ? 'card-urgent' : ''}`}>
      {/* Top Header: Company Avatar + Name + Badges */}
      <div className="cand-card-header-row">
        <div className="cand-card-left-group" onClick={onEdit} title="Modifier la fiche">
          <div
            className="cand-company-avatar"
            style={{ background: getAvatarGradient(candidature.company) }}
          >
            {String(candidature.company || 'SH').slice(0, 2).toUpperCase()}
          </div>
          <div>
            <h4 className="cand-card-title">{candidature.company}</h4>
            <div className="cand-card-geo-tags">
              <span className="cand-tag country-tag">
                {candidature._country === 'CH' ? '🇨🇭 CH' :
                 candidature._country === 'FR' ? '🇫🇷 FR' :
                 candidature._country === 'DE' ? '🇩🇪 DE' :
                 candidature._country === 'BE' ? '🇧🇪 BE' :
                 candidature._country === 'LU' ? '🇱🇺 LU' :
                 candidature._country === 'IT' ? '🇮🇹 IT' :
                 candidature._country === 'ES' ? '🇪🇸 ES' : '🇪🇺'} {candidature._region}
              </span>
              {candidature.location && (
                <span className="cand-tag city-tag">
                  <Icon name="pin" size={11} /> {candidature.location}
                </span>
              )}
              {candidature.sector && (
                <span className="cand-tag sector-tag">{candidature.sector}</span>
              )}
            </div>
          </div>
        </div>

        <div className="cand-card-right-group">
          <span className={`cand-status-pill ${badgeClass}`}>{status}</span>
          {candidature.rating > 0 && (
            <span className="cand-score-pill">
              ⭐ {candidature.rating}/10
            </span>
          )}
        </div>
      </div>

      {/* Progress Stepper */}
      <div className="cand-native-stepper">
        <div className={`cand-stepper-node ${stepIndex.step >= 0 ? (stepIndex.step > 0 ? 'passed' : 'current') : ''}`}>
          <div className="cand-node-bullet" />
          <span>Envoyé</span>
        </div>
        <div className={`cand-stepper-node ${stepIndex.step >= 1 ? (stepIndex.step > 1 ? 'passed' : 'current') : ''}`}>
          <div className="cand-node-bullet" />
          <span>Retour</span>
        </div>
        <div className={`cand-stepper-node ${stepIndex.step >= 2 ? (stepIndex.step > 2 ? 'passed' : 'current') : ''}`}>
          <div className="cand-node-bullet" />
          <span>Entretien</span>
        </div>
        <div className={`cand-stepper-node ${stepIndex.step >= 3 ? (stepIndex.isRefused ? 'refused' : 'passed') : ''}`}>
          <div className="cand-node-bullet" />
          <span>{stepIndex.isRefused ? 'Refus' : 'Offre'}</span>
        </div>
      </div>

      {/* Waiting Days Alert */}
      <div className="cand-waiting-row">
        <span className={`cand-waiting-badge ${isUrgent ? 'urgent' : ''}`}>
          ⏱️ {candidature._waitingDays === 0 ? "Envoyé aujourd'hui" : `Il y a ${candidature._waitingDays} jour${candidature._waitingDays > 1 ? 's' : ''}`}
          {isUrgent && ' — Relance recommandée !'}
        </span>
      </div>

      {/* Detailed Activity Snippet */}
      {candidature.detailed_activity && (
        <p className="cand-card-description">{candidature.detailed_activity}</p>
      )}

      {/* Links Bar */}
      <div className="cand-card-links-row">
        {candidature.link1 && (
          <a href={candidature.link1} target="_blank" rel="noopener noreferrer" className="cand-card-link-chip">
            <Icon name="external" size={12} />
            <span>Offre</span>
          </a>
        )}
        {candidature.link2 && (
          <a href={candidature.link2} target="_blank" rel="noopener noreferrer" className="cand-card-link-chip">
            <Icon name="external" size={12} />
            <span>RH / Site</span>
          </a>
        )}
        {candidature.link3 && (
          <a href={candidature.link3} target="_blank" rel="noopener noreferrer" className="cand-card-link-chip">
            <Icon name="external" size={12} />
            <span>Lien 3</span>
          </a>
        )}
      </div>

      {/* Controls & Quick Actions */}
      <div className="cand-card-actions-bar">
        <div className="cand-actions-left">
          <select
            className="cand-status-quick-select"
            value={status}
            onChange={(e) => onStatusChange(e.target.value)}
          >
            <option value="Demande initiale">Demande initiale (Envoyé)</option>
            <option value="Réponse obtenue">Réponse obtenue</option>
            <option value="Entretien">Entretien</option>
            <option value="Validé">Validé / Offre</option>
            <option value="Refusé">Refusé</option>
          </select>
        </div>

        <div className="cand-actions-right">
          <button
            type="button"
            className="cand-tool-btn"
            onClick={copyCompanyName}
            title="Copier le nom"
          >
            {copied ? '✓ Copié' : '📋 Copier'}
          </button>

          <a
            href={`https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(candidature.company)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="cand-tool-btn"
            title="Chercher sur LinkedIn"
          >
            💼 LinkedIn
          </a>

          {candidature.contact_email && (
            <a
              href={`mailto:${candidature.contact_email}?subject=Candidature - ${encodeURIComponent(candidature.company)}`}
              className="cand-tool-btn email"
              title="Envoyer un email"
            >
              ✉️ Email
            </a>
          )}

          <button
            type="button"
            className="cand-tool-btn note"
            onClick={onAddNote}
            title="Ajouter un mémo Post-it"
          >
            📝 Mémo
          </button>

          <button
            type="button"
            className="cand-tool-btn drawer-toggle"
            onClick={() => setShowDrawer(!showDrawer)}
          >
            {showDrawer ? 'Masquer' : `Détails (${(candidature.notes || []).length})`}
          </button>

          <button
            type="button"
            className="cand-tool-btn delete"
            onClick={onDelete}
            title="Supprimer la candidature"
          >
            🗑️
          </button>
        </div>
      </div>

      {/* Expandable Mémos & History Drawer */}
      {showDrawer && (
        <div className="cand-native-drawer">
          {/* Post-it Notes Section */}
          <div className="cand-drawer-notes">
            <div className="drawer-header">
              <h5>📝 Mémos Post-it ({(candidature.notes || []).length})</h5>
              <button type="button" className="drawer-add-note-btn" onClick={onAddNote}>
                + Nouveau mémo
              </button>
            </div>

            {(candidature.notes || []).length > 0 ? (
              <div className="cand-notes-grid">
                {candidature.notes.map((n, idx) => (
                  <div key={idx} className="cand-postit-card">
                    <span className="postit-date">{n.date || 'Mémo'}</span>
                    <p className="postit-text">{n.text || n}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="cand-no-notes-text">Aucun mémo pour le moment.</p>
            )}
          </div>

          {/* Status History Timeline */}
          {(candidature.status_history || []).length > 0 && (
            <div className="cand-drawer-history">
              <h5>⏱️ Historique des statuts</h5>
              <div className="cand-history-track">
                {candidature.status_history.map((sh, idx) => (
                  <div key={idx} className="cand-history-item">
                    <div className="cand-history-item-dot" />
                    <div>
                      <span className="cand-history-item-date">{sh.date || 'Date'}</span>
                      <p className="cand-history-item-text">{sh.text || sh.status}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

export default CandidaturesView;
