import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Icon } from '../Common/Icons';
import { SWISS_CANTONS, projectGps } from './swissCantons';
import { SWISS_CITIES } from './swissCities';
import { AddCandidatureModal } from './AddCandidatureModal';
import { AddNoteModal } from './AddNoteModal';

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

function formatDelta(days) {
  if (days <= 0) return 'Le même jour';
  if (days === 1) return '+1 jour';
  return `+${days} jours`;
}

function getCityOffset(cityName) {
  const lower = cityName.toLowerCase().trim();
  if (lower.includes('zurich') || lower.includes('zürich')) return { dx: -5, dy: -12 };
  if (lower.includes('winterthur')) return { dx: 22, dy: -20 };
  if (lower.includes('geneve') || lower.includes('genève')) return { dx: -15, dy: 8 };
  if (lower.includes('lausanne')) return { dx: -12, dy: 14 };
  if (lower.includes('yverdon')) return { dx: -22, dy: -12 };
  if (lower.includes('berne') || lower.includes('bern')) return { dx: -5, dy: -15 };
  if (lower.includes('bienne') || lower.includes('biel')) return { dx: -22, dy: -32 };
  if (lower.includes('bâle') || lower.includes('basel')) return { dx: -2, dy: -5 };
  if (lower.includes('lugano')) return { dx: 5, dy: 22 };
  if (lower.includes('lucerne') || lower.includes('luzern')) return { dx: -5, dy: -5 };

  let hash = 0;
  for (let i = 0; i < cityName.length; i++) {
    hash = cityName.charCodeAt(i) + ((hash << 5) - hash);
  }
  const dx = (Math.abs(hash) % 26) - 13;
  const dy = (Math.abs(hash >> 3) % 26) - 13;
  return { dx, dy };
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
  const [activeCode, setActiveCode] = useState(null);
  const [activeCityKey, setActiveCityKey] = useState(null);
  const [viewMode, setViewMode] = useState('map'); // 'map' | 'kanban'
  const [filterStatus, setFilterStatus] = useState('all'); // all | envoi | entretien | accepte | refus
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState('recent'); // recent | note | urgent
  const [showAddModal, setShowAddModal] = useState(!!prefillFromOffer);
  const [editingCandidature, setEditingCandidature] = useState(null);
  const [noteTargetCandidature, setNoteTargetCandidature] = useState(null);
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, text: '' });
  const [manualZoom, setManualZoom] = useState(1);
  const [lastUpdated, setLastUpdated] = useState(() => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  });

  useEffect(() => {
    if (prefillFromOffer) setShowAddModal(true);
  }, [prefillFromOffer]);

  // Reset manual zoom when selection clears
  useEffect(() => {
    if (!activeCode && !activeCityKey) {
      setManualZoom(1);
    }
  }, [activeCode, activeCityKey]);

  // Compute counts per canton
  const cantonCounts = useMemo(() => {
    const counts = {};
    candidatures.forEach((c) => {
      const code = String(c.canton || '').toUpperCase();
      const m = code.match(/\|?\s*([A-Z]{2})\s*\|?/) || code.match(/\b([A-Z]{2})\b/);
      const iso = m ? m[1] : code.slice(0, 2);
      if (iso) counts[iso] = (counts[iso] || 0) + 1;
    });
    return counts;
  }, [candidatures]);

  // Funnel counts
  const funnel = useMemo(() => {
    const total = candidatures.length;
    const replies = candidatures.filter((d) => {
      const s = String(d.status || '').toLowerCase();
      return !s.includes('initiale') && !s.includes('envoy') && s !== '';
    }).length;
    const interviews = candidatures.filter((d) => {
      const s = String(d.status || '').toLowerCase();
      return s.includes('entretien') || s.includes('accept') || s.includes('valid') || s.includes('offre');
    }).length;
    const offers = candidatures.filter((d) => {
      const s = String(d.status || '').toLowerCase();
      return s.includes('accept') || s.includes('valid') || s.includes('offre');
    }).length;
    return { total, replies, interviews, offers };
  }, [candidatures]);

  // City pins coordinates
  const cityPins = useMemo(() => {
    const map = new Map();
    candidatures.forEach((c) => {
      const cityName = String(c.location || '').trim();
      if (!cityName) return;
      const code = String(c.canton || '').slice(0, 2).toUpperCase();
      const key = `${code}---${normalizeString(cityName)}`;

      if (!map.has(key)) {
        map.set(key, { key, name: cityName, canton: code, count: 0, items: [] });
      }
      const entry = map.get(key);
      entry.count += 1;
      entry.items.push(c);
    });

    const pins = [];
    const normalizedCities = {};
    Object.entries(SWISS_CITIES).forEach(([k, v]) => {
      normalizedCities[normalizeString(k)] = v;
    });

    map.forEach((item) => {
      const norm = normalizeString(item.name);
      const coords = normalizedCities[norm];
      let pos = null;
      if (coords) {
        pos = projectGps(coords.lat, coords.lng);
      }
      if (!pos) {
        const cantonData = SWISS_CANTONS.find((ct) => ct.code === item.canton);
        if (cantonData && cantonData.centroid) {
          const offset = getCityOffset(item.name);
          pos = { x: cantonData.centroid[0] + offset.dx, y: cantonData.centroid[1] + offset.dy };
        }
      }
      if (pos) {
        pins.push({ ...item, x: pos.x, y: pos.y });
      }
    });

    return pins;
  }, [candidatures]);

  // Compute zoom transform based on active canton, active city pin, or manual zoom
  const zoomTransform = useMemo(() => {
    let scale = manualZoom;
    let cx = 400;
    let cy = 250;

    if (activeCityKey) {
      const pin = cityPins.find((p) => p.key === activeCityKey);
      if (pin) {
        cx = pin.x;
        cy = pin.y;
        scale = Math.max(scale, 2.3);
      }
    } else if (activeCode) {
      const canton = SWISS_CANTONS.find((c) => c.code === activeCode);
      if (canton && canton.centroid) {
        cx = canton.centroid[0];
        cy = canton.centroid[1];
        scale = Math.max(scale, 1.85);
      }
    }

    if (scale <= 1) return 'translate(0px, 0px) scale(1)';

    const dx = Math.max(-800 * (scale - 1), Math.min(0, 400 - cx * scale));
    const dy = Math.max(-500 * (scale - 1), Math.min(0, 250 - cy * scale));
    return `translate(${dx}px, ${dy}px) scale(${scale})`;
  }, [activeCode, activeCityKey, cityPins, manualZoom]);

  // Filtered & sorted candidatures
  const filteredCandidatures = useMemo(() => {
    let list = candidatures.filter((d) => {
      // 1. Canton / City filter
      if (activeCode) {
        const cCode = String(d.canton || '').toUpperCase();
        if (!cCode.includes(activeCode)) return false;
      }
      if (activeCityKey) {
        const cKey = `${String(d.canton || '').slice(0, 2).toUpperCase()}---${normalizeString(d.location || '')}`;
        if (cKey !== activeCityKey) return false;
      }

      // 2. Status pill filter
      const s = String(d.status || '').toLowerCase();
      if (filterStatus === 'envoi' && !(s.includes('envoy') || s.includes('initiale') || s === '')) return false;
      if (filterStatus === 'entretien' && !s.includes('entretien')) return false;
      if (filterStatus === 'accepte' && !(s.includes('accept') || s.includes('offre') || s.includes('valid'))) return false;
      if (filterStatus === 'refus' && !(s.includes('refus') || s.includes('rejet'))) return false;

      // 3. Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const text = `${d.company} ${d.location} ${d.canton} ${d.sector} ${d.detailed_activity} ${d.demarche}`.toLowerCase();
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
        const sA = String(a.status || '').toLowerCase();
        const sB = String(b.status || '').toLowerCase();
        const isAInit = sA.includes('initiale') || sA.includes('envoy') || sA === '';
        const isBInit = sB.includes('initiale') || sB.includes('envoy') || sB === '';
        const dateA = parseCustomDate(a.created_at) || now;
        const dateB = parseCustomDate(b.created_at) || now;
        if (isAInit && !isBInit) return -1;
        if (!isAInit && isBInit) return 1;
        if (isAInit && isBInit) return dateA - dateB; // Oldest waiting first
      }
      // 'recent' by default
      const dateA = parseCustomDate(a.created_at) || new Date(0);
      const dateB = parseCustomDate(b.created_at) || new Date(0);
      return dateB - dateA;
    });

    return list;
  }, [candidatures, activeCode, activeCityKey, filterStatus, searchQuery, sortOrder]);

  // Urgent relance list (>= 10 days in initial status)
  const urgentList = useMemo(() => {
    const now = new Date();
    return candidatures.filter((c) => {
      const s = String(c.status || '').toLowerCase();
      const isInitial = s.includes('initiale') || s.includes('envoy') || s === '';
      if (!isInitial) return false;
      const d = parseCustomDate(c.created_at);
      if (!d) return false;
      const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
      c._diffDays = diffDays;
      return diffDays >= 10;
    }).sort((a, b) => b._diffDays - a._diffDays);
  }, [candidatures]);

  // Helper for canton level styling
  const getCantonLevelClass = (count) => {
    if (!count || count === 0) return '';
    if (count === 1) return 'lv1';
    if (count <= 3) return 'lv2';
    if (count <= 6) return 'lv3';
    return 'lv4';
  };

  // Drag and Drop for Kanban
  const handleDragStart = (e, candidature) => {
    e.dataTransfer.setData('text/plain', candidature.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDrop = (e, newStatus) => {
    e.preventDefault();
    const candId = e.dataTransfer.getData('text/plain');
    if (!candId) return;
    if (onUpdateStatus) {
      onUpdateStatus(candId, newStatus);
    }
  };

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

  return (
    <div className="sh-view candidatures-view">
      {/* ── TOP FUNNEL BAR ── */}
      <div className="cand-funnel-wrapper">
        <div className="cand-funnel-container">
          <div className="cand-funnel-step active">
            <span className="cand-funnel-val">{funnel.total}</span>
            <span>Envoyés</span>
          </div>
          <div className={`cand-funnel-step ${funnel.replies > 0 ? 'active' : ''}`}>
            <span className="cand-funnel-val">{funnel.replies}</span>
            <span>Retours</span>
          </div>
          <div className={`cand-funnel-step ${funnel.interviews > 0 ? 'active' : ''}`}>
            <span className="cand-funnel-val">{funnel.interviews}</span>
            <span>Entretiens</span>
          </div>
          <div className={`cand-funnel-step ${funnel.offers > 0 ? 'active' : ''}`}>
            <span className="cand-funnel-val">{funnel.offers}</span>
            <span>Offres</span>
          </div>
        </div>
      </div>

      {/* ── TOP ACTION / REFRESH BAR ── */}
      <div className="cand-refresh-bar">
        <div className="cand-refresh-left">
          <span className="cand-last-update">Mis à jour à {lastUpdated}</span>
          {activeCode && (
            <span className="cand-filter-tag" onClick={() => { setActiveCode(null); setActiveCityKey(null); }}>
              Canton: <strong>{activeCode}</strong> <button>×</button>
            </span>
          )}
          {activeCityKey && (
            <span className="cand-filter-tag" onClick={() => setActiveCityKey(null)}>
              Ville: <strong>{activeCityKey.split('---')[1]}</strong> <button>×</button>
            </span>
          )}
        </div>

        <div className="cand-refresh-actions">
          <button
            type="button"
            className="cand-btn-refresh"
            onClick={handleRefresh}
            disabled={busy}
            title="Rafraîchir les données"
          >
            <Icon name="refresh" size={14} />
            <span>Actualiser</span>
          </button>

          {googleConnected && onSyncGoogleSheets && (
            <button
              type="button"
              className="cand-btn-sheet"
              onClick={onSyncGoogleSheets}
              disabled={busy}
              title="Synchroniser vers Google Sheets (Opportunités + Candidatures)"
            >
              <Icon name="external" size={14} />
              <span>Sync Sheets</span>
            </button>
          )}

          {googleConnected && onPullGoogleSheets && (
            <button
              type="button"
              className="cand-btn-sheet secondary"
              onClick={onPullGoogleSheets}
              disabled={busy}
              title="Importer les réponses depuis Google Sheets"
            >
              <Icon name="download" size={14} />
              <span>Importer Sheet</span>
            </button>
          )}
        </div>
      </div>

      {/* ── FILTER & SEARCH TOOLBAR ── */}
      <div className="cand-toolbar">
        <div className="cand-toolbar-top">
          <div className="cand-search-group">
            <div className="cand-search-box">
              <Icon name="search" size={16} />
              <input
                type="text"
                placeholder="🔍 Rechercher (entreprise, ville, secteur, démarches)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button className="cand-clear-btn" onClick={() => setSearchQuery('')}>
                  <Icon name="x" size={14} />
                </button>
              )}
            </div>

            <select
              className="cand-sort-select"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
            >
              <option value="recent">⏱️ Plus récentes</option>
              <option value="note">⭐ Mieux notées</option>
              <option value="urgent">🚨 Urgences (&gt; 10j)</option>
            </select>
          </div>

          <div className="cand-toolbar-buttons">
            <button
              className="cand-btn-add"
              onClick={() => { setEditingCandidature(null); setShowAddModal(true); }}
            >
              <span>➕</span>
              <span>Saisir un stage</span>
            </button>

            <button
              className={`cand-toggle-view ${viewMode === 'kanban' ? 'active' : ''}`}
              onClick={() => setViewMode(viewMode === 'map' ? 'kanban' : 'map')}
            >
              <Icon name={viewMode === 'map' ? 'columns' : 'map'} size={15} />
              <span>{viewMode === 'map' ? 'Vue Kanban' : 'Vue Carte'}</span>
            </button>
          </div>
        </div>

        <div className="cand-pills">
          <button
            className={`cand-pill ${filterStatus === 'all' ? 'active' : ''}`}
            onClick={() => setFilterStatus('all')}
          >
            Tout ({candidatures.length})
          </button>
          <button
            className={`cand-pill ${filterStatus === 'envoi' ? 'active' : ''}`}
            onClick={() => setFilterStatus('envoi')}
          >
            🔥 À relancer ({candidatures.filter((c) => String(c.status || '').includes('initiale') || String(c.status || '').includes('envoy') || !c.status).length})
          </button>
          <button
            className={`cand-pill ${filterStatus === 'entretien' ? 'active' : ''}`}
            onClick={() => setFilterStatus('entretien')}
          >
            💬 Entretiens ({candidatures.filter((c) => String(c.status || '').includes('entretien')).length})
          </button>
          <button
            className={`cand-pill ${filterStatus === 'accepte' ? 'active' : ''}`}
            onClick={() => setFilterStatus('accepte')}
          >
            ✅ Acceptés ({candidatures.filter((c) => String(c.status || '').includes('valid') || String(c.status || '').includes('accept')).length})
          </button>
          <button
            className={`cand-pill ${filterStatus === 'refus' ? 'active' : ''}`}
            onClick={() => setFilterStatus('refus')}
          >
            ❌ Refus ({candidatures.filter((c) => String(c.status || '').includes('refus')).length})
          </button>
        </div>
      </div>

      {/* ── MAIN CONTENT (MAP OR KANBAN) ── */}
      <div className="cand-main-wrapper">
        {viewMode === 'kanban' ? (
          /* ── KANBAN VIEW ── */
          <div className="cand-kanban-board">
            {[
              { id: 'envoi', title: 'À Relancer / Envoyé', color: '#818cf8', dropStatus: 'Demande initiale' },
              { id: 'reponse', title: 'Réponse Obtenue', color: '#10b981', dropStatus: 'Réponse obtenue' },
              { id: 'entretien', title: 'Entretiens', color: '#34d399', dropStatus: 'Entretien' },
              { id: 'accepte', title: 'Accepté / Offre', color: '#6ee7b7', dropStatus: 'Validé' },
              { id: 'refus', title: 'Refusé', color: '#f87171', dropStatus: 'Refusé' },
            ].map((col) => {
              const colItems = filteredCandidatures.filter((d) => {
                const s = String(d.status || '').toLowerCase();
                if (col.id === 'refus') return s.includes('refus') || s.includes('rejet');
                if (col.id === 'accepte') return s.includes('accept') || s.includes('valid') || s.includes('offre');
                if (col.id === 'entretien') return s.includes('entretien');
                if (col.id === 'reponse') return s.includes('réponse') || s.includes('reponse');
                return s.includes('initiale') || s.includes('envoy') || s === '';
              });

              return (
                <div
                  key={col.id}
                  className="cand-kanban-col"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleDrop(e, col.dropStatus)}
                >
                  <div className="cand-kanban-header">
                    <span style={{ color: col.color }}>{col.title}</span>
                    <span className="cand-col-badge">{colItems.length}</span>
                  </div>

                  <div className="cand-kanban-cards">
                    {colItems.map((j) => (
                      <div
                        key={j.id}
                        className="cand-k-card"
                        draggable="true"
                        onDragStart={(e) => handleDragStart(e, j)}
                        onClick={() => setEditingCandidature(j)}
                      >
                        <div className="cand-k-title">{j.company}</div>
                        <div className="cand-k-meta">
                          <span>{j.location || 'Suisse'}</span>
                          <span className="cand-k-code">{j.canton || 'CH'}</span>
                        </div>
                        {j.rating > 0 && (
                          <div className="cand-k-rating">
                            {'★'.repeat(Math.min(5, Math.round(j.rating / 2)))}
                            <small>{j.rating}/10</small>
                          </div>
                        )}
                        <div className="cand-k-actions">
                          <button
                            type="button"
                            className="cand-k-note-btn"
                            onClick={(e) => { e.stopPropagation(); setNoteTargetCandidature(j); }}
                            title="Ajouter un mémo"
                          >
                            📝 Note
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* ── MAP & DETAILS SPLIT LAYOUT ── */
          <div className="cand-split-layout">
            {/* LEFT: SVG SWISS MAP */}
            <div className="cand-map-section">
              {/* Map Floating Zoom Controls */}
              <div className="cand-map-controls">
                <button
                  type="button"
                  title="Zoomer (+)"
                  onClick={() => setManualZoom((z) => Math.min(Number((z + 0.3).toFixed(1)), 3.2))}
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
                    setActiveCode(null);
                    setActiveCityKey(null);
                    setManualZoom(1);
                  }}
                >
                  ⤢
                </button>
              </div>

              <svg viewBox="0 0 800 500" className="cand-svg-map">
                <g
                  className="cand-map-zoom-group"
                  style={{
                    transform: zoomTransform,
                    transformOrigin: '0 0',
                    transition: 'transform 0.55s cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                >
                  {/* Canton Polygons */}
                  <g className="cantons-layer">
                    {SWISS_CANTONS.map((canton) => {
                      const count = cantonCounts[canton.code] || 0;
                      const isActive = activeCode === canton.code;
                      const lvl = getCantonLevelClass(count);

                      return (
                        <path
                          key={canton.code}
                          d={canton.d}
                          className={`cand-canton ${lvl} ${isActive ? 'active' : ''}`}
                          onClick={() => {
                            setActiveCityKey(null);
                            setActiveCode(isActive ? null : canton.code);
                          }}
                        >
                          <title>{canton.name} ({count} candidatures)</title>
                        </path>
                      );
                    })}
                  </g>

                  {/* Canton Labels & Counts */}
                  <g className="canton-labels-layer">
                    {SWISS_CANTONS.map((canton) => {
                      const count = cantonCounts[canton.code] || 0;
                      const cx = canton.centroid[0];
                      const cy = canton.centroid[1];

                      return (
                        <g key={`lbl-${canton.code}`} pointerEvents="none">
                          <text
                            x={cx}
                            y={cy - 5}
                            className={`cand-ct-num ${count === 0 ? 'zero' : ''}`}
                          >
                            {count > 0 ? count : '·'}
                          </text>
                          <text
                            x={cx}
                            y={cy + 8}
                            className="cand-ct-lbl"
                          >
                            {canton.code}
                          </text>
                        </g>
                      );
                    })}
                  </g>

                  {/* City Pins Layer */}
                  <g className="city-pins-layer">
                    {cityPins.map((pin) => {
                      const isCityActive = activeCityKey === pin.key;
                      return (
                        <g
                          key={pin.key}
                          className={`cand-city-pin ${isCityActive ? 'active' : ''}`}
                          transform={`translate(${pin.x}, ${pin.y})`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveCode(pin.canton);
                            setActiveCityKey(isCityActive ? null : pin.key);
                          }}
                          onMouseEnter={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setTooltip({
                              visible: true,
                              x: rect.left + rect.width / 2,
                              y: rect.top - 8,
                              text: `${pin.name} (${pin.count})`,
                            });
                          }}
                          onMouseLeave={() => setTooltip((t) => ({ ...t, visible: false }))}
                        >
                          <path
                            className="cand-pin-shape"
                            d="M0,0 C-5,-6 -8,-11 -8,-15 A8,8 0 1,1 8,-15 C8,-11 5,-6 0,0 Z"
                            fill="#d4233a"
                            stroke="#181c25"
                            strokeWidth="1.5"
                          />
                          <text
                            x="0"
                            y="-13"
                            fill="#ffffff"
                            fontSize="9"
                            fontWeight="700"
                            textAnchor="middle"
                            dominantBaseline="central"
                            pointerEvents="none"
                          >
                            {pin.count}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                </g>
              </svg>

              {/* Legend */}
              <div className="cand-map-legend">
                <div className="cand-legend-item"><div className="cand-legend-sw" style={{ background: '#205a8d' }} />1</div>
                <div className="cand-legend-item"><div className="cand-legend-sw" style={{ background: '#2681d4' }} />2–3</div>
                <div className="cand-legend-item"><div className="cand-legend-sw" style={{ background: '#48a6fa' }} />4–6</div>
                <div className="cand-legend-item"><div className="cand-legend-sw" style={{ background: '#8cc8ff' }} />7+</div>
              </div>
            </div>

            {/* RIGHT: CANDIDATURES DETAILS LIST */}
            <div className="cand-detail-section">
              {/* Header */}
              <div className="cand-detail-header">
                <div>
                  <h2 className="cand-detail-title">
                    <span className="cand-code-badge">{activeCode || 'ALL'}</span>
                    <span>{activeCode ? SWISS_CANTONS.find((c) => c.code === activeCode)?.name || activeCode : 'Toutes les demandes'}</span>
                  </h2>
                  <p className="cand-detail-sub">
                    {filteredCandidatures.length} candidature{filteredCandidatures.length > 1 ? 's' : ''} au total
                  </p>
                </div>
                {(activeCode || activeCityKey) && (
                  <button
                    className="cand-reset-btn"
                    onClick={() => { setActiveCode(null); setActiveCityKey(null); }}
                  >
                    Voir tout
                  </button>
                )}
              </div>

              {/* Urgent Action Banner */}
              {urgentList.length > 0 && !activeCode && (
                <div className="cand-urgent-banner">
                  <div className="cand-urgent-title">
                    <span>⚡ ACTIONS REQUISES ({urgentList.length})</span>
                  </div>
                  <div className="cand-urgent-list">
                    {urgentList.slice(0, 4).map((u) => (
                      <div key={u.id} className="cand-urgent-item">
                        <div>
                          <strong>{u.company}</strong>
                          <small>En attente depuis <span className="cand-urgent-days">{u._diffDays} jours</span></small>
                        </div>
                        <a
                          href={`mailto:${u.contact_email || ''}?subject=Candidature - ${encodeURIComponent(u.company)}`}
                          className="cand-urgent-btn"
                        >
                          Relancer
                        </a>
                      </div>
                    ))}
                    {urgentList.length > 4 && (
                      <div className="cand-urgent-more">
                        + {urgentList.length - 4} autres requêtes en attente…
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Cards List */}
              {filteredCandidatures.length > 0 ? (
                <div className="cand-cards-list">
                  {filteredCandidatures.map((c) => (
                    <CandidatureCard
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
                <div className="cand-empty-state">
                  <span className="cand-empty-icon">📍</span>
                  <h3>Aucune candidature dans cette vue</h3>
                  <p>Clique sur un canton ou saisis un nouveau stage pour alimenter le suivi.</p>
                  <button
                    className="sh-btn-secondary"
                    onClick={() => { setActiveCode(null); setActiveCityKey(null); setFilterStatus('all'); setSearchQuery(''); }}
                  >
                    Réinitialiser les filtres
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── TOOLTIP ── */}
      {tooltip.visible && (
        <div
          className="cand-tooltip"
          style={{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }}
        >
          📍 {tooltip.text}
        </div>
      )}

      {/* ── MODALS ── */}
      {showAddModal && (
        <AddCandidatureModal
          prefill={prefillFromOffer}
          busy={busy}
          onClose={() => {
            setShowAddModal(false);
            if (onClearPrefill) onClearPrefill();
          }}
          onSave={(data) => {
            if (onSaveCandidature) onSaveCandidature(data);
            setShowAddModal(false);
            if (onClearPrefill) onClearPrefill();
          }}
        />
      )}

      {editingCandidature && (
        <AddCandidatureModal
          prefill={editingCandidature}
          busy={busy}
          onClose={() => setEditingCandidature(null)}
          onSave={(data) => {
            if (onSaveCandidature) onSaveCandidature({ ...data, id: editingCandidature.id });
            setEditingCandidature(null);
          }}
        />
      )}

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
    </div>
  );
}

// ── RICH CANDIDATURE CARD COMPONENT ──
function CandidatureCard({ candidature, onEdit, onStatusChange, onAddNote, onDelete }) {
  const [showDetails, setShowDetails] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [copied, setCopied] = useState(false);

  const status = candidature.status || 'Demande initiale';
  const sLow = status.toLowerCase();

  // Status Badge Class
  const badgeClass = useMemo(() => {
    if (sLow.includes('refus') || sLow.includes('rejet')) return 'b-refus';
    if (sLow.includes('accept') || sLow.includes('valid') || sLow.includes('offre')) return 'b-accepte';
    if (sLow.includes('entretien')) return 'b-entretien';
    if (sLow.includes('réponse') || sLow.includes('reponse')) return 'b-relance';
    return 'b-envoi';
  }, [sLow]);

  // Stepper state
  const stepState = useMemo(() => {
    // Steps: 0: Demande, 1: Réponse, 2: Entretien, 3: Décision
    if (sLow.includes('refus')) return { step: 3, rejected: true };
    if (sLow.includes('accept') || sLow.includes('valid') || sLow.includes('offre')) return { step: 3, done: true };
    if (sLow.includes('entretien')) return { step: 2 };
    if (sLow.includes('réponse') || sLow.includes('reponse')) return { step: 1 };
    return { step: 0 };
  }, [sLow]);

  // Copy name helper
  const copyCompanyName = () => {
    navigator.clipboard.writeText(candidature.company);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <article className="cand-card">
      {/* Top row: 50% / 50% split */}
      <div className="cand-card-top">
        <div className="cand-card-company" onClick={onEdit} title="Modifier la fiche">
          {candidature.company}
        </div>
        <div className={`cand-badge ${badgeClass}`}>
          {status}
        </div>
      </div>

      {/* Stepper */}
      <div className="cand-stepper">
        <div className={`cand-step ${stepState.step >= 0 ? (stepState.step > 0 ? 'done' : 'active') : ''}`}>
          <div className="cand-step-dot" />
          <span className="cand-step-lbl">Envoyé</span>
        </div>
        <div className={`cand-step ${stepState.step >= 1 ? (stepState.step > 1 ? 'done' : 'active') : ''}`}>
          <div className="cand-step-dot" />
          <span className="cand-step-lbl">Retour</span>
        </div>
        <div className={`cand-step ${stepState.step >= 2 ? (stepState.step > 2 ? 'done' : 'active') : ''}`}>
          <div className="cand-step-dot" />
          <span className="cand-step-lbl">Entretien</span>
        </div>
        <div className={`cand-step ${stepState.step >= 3 ? (stepState.rejected ? 'rejected' : 'done') : ''}`}>
          <div className="cand-step-dot" />
          <span className="cand-step-lbl">{stepState.rejected ? 'Refus' : 'Décision'}</span>
        </div>
      </div>

      {/* Meta row */}
      <div className="cand-card-meta">
        <span className="cand-meta-code">{candidature.canton || 'CH'}</span>
        {candidature.location && <span>{candidature.location}</span>}
        {candidature.sector && <span>{candidature.sector}</span>}
      </div>

      {/* Stars Interest Rating */}
      {candidature.rating > 0 && (
        <div className="cand-stars-row">
          <div className="cand-stars">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((starIdx) => (
              <span key={starIdx} className={`cand-star ${starIdx <= Math.round(candidature.rating) ? 'on' : 'off'}`}>
                ★
              </span>
            ))}
          </div>
          <span className="cand-note-val">{candidature.rating}/10</span>
        </div>
      )}

      {/* Detailed activity or démarche */}
      {candidature.detailed_activity && (
        <p className="cand-card-desc">{candidature.detailed_activity}</p>
      )}

      {/* Links */}
      <div className="cand-card-links">
        {candidature.link1 && (
          <a href={candidature.link1} target="_blank" rel="noopener noreferrer" className="cand-link-pill">
            <Icon name="external" size={11} />
            <span>Lien 1</span>
          </a>
        )}
        {candidature.link2 && (
          <a href={candidature.link2} target="_blank" rel="noopener noreferrer" className="cand-link-pill">
            <Icon name="external" size={11} />
            <span>Lien 2</span>
          </a>
        )}
        {candidature.link3 && (
          <a href={candidature.link3} target="_blank" rel="noopener noreferrer" className="cand-link-pill">
            <Icon name="external" size={11} />
            <span>Lien 3</span>
          </a>
        )}
      </div>

      {/* Status Changer & Quick Actions */}
      <div className="cand-card-controls">
        <select
          className="cand-status-select"
          value={status}
          onChange={(e) => onStatusChange(e.target.value)}
        >
          <option value="Demande initiale">Demande initiale</option>
          <option value="Réponse obtenue">Réponse obtenue</option>
          <option value="Entretien">Entretien</option>
          <option value="Validé">Validé / Offre</option>
          <option value="Refusé">Refusé</option>
        </select>

        <div className="cand-card-actions">
          <button
            type="button"
            className="cand-action-btn"
            onClick={copyCompanyName}
            title="Copier le nom"
          >
            {copied ? '✓ Copié' : '📋 Copier'}
          </button>

          <a
            href={`https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(candidature.company)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="cand-action-btn"
            title="Chercher sur LinkedIn"
          >
            💼 LinkedIn
          </a>

          {candidature.contact_email && (
            <a
              href={`mailto:${candidature.contact_email}?subject=Candidature - ${encodeURIComponent(candidature.company)}`}
              className="cand-action-btn"
              title="Envoyer un email"
            >
              ✉️ Email
            </a>
          )}

          <button
            type="button"
            className="cand-action-btn note"
            onClick={onAddNote}
            title="Ajouter un mémo Post-it"
          >
            📝 Mémo
          </button>

          <button
            type="button"
            className="cand-action-btn toggle"
            onClick={() => setShowTimeline(!showTimeline)}
            title="Voir l'historique et mémos"
          >
            {showTimeline ? 'Masquer' : `Historique (${(candidature.status_history || []).length + (candidature.notes || []).length})`}
          </button>
        </div>
      </div>

      {/* Expandable Dual Timeline & Post-its */}
      {showTimeline && (
        <div className="cand-timeline-box">
          {/* Status Change History */}
          {(candidature.status_history || []).length > 0 && (
            <div className="cand-history-section">
              <h4>Historique des statuts</h4>
              <div className="cand-history-timeline">
                {candidature.status_history.map((sh, idx) => (
                  <div key={idx} className="cand-history-entry">
                    <span className="cand-history-dot" />
                    <div className="cand-history-content">
                      <span className="cand-history-date">{sh.date || 'Date'}</span>
                      <span className="cand-history-text">{sh.text || sh.status}</span>
                      {sh.delta_days != null && (
                        <span className="cand-history-delta">{formatDelta(sh.delta_days)}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Yellow Post-it Memos */}
          <div className="cand-postits-section">
            <div className="cand-postits-header">
              <h4>Mémos Post-it ({(candidature.notes || []).length})</h4>
              <button type="button" className="cand-postit-add" onClick={onAddNote}>
                + Ajouter
              </button>
            </div>

            {(candidature.notes || []).length > 0 ? (
              <div className="cand-postits-grid">
                {candidature.notes.map((n, idx) => (
                  <div key={idx} className="cand-postit">
                    <div className="cand-postit-date">{n.date || 'Mémo'}</div>
                    <div className="cand-postit-text">{n.text || n}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="cand-no-notes">Aucun mémo pour le moment.</p>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

export default CandidaturesView;
