import React, { useMemo, useState, useEffect } from 'react';
import { Icon } from '../Common/Icons';
import { OfferDetailDrawer } from './OfferDetailDrawer';
import { descriptionText } from '../Swiper/descriptionText';
import { offerInsights, offerSkills } from '../Swiper/TinderCard';
import './ResultsView.css';

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #ec4899 0%, #f43f5e 100%)',
  'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
  'linear-gradient(135deg, #06b6d4 0%, #0ea5e9 100%)',
  'linear-gradient(135deg, #10b981 0%, #059669 100%)',
  'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)',
  'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)',
  'linear-gradient(135deg, #f43f5e 0%, #e11d48 100%)',
];

function getAvatarGradient(name = '') {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const idx = Math.abs(hash) % AVATAR_GRADIENTS.length;
  return AVATAR_GRADIENTS[idx];
}

function getDomain(url) {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (_) {
    return null;
  }
}

function getOfferApplication(offer, candidatures = []) {
  if (!offer || !candidatures.length) return null;
  const offId = offer.id ? String(offer.id) : null;
  const offComp = (offer.company || '').trim().toLowerCase();
  return (
    candidatures.find(
      (c) =>
        (offId && c.offer_id && String(c.offer_id) === offId) ||
        (offComp && c.company && c.company.trim().toLowerCase() === offComp)
    ) || null
  );
}

function getOfferRecap(offer) {
  const lines = String(offer.reasons || '')
    .split('\n')
    .map((item) => item.replace(/^[\s•✓✦-]+/, '').trim())
    .filter(Boolean);
  const checkPattern = /inconnu|non confirm|à vérifi|a verifier|incertain|préfér|souhait|manquant|pas précisé|non précisé|unknown|not confirmed/i;
  const strong = lines.filter((l) => !checkPattern.test(l));

  const rawText = String(offer.body_preview || offer.body || offer.snippet || '').trim();
  const cleanedExcerpt = rawText
    .replace(/^#+\s+/gm, '')
    .replace(/\s+/g, ' ')
    .slice(0, 150);

  return {
    highlight: strong[0] || null,
    secondaryHighlight: strong[1] || null,
    excerpt: cleanedExcerpt ? (cleanedExcerpt.length >= 150 ? cleanedExcerpt + '…' : cleanedExcerpt) : null,
  };
}

// Les 10 Wireframes / Layouts structurels pour GRANDES CARTES
const CARD_WIREFRAMES = [
  { id: 'standard-v2', name: '1. Grande Verticale Classique', icon: 'grid', desc: 'Empilement vertical équilibré & aéré' },
  { id: 'hero-banner', name: '2. Hero Header & Badge Pro', icon: 'spark', desc: 'Bandeau supérieur teinté avec score XXL' },
  { id: 'scorecard-dossier', name: '3. Dossier de Sélection RH', icon: 'fileText', desc: 'Fiche d’évaluation officielle & jauge KPI' },
  { id: 'nested-blocks', name: '4. Cartouches Imbriquées (3 Blocs)', icon: 'layers', desc: 'Architecture structurée en 3 conteneurs nets' },
  { id: 'timeline-flow', name: '5. Parcours Timeline', icon: 'target', desc: 'Lecture guidée en 4 jalons verticaux' },
  { id: 'recap-hero-large', name: '6. Synthèse IA en Majesté', icon: 'spark', desc: 'Encart IA généreux projeté en haut de carte' },
  { id: 'boarding-pass-large', name: '7. Billet Pass Grand Format', icon: 'fileText', desc: 'Boarding pass avec ligne perforée & souche' },
  { id: 'split-columns-large', name: '8. Deux Grandes Colonnes', icon: 'columns', desc: 'Grande carte scindée en 2 colonnes spacieuses' },
  { id: 'editorial-magazine', name: '9. Éditorial & Magazine', icon: 'fileText', desc: 'Typographie presse, citation IA & attributs' },
  { id: 'action-cockpit-large', name: '10. Cockpit Décisionnel XXL', icon: 'sliders', desc: 'Grande carte avec pavé d’action complet' },
];

export function ResultsView({
  results = [],
  profileId,
  busy = false,
  onDecide,
  onRequeue,
  onCommand,
  onExport,
  onTransferCandidature,
  candidatures = [],
}) {
  // Mode de page : 'bento' | 'cockpit' | 'kanban' | 'table'
  const [pageMode, setPageMode] = useState(() => {
    return localStorage.getItem('sh_results_page_mode') || 'bento';
  });

  const handleSetPageMode = (mode) => {
    setPageMode(mode);
    localStorage.setItem('sh_results_page_mode', mode);
  };

  // Wireframe des cartes Bento : 'mix' ou l'un des 10 IDs
  const [cardWireframe, setCardWireframe] = useState(() => {
    const saved = localStorage.getItem('sh_bento_wireframe') || 'mix';
    if (saved === 'mix' || CARD_WIREFRAMES.some((w) => w.id === saved)) {
      return saved;
    }
    return 'mix';
  });

  const handleSetCardWireframe = (wf) => {
    setCardWireframe(wf);
    localStorage.setItem('sh_bento_wireframe', wf);
  };

  const [query, setQuery] = useState('');
  const [filterTab, setFilterTab] = useState('all'); // all | not_applied | applied | keep | unsure
  const [sortOption, setSortOption] = useState('not_applied_first');

  // Drawer & Cockpit states
  const [drawerOffer, setDrawerOffer] = useState(null);
  const [cockpitSelectedId, setCockpitSelectedId] = useState(null);

  // Undo Toast state
  const [undoToast, setUndoToast] = useState(null);

  useEffect(() => {
    if (!undoToast) return;
    const timer = setTimeout(() => {
      setUndoToast(null);
    }, 6000);
    return () => clearTimeout(timer);
  }, [undoToast]);

  const handleReject = async (offer) => {
    if (!onDecide) return;
    const prev = offer.review_decision || 'keep';
    try {
      await onDecide(offer, 'reject');
      setUndoToast({
        offer,
        previousDecision: prev,
        message: `Offre de ${offer.company || 'l’entreprise'} rejetée.`,
      });
      if (drawerOffer?.id === offer.id) setDrawerOffer(null);
    } catch (e) {
      console.error(e);
    }
  };

  const handleUndo = async () => {
    if (!undoToast?.offer || !onDecide) return;
    await onDecide(undoToast.offer, undoToast.previousDecision || 'keep');
    setUndoToast(null);
  };

  const handleRequeue = async (offer) => {
    if (!onRequeue) return;
    await onRequeue({ offer_ids: [offer.id] });
  };

  // Pre-calculate metadata
  const offersWithMetadata = useMemo(() => {
    return results.map((offer) => {
      const app = getOfferApplication(offer, candidatures);
      const recap = getOfferRecap(offer);
      const domain = getDomain(offer.url);
      const score = Math.max(0, Math.min(100, Math.round(Number(offer.score) || 0)));
      return {
        ...offer,
        _candidature: app,
        _isApplied: Boolean(app),
        _recap: recap,
        _domain: domain,
        _score: score,
      };
    });
  }, [results, candidatures]);

  // Counts for tabs
  const notAppliedCount = useMemo(
    () => offersWithMetadata.filter((o) => !o._isApplied).length,
    [offersWithMetadata]
  );
  const appliedCount = useMemo(
    () => offersWithMetadata.filter((o) => o._isApplied).length,
    [offersWithMetadata]
  );
  const keepCount = useMemo(
    () => offersWithMetadata.filter((o) => o.review_decision === 'keep').length,
    [offersWithMetadata]
  );
  const unsureCount = useMemo(
    () => offersWithMetadata.filter((o) => o.review_decision === 'unsure').length,
    [offersWithMetadata]
  );

  // Filter & Sort
  const processedOffers = useMemo(() => {
    let list = offersWithMetadata.filter((o) => {
      if (filterTab === 'not_applied' && o._isApplied) return false;
      if (filterTab === 'applied' && !o._isApplied) return false;
      if (filterTab === 'keep' && o.review_decision !== 'keep') return false;
      if (filterTab === 'unsure' && o.review_decision !== 'unsure') return false;

      if (!query.trim()) return true;
      const haystack = `${o.title || ''} ${o.company || ''} ${o.location || ''} ${o.canton || ''} ${o.skills_found || ''} ${o.reasons || ''}`.toLowerCase();
      return haystack.includes(query.trim().toLowerCase());
    });

    list.sort((a, b) => {
      if (sortOption === 'not_applied_first') {
        if (a._isApplied !== b._isApplied) return a._isApplied ? 1 : -1;
        return b._score - a._score;
      }
      if (sortOption === 'applied_first') {
        if (a._isApplied !== b._isApplied) return a._isApplied ? -1 : 1;
        return b._score - a._score;
      }
      if (sortOption === 'score_desc') {
        return b._score - a._score;
      }
      if (sortOption === 'company_asc') {
        return (a.company || '').localeCompare(b.company || '');
      }
      if (sortOption === 'date_desc') {
        const da = Date.parse(a.discovered_at || a.created_at || 0);
        const db = Date.parse(b.discovered_at || b.created_at || 0);
        return db - da;
      }
      return 0;
    });

    return list;
  }, [offersWithMetadata, filterTab, query, sortOption]);

  // Selected cockpit item
  const activeCockpitOffer = useMemo(() => {
    if (!processedOffers.length) return null;
    if (cockpitSelectedId) {
      const match = processedOffers.find((o) => o.id === cockpitSelectedId);
      if (match) return match;
    }
    return processedOffers[0];
  }, [processedOffers, cockpitSelectedId]);

  return (
    <div className="results-workspace">
      {/* --------------------------------------------------------------------
          TOP HEADER : TITRE & SÉLECTEUR DE MODE DE PAGE
          -------------------------------------------------------------------- */}
      <div className="rw-header">
        <div className="rw-header-left">
          <span className="rw-eyebrow">
            <Icon name="spark" size={14} />
            <span>Studio Opportunités & Match</span>
          </span>
          <h1 className="rw-header-title">Mes offres d'emploi</h1>
          <p className="rw-header-subtitle">
            Pilote tes opportunités, choisis ton mode d’affichage (Bento, Cockpit, Kanban, Tableau) et teste 10 architectures de cartes différentes.
          </p>
        </div>

        <div className="rw-header-actions">
          {/* Sélecteur de mode de page */}
          <div className="rw-page-mode-switcher" role="radiogroup" aria-label="Mode d'affichage">
            <button
              type="button"
              className={`rw-mode-btn ${pageMode === 'bento' ? 'active' : ''}`}
              onClick={() => handleSetPageMode('bento')}
            >
              <Icon name="grid" size={14} />
              <span>Bento</span>
            </button>
            <button
              type="button"
              className={`rw-mode-btn ${pageMode === 'cockpit' ? 'active' : ''}`}
              onClick={() => handleSetPageMode('cockpit')}
            >
              <Icon name="split" size={14} />
              <span>Cockpit</span>
            </button>
            <button
              type="button"
              className={`rw-mode-btn ${pageMode === 'kanban' ? 'active' : ''}`}
              onClick={() => handleSetPageMode('kanban')}
            >
              <Icon name="columns" size={14} />
              <span>Kanban</span>
            </button>
            <button
              type="button"
              className={`rw-mode-btn ${pageMode === 'table' ? 'active' : ''}`}
              onClick={() => handleSetPageMode('table')}
            >
              <Icon name="table" size={14} />
              <span>Tableau</span>
            </button>
          </div>

          {onExport ? (
            <button
              type="button"
              onClick={() => onExport(results)}
              className="rw-btn-url"
              style={{ padding: '7px 12px', fontWeight: 800 }}
              title="Exporter en CSV"
            >
              <Icon name="download" size={14} />
              <span>CSV</span>
            </button>
          ) : (
            <a
              href={`/api/export-csv?profile=${encodeURIComponent(profileId)}`}
              download
              className="rw-btn-url"
              style={{ padding: '7px 12px', fontWeight: 800 }}
              title="Exporter en CSV"
            >
              <Icon name="download" size={14} />
              <span>CSV</span>
            </a>
          )}

          {onCommand && (
            <button
              className="rw-btn-apply"
              style={{ padding: '7px 14px' }}
              onClick={() => onCommand('review-sync')}
              disabled={busy}
              title="Synchroniser avec Google Sheets"
            >
              <Icon name="external" size={14} />
              <span>Sync Sheets</span>
            </button>
          )}
        </div>
      </div>

      {/* --------------------------------------------------------------------
          BARRE D'OUTILS : RECHERCHE, TRI (DÉJÀ POSTULÉ OU NON), FILTRES
          -------------------------------------------------------------------- */}
      <div className="rw-toolbar-card">
        <div className="rw-toolbar-row-top">
          {/* Champ recherche */}
          <div className="rw-search-field">
            <Icon name="search" size={18} />
            <input
              type="text"
              className="rw-search-input"
              placeholder="Rechercher par métier, entreprise, mot-clé, compétence..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button className="rw-search-clear" onClick={() => setQuery('')} aria-label="Effacer">
                <Icon name="x" size={14} />
              </button>
            )}
          </div>

          {/* Menu de tri par déjà postulé ou non */}
          <div className="rw-sort-box">
            <span className="rw-sort-label">Trier par :</span>
            <select
              className="rw-sort-select"
              value={sortOption}
              onChange={(e) => setSortOption(e.target.value)}
              aria-label="Critère de tri"
            >
              <option value="not_applied_first">⏳ Non postulées en premier</option>
              <option value="applied_first">🚀 Déjà postulées en premier</option>
              <option value="score_desc">⭐ Score de match (élevé → bas)</option>
              <option value="company_asc">🏢 Entreprise (A → Z)</option>
              <option value="date_desc">🕒 Plus récentes</option>
            </select>
          </div>
        </div>

        {/* Onglets filtres d'état avec comptage */}
        <div className="rw-filter-tabs">
          <button
            type="button"
            className={`rw-tab-pill ${filterTab === 'all' ? 'active' : ''}`}
            onClick={() => setFilterTab('all')}
          >
            <span>Toutes les offres</span>
            <span className="rw-tab-count">{results.length}</span>
          </button>
          <button
            type="button"
            className={`rw-tab-pill ${filterTab === 'not_applied' ? 'active' : ''}`}
            onClick={() => setFilterTab('not_applied')}
            style={filterTab === 'not_applied' ? { background: '#eff6ff', color: '#1d4ed8', borderColor: '#bfdbfe' } : undefined}
          >
            <Icon name="clock" size={13} />
            <span>À postuler / Non postulées</span>
            <span className="rw-tab-count">{notAppliedCount}</span>
          </button>
          <button
            type="button"
            className={`rw-tab-pill ${filterTab === 'applied' ? 'active' : ''}`}
            onClick={() => setFilterTab('applied')}
            style={filterTab === 'applied' ? { background: '#ecfdf5', color: '#047857', borderColor: '#a7f3d0' } : undefined}
          >
            <Icon name="check" size={13} />
            <span>Déjà postulées</span>
            <span className="rw-tab-count">{appliedCount}</span>
          </button>
          <button
            type="button"
            className={`rw-tab-pill ${filterTab === 'keep' ? 'active' : ''}`}
            onClick={() => setFilterTab('keep')}
          >
            <Icon name="heart" size={13} />
            <span>Coups de cœur</span>
            <span className="rw-tab-count">{keepCount}</span>
          </button>
          <button
            type="button"
            className={`rw-tab-pill ${filterTab === 'unsure' ? 'active' : ''}`}
            onClick={() => setFilterTab('unsure')}
          >
            <span>🕒 Mises de côté</span>
            <span className="rw-tab-count">{unsureCount}</span>
          </button>
        </div>
      </div>

      {/* Subbar with Count & Batch Actions */}
      <div className="rw-subbar">
        <span className="rw-subbar-count">
          Affichage de <strong>{processedOffers.length}</strong> offre{processedOffers.length > 1 ? 's' : ''}
          {filterTab !== 'all' || query ? ' (filtrées)' : ''}
        </span>

        {filterTab === 'unsure' && processedOffers.length > 0 && onRequeue && (
          <button
            type="button"
            className="rw-requeue-batch-btn"
            disabled={busy}
            onClick={() => onRequeue({ all_unsure: true })}
          >
            <Icon name="refresh" size={13} />
            <span>Remettre toutes les offres 'À revoir' dans le Swiper</span>
          </button>
        )}
      </div>

      {/* --------------------------------------------------------------------
          EMPTY STATE
          -------------------------------------------------------------------- */}
      {processedOffers.length === 0 ? (
        <div className="sh-empty-state" style={{ background: '#ffffff', borderRadius: '16px' }}>
          <Icon name="search" size={32} />
          <h3>Aucune offre correspondante</h3>
          <p>Essaie de modifier tes critères de filtre ou ta recherche.</p>
          {(query || filterTab !== 'all') && (
            <button
              type="button"
              className="rw-btn-apply"
              onClick={() => {
                setQuery('');
                setFilterTab('all');
              }}
            >
              Réinitialiser les filtres
            </button>
          )}
        </div>
      ) : (
        <>
          {/* ================================================================
              MODE 1 : BENTO (AVEC SÉLECTEUR DE 10 WIREFRAMES DE CARTES)
              ================================================================ */}
          {pageMode === 'bento' && (
            <>
              {/* Sélecteur des 10 Layouts de Carte */}
              <div className="rw-card-layout-picker">
                <div className="rw-card-layout-label">
                  <Icon name="layers" size={14} />
                  <span>10 Layouts de cartes :</span>
                </div>
                <div className="rw-card-layout-pills">
                  <button
                    type="button"
                    className={`rw-card-layout-btn ${cardWireframe === 'mix' ? 'active' : ''}`}
                    onClick={() => handleSetCardWireframe('mix')}
                    title="Affiche les 10 structures côte-à-côte pour les comparer"
                  >
                    🎭 Mix Démo (10 layouts en parallèle)
                  </button>
                  {CARD_WIREFRAMES.map((wf) => (
                    <button
                      key={wf.id}
                      type="button"
                      className={`rw-card-layout-btn ${cardWireframe === wf.id ? 'active' : ''}`}
                      onClick={() => handleSetCardWireframe(wf.id)}
                      title={wf.desc}
                    >
                      <Icon name={wf.icon} size={12} />
                      <span>{wf.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Grille des cartes Bento */}
              <div className="rw-bento-grid">
                {processedOffers.map((offer, index) => {
                  const isApplied = offer._isApplied;
                  const recap = offer._recap;
                  const skills = offerSkills(offer).slice(0, 4);

                  // Choix du wireframe pour cette carte
                  const wfId = cardWireframe === 'mix'
                    ? CARD_WIREFRAMES[index % CARD_WIREFRAMES.length].id
                    : cardWireframe;
                  const currentWfObj = CARD_WIREFRAMES.find((w) => w.id === wfId) || CARD_WIREFRAMES[0];

                  return (
                    <article
                      key={offer.id}
                      className={`rw-bento-card-base card-wf-${wfId} ${isApplied ? 'is-applied' : ''}`}
                    >
                      {/* Badge indicatif en mode Mix */}
                      {cardWireframe === 'mix' && (
                        <div className="rw-wf-badge">
                          <span>{currentWfObj.name}</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSetCardWireframe(wfId);
                            }}
                          >
                            Appliquer à toutes ↗
                          </button>
                        </div>
                      )}

                      {/* ----------------------------------------------------
                          WIREFRAME 1 : Grande Verticale Classique (Standard Raffiné)
                          ---------------------------------------------------- */}
                      {wfId === 'standard-v2' && (
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                              <div className="rw-avatar-square" style={{ width: 48, height: 48, fontSize: 15, background: getAvatarGradient(offer.company) }}>
                                {String(offer.company || 'SH').slice(0, 2).toUpperCase()}
                              </div>
                              <div>
                                <strong style={{ fontSize: '15px', color: '#0f172a', display: 'block', fontWeight: 800 }}>{offer.company}</strong>
                                <span style={{ fontSize: '12.5px', color: '#64748b', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                                  <Icon name="pin" size={12} /> {offer.location || 'Suisse'} {offer.canton ? `(${offer.canton})` : ''}
                                </span>
                              </div>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                              <span className={`rw-score-pill ${offer._score >= 70 ? 'high' : 'mid'}`} style={{ fontSize: '13px', padding: '5px 11px' }}>
                                {offer._score}% Match
                              </span>
                              <span style={{ fontSize: '10.5px', color: '#94a3b8' }}>
                                {offer.discovered_at ? new Date(offer.discovered_at).toLocaleDateString('fr-CH') : 'Récemment'}
                              </span>
                            </div>
                          </div>

                          <div>
                            {isApplied ? (
                              <span className="rw-applied-badge">🚀 Postulée ({offer._candidature?.status || 'Suivie'})</span>
                            ) : (
                              <span className="rw-not-applied-badge">⏳ Non postulée · À traiter</span>
                            )}
                          </div>

                          <h3
                            style={{ fontSize: '17px', fontWeight: 850, margin: '2px 0', cursor: 'pointer', lineHeight: 1.35 }}
                            onClick={() => setDrawerOffer(offer)}
                          >
                            {offer.title}
                          </h3>

                          {/* Specs chips */}
                          <div className="rw-specs-row">
                            {offer.duration && <span className="rw-spec-chip">⏱ {offer.duration}</span>}
                            {offer.contract_type && <span className="rw-spec-chip">📋 {offer.contract_type}</span>}
                            {offer.language && <span className="rw-spec-chip">🗣 {offer.language}</span>}
                            {offer.salary && <span className="rw-spec-chip open">💰 {offer.salary}</span>}
                          </div>

                          {/* Grande zone Récapitulatif IA */}
                          <div className="rw-recap-box" style={{ padding: '12px 14px', gap: 6 }}>
                            <div className="rw-recap-header">
                              <Icon name="spark" size={14} />
                              <span>Synthèse Flash & Adéquation</span>
                            </div>
                            <p className="rw-recap-bullet">✦ {recap.highlight || 'Points forts en adéquation avec votre profil'}</p>
                            {recap.secondaryHighlight && (
                              <p className="rw-recap-bullet" style={{ color: '#475569' }}>✦ {recap.secondaryHighlight}</p>
                            )}
                            {recap.excerpt && <p className="rw-recap-excerpt" style={{ WebkitLineClamp: 3 }}>{recap.excerpt}</p>}
                          </div>

                          {/* Skills */}
                          {skills.length > 0 && (
                            <div className="rw-skills-wrap">
                              {skills.map((s, i) => (
                                <span key={i} className="rw-skill-tag">{s}</span>
                              ))}
                            </div>
                          )}

                          {/* Footer d'action complet */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, borderTop: '1px solid #f1f5f9', marginTop: 'auto' }}>
                            <div style={{ display: 'flex', gap: 8 }}>
                              {onTransferCandidature && (
                                <button
                                  type="button"
                                  className={`rw-btn-apply ${isApplied ? 'is-applied' : ''}`}
                                  onClick={() => onTransferCandidature(offer)}
                                >
                                  {isApplied ? 'Fiche carte' : 'Postuler'}
                                </button>
                              )}
                              {offer.url && (
                                <a href={offer.url} target="_blank" rel="noopener noreferrer" className="rw-btn-url">
                                  Site ↗
                                </a>
                              )}
                              <button type="button" className="rw-btn-details" onClick={() => setDrawerOffer(offer)}>
                                Description
                              </button>
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              {onRequeue && (
                                <button type="button" className="rw-icon-action requeue" title="Swiper" onClick={() => handleRequeue(offer)}>
                                  <Icon name="refresh" size={14} />
                                </button>
                              )}
                              {onDecide && (
                                <button type="button" className="rw-icon-action danger" title="Rejeter" onClick={() => handleReject(offer)}>
                                  <Icon name="trash" size={14} />
                                </button>
                              )}
                            </div>
                          </div>
                        </>
                      )}

                      {/* ----------------------------------------------------
                          WIREFRAME 2 : Hero Header & Badge Pro
                          ---------------------------------------------------- */}
                      {wfId === 'hero-banner' && (
                        <>
                          {/* Bandeau Hero Top */}
                          <div className="card-hero-top-banner">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              {isApplied ? (
                                <span className="rw-applied-badge">🚀 Postulée</span>
                              ) : (
                                <span className="rw-not-applied-badge">⏳ Non postulée</span>
                              )}
                              {offer._domain && (
                                <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 700 }}>🌐 {offer._domain}</span>
                              )}
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <div className="rw-avatar-square" style={{ width: 42, height: 42, fontSize: 14, background: getAvatarGradient(offer.company) }}>
                                  {String(offer.company || 'SH').slice(0, 2).toUpperCase()}
                                </div>
                                <div>
                                  <strong style={{ fontSize: '15px', color: '#0f172a' }}>{offer.company}</strong>
                                  <span style={{ fontSize: '12px', color: '#64748b', display: 'block' }}>{offer.location || 'Suisse'}</span>
                                </div>
                              </div>
                              <div className="card-hero-score-badge">
                                <span style={{ fontSize: '18px', fontWeight: 900, color: offer._score >= 70 ? '#059669' : '#d97706', lineHeight: 1 }}>
                                  {offer._score}%
                                </span>
                                <span style={{ fontSize: '9px', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', marginTop: 2 }}>
                                  Match
                                </span>
                              </div>
                            </div>
                          </div>

                          <h3
                            style={{ fontSize: '17px', fontWeight: 850, margin: '4px 0', cursor: 'pointer', lineHeight: 1.35 }}
                            onClick={() => setDrawerOffer(offer)}
                          >
                            {offer.title}
                          </h3>

                          {/* 3 Colonnes Métriques */}
                          <div className="card-hero-metrics-3col">
                            <div className="card-hero-metric-tile">
                              <span style={{ fontSize: '10px', color: '#64748b', fontWeight: 800 }}>CONTRAT</span>
                              <strong style={{ fontSize: '12px', color: '#0f172a' }}>{offer.duration || 'Standard'}</strong>
                            </div>
                            <div className="card-hero-metric-tile">
                              <span style={{ fontSize: '10px', color: '#64748b', fontWeight: 800 }}>LOCALISATION</span>
                              <strong style={{ fontSize: '12px', color: '#0f172a' }}>{offer.canton || offer.location || 'Suisse'}</strong>
                            </div>
                            <div className="card-hero-metric-tile">
                              <span style={{ fontSize: '10px', color: '#64748b', fontWeight: 800 }}>PROFIL / LANGUE</span>
                              <strong style={{ fontSize: '12px', color: '#0f172a' }}>{offer.language || 'Français'}</strong>
                            </div>
                          </div>

                          {/* Récapitulatif IA */}
                          <div className="rw-recap-box" style={{ padding: '12px 14px' }}>
                            <div className="rw-recap-header">
                              <Icon name="spark" size={13} />
                              <span>Ce qu'il faut retenir</span>
                            </div>
                            <p className="rw-recap-bullet">✦ {recap.highlight || 'Profil correspondant aux attentes'}</p>
                            {recap.excerpt && <p className="rw-recap-excerpt">{recap.excerpt}</p>}
                          </div>

                          {/* Compétences */}
                          {skills.length > 0 && (
                            <div className="rw-skills-wrap">
                              {skills.map((s, i) => (
                                <span key={i} className="rw-skill-tag">{s}</span>
                              ))}
                            </div>
                          )}

                          {/* Actions à 2 niveaux */}
                          <div className="card-hero-actions-dual">
                            <div style={{ display: 'flex', gap: 8 }}>
                              {onTransferCandidature && (
                                <button
                                  type="button"
                                  className={`rw-btn-apply ${isApplied ? 'is-applied' : ''}`}
                                  style={{ flex: 1, justifyContent: 'center', padding: '8px 12px' }}
                                  onClick={() => onTransferCandidature(offer)}
                                >
                                  {isApplied ? '🚀 Fiche candidature' : '🚀 Postuler & Suivre'}
                                </button>
                              )}
                              {offer.url && (
                                <a
                                  href={offer.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="rw-btn-url"
                                  style={{ padding: '8px 14px', fontWeight: 800 }}
                                >
                                  Site ↗
                                </a>
                              )}
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <button type="button" className="rw-btn-details" onClick={() => setDrawerOffer(offer)}>
                                <Icon name="fileText" size={13} /> Description
                              </button>
                              <div style={{ display: 'flex', gap: 6 }}>
                                {onRequeue && (
                                  <button type="button" className="rw-icon-action requeue" title="Swiper" onClick={() => handleRequeue(offer)}>
                                    <Icon name="refresh" size={14} />
                                  </button>
                                )}
                                {onDecide && (
                                  <button type="button" className="rw-icon-action danger" title="Rejeter" onClick={() => handleReject(offer)}>
                                    <Icon name="trash" size={14} />
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </>
                      )}

                      {/* ----------------------------------------------------
                          WIREFRAME 3 : Dossier de Sélection RH & Jauge KPI
                          ---------------------------------------------------- */}
                      {wfId === 'scorecard-dossier' && (
                        <>
                          {/* Réf Dossier & Tampon officiel */}
                          <div className="card-scorecard-ref">
                            <span>DOSSIER RH #{String(offer.id).slice(-5).toUpperCase()}</span>
                            {isApplied ? (
                              <span className="rw-applied-badge" style={{ fontSize: '10px' }}>DOSSIER SUIVI</span>
                            ) : (
                              <span className="rw-not-applied-badge" style={{ fontSize: '10px' }}>À TRAITER</span>
                            )}
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div className="rw-avatar-square" style={{ width: 38, height: 38, fontSize: 13, background: getAvatarGradient(offer.company) }}>
                              {String(offer.company || 'SH').slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <strong style={{ fontSize: '14.5px', color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.02em' }}>{offer.company}</strong>
                              <span style={{ fontSize: '12px', color: '#64748b', display: 'block' }}>{offer.location || 'Suisse'}</span>
                            </div>
                          </div>

                          <h3
                            style={{ fontSize: '16.5px', fontWeight: 850, margin: '2px 0', cursor: 'pointer', lineHeight: 1.35 }}
                            onClick={() => setDrawerOffer(offer)}
                          >
                            {offer.title}
                          </h3>

                          {/* Jauge KPI de Match */}
                          <div className="card-scorecard-gauge-box">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
                              <span style={{ fontWeight: 750, color: '#475569' }}>Indice de compatibilité profil :</span>
                              <strong style={{ color: offer._score >= 70 ? '#059669' : '#d97706', fontSize: '13px' }}>{offer._score}%</strong>
                            </div>
                            <div className="card-scorecard-progress-bar">
                              <div
                                className="card-scorecard-progress-fill"
                                style={{
                                  width: `${Math.max(5, offer._score)}%`,
                                  background: offer._score >= 70 ? 'linear-gradient(90deg, #10b981, #059669)' : 'linear-gradient(90deg, #f59e0b, #d97706)',
                                }}
                              />
                            </div>
                          </div>

                          {/* Critères d'adéquation validés */}
                          <div className="card-scorecard-criteria-box">
                            <span style={{ fontSize: '10.5px', fontWeight: 850, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                              Critères d'évaluation IA
                            </span>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: '12px', color: '#1e293b', fontWeight: 700 }}>
                              <span style={{ color: '#059669', flexShrink: 0, marginTop: 1 }}>✔</span>
                              <span>{recap.highlight || 'Points forts en adéquation avec vos compétences'}</span>
                            </div>
                            {recap.excerpt && (
                              <p style={{ margin: '2px 0 0 0', fontSize: '11.5px', color: '#64748b', lineHeight: 1.4 }}>
                                {recap.excerpt}
                              </p>
                            )}
                          </div>

                          {/* Grille Technique */}
                          <div className="card-scorecard-specs-table">
                            <div><span style={{ color: '#94a3b8' }}>Contrat : </span><strong>{offer.duration || 'N.C.'}</strong></div>
                            <div><span style={{ color: '#94a3b8' }}>Langue : </span><strong>{offer.language || 'Français'}</strong></div>
                            <div><span style={{ color: '#94a3b8' }}>Canton : </span><strong>{offer.canton || offer.location || 'CH'}</strong></div>
                            <div><span style={{ color: '#94a3b8' }}>Ajouté : </span><strong>{offer.discovered_at ? new Date(offer.discovered_at).toLocaleDateString('fr-CH') : 'Récemment'}</strong></div>
                          </div>

                          {/* Footer de décision */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, borderTop: '1px solid #f1f5f9', marginTop: 'auto' }}>
                            <div style={{ display: 'flex', gap: 8 }}>
                              {onTransferCandidature && (
                                <button
                                  type="button"
                                  className={`rw-btn-apply ${isApplied ? 'is-applied' : ''}`}
                                  onClick={() => onTransferCandidature(offer)}
                                >
                                  {isApplied ? 'Fiche carte' : 'Postuler'}
                                </button>
                              )}
                              {offer.url && (
                                <a href={offer.url} target="_blank" rel="noopener noreferrer" className="rw-btn-url">
                                  Site ↗
                                </a>
                              )}
                              <button type="button" className="rw-btn-details" onClick={() => setDrawerOffer(offer)}>
                                Description
                              </button>
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              {onRequeue && (
                                <button type="button" className="rw-icon-action requeue" title="Swiper" onClick={() => handleRequeue(offer)}>
                                  <Icon name="refresh" size={14} />
                                </button>
                              )}
                              {onDecide && (
                                <button type="button" className="rw-icon-action danger" title="Rejeter" onClick={() => handleReject(offer)}>
                                  <Icon name="trash" size={14} />
                                </button>
                              )}
                            </div>
                          </div>
                        </>
                      )}

                      {/* ----------------------------------------------------
                          WIREFRAME 4 : Cartouches Imbriquées (3 Blocs Indépendants)
                          ---------------------------------------------------- */}
                      {wfId === 'nested-blocks' && (
                        <>
                          {/* Bloc 1 : Identité & Score */}
                          <div className="card-block-identity">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <div className="rw-avatar-square" style={{ width: 36, height: 36, fontSize: 13, background: getAvatarGradient(offer.company) }}>
                                  {String(offer.company || 'SH').slice(0, 2).toUpperCase()}
                                </div>
                                <div>
                                  <strong style={{ fontSize: '13.5px', color: '#0f172a' }}>{offer.company}</strong>
                                  <span style={{ fontSize: '11.5px', color: '#64748b', display: 'block' }}>{offer.location || 'Suisse'}</span>
                                </div>
                              </div>
                              <span className={`rw-score-pill ${offer._score >= 70 ? 'high' : 'mid'}`} style={{ padding: '3px 8px', fontSize: '12px' }}>
                                {offer._score}%
                              </span>
                            </div>
                            <h3
                              style={{ fontSize: '16px', fontWeight: 850, margin: '2px 0', cursor: 'pointer', lineHeight: 1.35 }}
                              onClick={() => setDrawerOffer(offer)}
                            >
                              {offer.title}
                            </h3>
                            <div>
                              {isApplied ? <span className="rw-applied-badge">🚀 Postulée</span> : <span className="rw-not-applied-badge">⏳ Non postulée</span>}
                            </div>
                          </div>

                          {/* Bloc 2 : Synthèse IA & Compétences */}
                          <div className="card-block-recap">
                            <div className="rw-recap-header">
                              <Icon name="spark" size={13} />
                              <span>Synthèse IA du poste</span>
                            </div>
                            <p className="rw-recap-bullet">✦ {recap.highlight || 'Points forts en adéquation'}</p>
                            {recap.excerpt && <p className="rw-recap-excerpt">{recap.excerpt}</p>}
                            {skills.length > 0 && (
                              <div className="rw-skills-wrap" style={{ marginTop: 4 }}>
                                {skills.map((s, i) => (
                                  <span key={i} className="rw-skill-tag">{s}</span>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Bloc 3 : Conditions & Commandes */}
                          <div className="card-block-actions">
                            <div className="rw-specs-row" style={{ marginBottom: 4 }}>
                              {offer.duration && <span className="rw-spec-chip">⏱ {offer.duration}</span>}
                              {offer.canton && <span className="rw-spec-chip">📍 {offer.canton}</span>}
                              {offer.language && <span className="rw-spec-chip">🗣 {offer.language}</span>}
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div style={{ display: 'flex', gap: 6 }}>
                                {onTransferCandidature && (
                                  <button
                                    type="button"
                                    className={`rw-btn-apply ${isApplied ? 'is-applied' : ''}`}
                                    onClick={() => onTransferCandidature(offer)}
                                  >
                                    {isApplied ? 'Fiche carte' : 'Postuler'}
                                  </button>
                                )}
                                {offer.url && (
                                  <a href={offer.url} target="_blank" rel="noopener noreferrer" className="rw-btn-url">
                                    Site ↗
                                  </a>
                                )}
                                <button type="button" className="rw-btn-details" onClick={() => setDrawerOffer(offer)}>
                                  Description
                                </button>
                              </div>
                              <div style={{ display: 'flex', gap: 4 }}>
                                {onRequeue && (
                                  <button type="button" className="rw-icon-action requeue" title="Swiper" onClick={() => handleRequeue(offer)}>
                                    <Icon name="refresh" size={14} />
                                  </button>
                                )}
                                {onDecide && (
                                  <button type="button" className="rw-icon-action danger" title="Rejeter" onClick={() => handleReject(offer)}>
                                    <Icon name="trash" size={14} />
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </>
                      )}

                      {/* ----------------------------------------------------
                          WIREFRAME 5 : Parcours Candidat (Timeline Séquentielle)
                          ---------------------------------------------------- */}
                      {wfId === 'timeline-flow' && (
                        <div className="card-timeline-wrap">
                          <div className="card-timeline-line" />

                          {/* Jalon 1 : L'Opportunité */}
                          <div className="card-timeline-step">
                            <div className="card-timeline-dot">1</div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <strong style={{ fontSize: '14.5px', color: '#0f172a' }}>{offer.company}</strong>
                                <span style={{ fontSize: '12px', color: '#64748b' }}>· {offer.location || 'Suisse'}</span>
                              </div>
                              <span className={`rw-score-pill ${offer._score >= 70 ? 'high' : 'mid'}`} style={{ padding: '3px 8px', fontSize: '12px' }}>
                                {offer._score}% Match
                              </span>
                            </div>
                          </div>

                          {/* Jalon 2 : Le Rôle */}
                          <div className="card-timeline-step">
                            <div className="card-timeline-dot">2</div>
                            <h3
                              style={{ fontSize: '16.5px', fontWeight: 850, margin: 0, cursor: 'pointer', lineHeight: 1.35 }}
                              onClick={() => setDrawerOffer(offer)}
                            >
                              {offer.title}
                            </h3>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                              {isApplied ? <span className="rw-applied-badge">🚀 Postulée</span> : <span className="rw-not-applied-badge">⏳ Non postulée</span>}
                              {offer.duration && <span className="rw-spec-chip">⏱ {offer.duration}</span>}
                              {offer.language && <span className="rw-spec-chip">🗣 {offer.language}</span>}
                            </div>
                          </div>

                          {/* Jalon 3 : L'Analyse Flash IA */}
                          <div className="card-timeline-step">
                            <div className="card-timeline-dot">3</div>
                            <div className="rw-recap-box" style={{ padding: '10px 12px' }}>
                              <div className="rw-recap-header">
                                <Icon name="spark" size={13} />
                                <span>Pourquoi ce job ?</span>
                              </div>
                              <p className="rw-recap-bullet">✦ {recap.highlight || 'Points forts en adéquation'}</p>
                              {recap.excerpt && <p className="rw-recap-excerpt">{recap.excerpt}</p>}
                            </div>
                            {skills.length > 0 && (
                              <div className="rw-skills-wrap" style={{ marginTop: 4 }}>
                                {skills.map((s, i) => (
                                  <span key={i} className="rw-skill-tag">{s}</span>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Jalon 4 : Décision & Actions */}
                          <div className="card-timeline-step" style={{ marginTop: 'auto' }}>
                            <div className="card-timeline-dot">4</div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 6 }}>
                              <div style={{ display: 'flex', gap: 6 }}>
                                {onTransferCandidature && (
                                  <button
                                    type="button"
                                    className={`rw-btn-apply ${isApplied ? 'is-applied' : ''}`}
                                    onClick={() => onTransferCandidature(offer)}
                                  >
                                    {isApplied ? 'Fiche carte' : 'Postuler'}
                                  </button>
                                )}
                                {offer.url && (
                                  <a href={offer.url} target="_blank" rel="noopener noreferrer" className="rw-btn-url">
                                    Site ↗
                                  </a>
                                )}
                                <button type="button" className="rw-btn-details" onClick={() => setDrawerOffer(offer)}>
                                  Description
                                </button>
                              </div>
                              <div style={{ display: 'flex', gap: 4 }}>
                                {onRequeue && (
                                  <button type="button" className="rw-icon-action requeue" title="Swiper" onClick={() => handleRequeue(offer)}>
                                    <Icon name="refresh" size={14} />
                                  </button>
                                )}
                                {onDecide && (
                                  <button type="button" className="rw-icon-action danger" title="Rejeter" onClick={() => handleReject(offer)}>
                                    <Icon name="trash" size={14} />
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* ----------------------------------------------------
                          WIREFRAME 6 : Synthèse IA en Majesté (Hero Inversé)
                          ---------------------------------------------------- */}
                      {wfId === 'recap-hero-large' && (
                        <>
                          {/* Encart Hero IA tout en haut */}
                          <div className="card-rhl-banner">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#5b21b6', fontSize: '11px', fontWeight: 850, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                <Icon name="spark" size={14} />
                                <span>SYNTHÈSE D'AFFINITÉ IA</span>
                              </div>
                              <span className={`rw-score-pill ${offer._score >= 70 ? 'high' : 'mid'}`} style={{ padding: '4px 9px', fontSize: '12px' }}>
                                {offer._score}% Compatible
                              </span>
                            </div>
                            <p style={{ margin: 0, fontSize: '13px', fontWeight: 800, color: '#1e1b4b', lineHeight: 1.4 }}>
                              ✦ {recap.highlight || 'Points forts et adéquation confirmée'}
                            </p>
                            {recap.secondaryHighlight && (
                              <p style={{ margin: 0, fontSize: '12px', fontWeight: 700, color: '#4338ca' }}>
                                ✦ {recap.secondaryHighlight}
                              </p>
                            )}
                            {recap.excerpt && (
                              <p style={{ margin: 0, fontSize: '11.5px', color: '#475569', lineHeight: 1.4 }} className="rw-recap-excerpt">
                                {recap.excerpt}
                              </p>
                            )}
                          </div>

                          {/* Identité du poste */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <div className="rw-avatar-square" style={{ width: 42, height: 42, fontSize: 14, background: getAvatarGradient(offer.company) }}>
                                {String(offer.company || 'SH').slice(0, 2).toUpperCase()}
                              </div>
                              <div>
                                <strong style={{ fontSize: '14.5px', color: '#0f172a' }}>{offer.company}</strong>
                                <span style={{ fontSize: '12px', color: '#64748b', display: 'block' }}>{offer.location || 'Suisse'}</span>
                              </div>
                            </div>
                            {isApplied ? <span className="rw-applied-badge">🚀 Postulée</span> : <span className="rw-not-applied-badge">⏳ Non postulée</span>}
                          </div>

                          <h3
                            style={{ fontSize: '17px', fontWeight: 850, margin: '2px 0', cursor: 'pointer', lineHeight: 1.35 }}
                            onClick={() => setDrawerOffer(offer)}
                          >
                            {offer.title}
                          </h3>

                          {/* Specs & Skills */}
                          <div className="rw-specs-row">
                            {offer.duration && <span className="rw-spec-chip">⏱ {offer.duration}</span>}
                            {offer.language && <span className="rw-spec-chip">🗣 {offer.language}</span>}
                            {offer.canton && <span className="rw-spec-chip">📍 {offer.canton}</span>}
                          </div>

                          {skills.length > 0 && (
                            <div className="rw-skills-wrap">
                              {skills.map((s, i) => (
                                <span key={i} className="rw-skill-tag">{s}</span>
                              ))}
                            </div>
                          )}

                          {/* Footer d'action */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, borderTop: '1px solid #f1f5f9', marginTop: 'auto' }}>
                            <div style={{ display: 'flex', gap: 8 }}>
                              {onTransferCandidature && (
                                <button
                                  type="button"
                                  className={`rw-btn-apply ${isApplied ? 'is-applied' : ''}`}
                                  onClick={() => onTransferCandidature(offer)}
                                >
                                  {isApplied ? 'Fiche carte' : 'Postuler'}
                                </button>
                              )}
                              {offer.url && (
                                <a href={offer.url} target="_blank" rel="noopener noreferrer" className="rw-btn-url">
                                  Site ↗
                                </a>
                              )}
                              <button type="button" className="rw-btn-details" onClick={() => setDrawerOffer(offer)}>
                                Description
                              </button>
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              {onRequeue && (
                                <button type="button" className="rw-icon-action requeue" title="Swiper" onClick={() => handleRequeue(offer)}>
                                  <Icon name="refresh" size={14} />
                                </button>
                              )}
                              {onDecide && (
                                <button type="button" className="rw-icon-action danger" title="Rejeter" onClick={() => handleReject(offer)}>
                                  <Icon name="trash" size={14} />
                                </button>
                              )}
                            </div>
                          </div>
                        </>
                      )}

                      {/* ----------------------------------------------------
                          WIREFRAME 7 : Billet Pass Grand Format
                          ---------------------------------------------------- */}
                      {wfId === 'boarding-pass-large' && (
                        <>
                          {/* En-tête billet pass */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div>
                              <span style={{ fontSize: '9.5px', fontWeight: 850, color: '#94a3b8', letterSpacing: '0.08em' }}>BOARDING PASS · OFFRE VALIDÉE</span>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                                <div className="rw-avatar-square" style={{ width: 34, height: 34, fontSize: 12, background: getAvatarGradient(offer.company) }}>
                                  {String(offer.company || 'SH').slice(0, 2).toUpperCase()}
                                </div>
                                <div>
                                  <strong style={{ fontSize: '14.5px', color: '#0f172a' }}>{offer.company}</strong>
                                  <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>{offer.location || 'Suisse'}</span>
                                </div>
                              </div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <span style={{ fontSize: '20px', fontWeight: 900, color: offer._score >= 70 ? '#059669' : '#d97706', display: 'block' }}>
                                {offer._score}%
                              </span>
                              <span style={{ fontSize: '9px', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase' }}>Affinité</span>
                            </div>
                          </div>

                          <h3
                            style={{ fontSize: '16.5px', fontWeight: 850, margin: '2px 0', cursor: 'pointer', lineHeight: 1.35 }}
                            onClick={() => setDrawerOffer(offer)}
                          >
                            {offer.title}
                          </h3>

                          {/* Synthèse conditions d'embarquement */}
                          <div className="rw-recap-box" style={{ padding: '10px 12px' }}>
                            <div className="rw-recap-header">
                              <Icon name="spark" size={13} />
                              <span>Conditions d'embarquement & Profil</span>
                            </div>
                            <p className="rw-recap-bullet">✦ {recap.highlight || 'Points forts en adéquation'}</p>
                            {recap.excerpt && <p className="rw-recap-excerpt">{recap.excerpt}</p>}
                          </div>

                          {/* Ligne perforée médiane */}
                          <div className="card-bp-perforation" />

                          {/* Souche d'action basse */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            {isApplied ? (
                              <span className="rw-applied-badge">STAMP : POSTULÉE</span>
                            ) : (
                              <span className="rw-not-applied-badge">STATUT : EN ATTENTE</span>
                            )}
                            <span style={{ fontSize: '11.5px', color: '#64748b' }}>{offer.duration || 'CDI / Standard'}</span>
                          </div>

                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', paddingTop: 8 }}>
                            <div style={{ display: 'flex', gap: 8 }}>
                              {onTransferCandidature && (
                                <button
                                  type="button"
                                  className={`rw-btn-apply ${isApplied ? 'is-applied' : ''}`}
                                  onClick={() => onTransferCandidature(offer)}
                                >
                                  {isApplied ? 'Fiche carte' : 'Embarquer'}
                                </button>
                              )}
                              {offer.url && (
                                <a href={offer.url} target="_blank" rel="noopener noreferrer" className="rw-btn-url">
                                  Site officiel ↗
                                </a>
                              )}
                              <button type="button" className="rw-btn-details" onClick={() => setDrawerOffer(offer)}>
                                Description
                              </button>
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              {onRequeue && (
                                <button type="button" className="rw-icon-action requeue" title="Swiper" onClick={() => handleRequeue(offer)}>
                                  <Icon name="refresh" size={14} />
                                </button>
                              )}
                              {onDecide && (
                                <button type="button" className="rw-icon-action danger" title="Rejeter" onClick={() => handleReject(offer)}>
                                  <Icon name="trash" size={14} />
                                </button>
                              )}
                            </div>
                          </div>
                        </>
                      )}

                      {/* ----------------------------------------------------
                          WIREFRAME 8 : Deux Grandes Colonnes Spacieuses
                          ---------------------------------------------------- */}
                      {wfId === 'split-columns-large' && (
                        <>
                          {/* En-tête pleine largeur */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div>
                              <strong style={{ fontSize: '13.5px', color: '#64748b' }}>{offer.company} · {offer.location || 'Suisse'}</strong>
                              <h3
                                style={{ fontSize: '17px', fontWeight: 850, margin: '2px 0', cursor: 'pointer', lineHeight: 1.35 }}
                                onClick={() => setDrawerOffer(offer)}
                              >
                                {offer.title}
                              </h3>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                              <span className={`rw-score-pill ${offer._score >= 70 ? 'high' : 'mid'}`} style={{ padding: '4px 10px', fontSize: '12.5px' }}>
                                {offer._score}%
                              </span>
                              {isApplied ? <span className="rw-applied-badge" style={{ fontSize: '10.5px' }}>Postulée</span> : <span className="rw-not-applied-badge" style={{ fontSize: '10.5px' }}>À faire</span>}
                            </div>
                          </div>

                          {/* Corps scindé en 2 colonnes spacieuses */}
                          <div className="card-scl-grid">
                            {/* Colonne Gauche : Critères & Spécifications */}
                            <div className="card-scl-col-left">
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div className="rw-avatar-square" style={{ width: 36, height: 36, fontSize: 13, background: getAvatarGradient(offer.company) }}>
                                  {String(offer.company || 'SH').slice(0, 2).toUpperCase()}
                                </div>
                                <div>
                                  <span style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 800 }}>Société</span>
                                  <strong style={{ fontSize: '13px', color: '#0f172a', display: 'block' }}>{offer.company}</strong>
                                </div>
                              </div>

                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '11.5px', color: '#475569' }}>
                                <div>📋 <strong>{offer.duration || 'Standard'}</strong></div>
                                <div>📍 <strong>{offer.canton || offer.location || 'Suisse'}</strong></div>
                                <div>🗣 <strong>{offer.language || 'Français'}</strong></div>
                                {offer.salary && <div>💰 <strong>{offer.salary}</strong></div>}
                              </div>

                              {skills.length > 0 && (
                                <div className="rw-skills-wrap">
                                  {skills.map((s, i) => (
                                    <span key={i} className="rw-skill-tag">{s}</span>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Colonne Droite : Synthèse IA & Actions directes */}
                            <div className="card-scl-col-right">
                              <div className="rw-recap-box" style={{ flex: 1, padding: '10px 12px' }}>
                                <div className="rw-recap-header">
                                  <Icon name="spark" size={13} />
                                  <span>Synthèse IA</span>
                                </div>
                                <p className="rw-recap-bullet">✦ {recap.highlight || 'Points forts en adéquation'}</p>
                                {recap.excerpt && <p className="rw-recap-excerpt" style={{ WebkitLineClamp: 4 }}>{recap.excerpt}</p>}
                              </div>

                              <div style={{ display: 'flex', gap: 6 }}>
                                {onTransferCandidature && (
                                  <button
                                    type="button"
                                    className={`rw-btn-apply ${isApplied ? 'is-applied' : ''}`}
                                    style={{ flex: 1, justifyContent: 'center' }}
                                    onClick={() => onTransferCandidature(offer)}
                                  >
                                    {isApplied ? 'Fiche' : 'Postuler'}
                                  </button>
                                )}
                                {offer.url && (
                                  <a href={offer.url} target="_blank" rel="noopener noreferrer" className="rw-btn-url">
                                    Site ↗
                                  </a>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Footer commun pleine largeur */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, borderTop: '1px solid #f1f5f9', marginTop: 'auto' }}>
                            <button type="button" className="rw-btn-details" onClick={() => setDrawerOffer(offer)}>
                              <Icon name="fileText" size={13} /> Description complète
                            </button>
                            <div style={{ display: 'flex', gap: 6 }}>
                              {onRequeue && (
                                <button type="button" className="rw-icon-action requeue" title="Swiper" onClick={() => handleRequeue(offer)}>
                                  <Icon name="refresh" size={14} />
                                </button>
                              )}
                              {onDecide && (
                                <button type="button" className="rw-icon-action danger" title="Rejeter" onClick={() => handleReject(offer)}>
                                  <Icon name="trash" size={14} />
                                </button>
                              )}
                            </div>
                          </div>
                        </>
                      )}

                      {/* ----------------------------------------------------
                          WIREFRAME 9 : Éditorial & Magazine
                          ---------------------------------------------------- */}
                      {wfId === 'editorial-magazine' && (
                        <>
                          {/* Sur-titre presse & Métadonnées */}
                          <div className="card-em-meta-line">
                            <span>OPPORTUNITÉ SUISSE · {offer.location || 'CH'}</span>
                            <span className={`rw-score-pill ${offer._score >= 70 ? 'high' : 'mid'}`} style={{ padding: '3px 8px', fontSize: '11.5px' }}>
                              {offer._score}% MATCH
                            </span>
                          </div>

                          <div>
                            <span style={{ fontSize: '12px', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                              {offer.company}
                            </span>
                            <h3
                              style={{ fontSize: '18px', fontWeight: 900, margin: '2px 0', cursor: 'pointer', lineHeight: 1.35, color: '#0f172a' }}
                              onClick={() => setDrawerOffer(offer)}
                            >
                              {offer.title}
                            </h3>
                            <div>
                              {isApplied ? <span className="rw-applied-badge">✦ Candidature déposée</span> : <span className="rw-not-applied-badge">✦ Candidature ouverte</span>}
                            </div>
                          </div>

                          {/* Encart citation IA */}
                          <div className="card-em-quote-box">
                            <strong style={{ display: 'block', fontSize: '12px', color: '#0f172a', marginBottom: 2 }}>
                              « {recap.highlight || 'Points forts en adéquation avec vos compétences'} »
                            </strong>
                            {recap.excerpt && <p style={{ margin: 0, fontSize: '11.5px', color: '#64748b' }}>{recap.excerpt}</p>}
                          </div>

                          {/* Spécifications sobres */}
                          <div className="rw-specs-row">
                            {offer.duration && <span className="rw-spec-chip">Contrat : {offer.duration}</span>}
                            {offer.language && <span className="rw-spec-chip">Langue : {offer.language}</span>}
                            {offer.canton && <span className="rw-spec-chip">Canton : {offer.canton}</span>}
                          </div>

                          {skills.length > 0 && (
                            <div className="rw-skills-wrap">
                              {skills.map((s, i) => (
                                <span key={i} className="rw-skill-tag">{s}</span>
                              ))}
                            </div>
                          )}

                          {/* Footer design épuré */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, borderTop: '1px solid #f1f5f9', marginTop: 'auto' }}>
                            <div style={{ display: 'flex', gap: 8 }}>
                              {onTransferCandidature && (
                                <button
                                  type="button"
                                  className={`rw-btn-apply ${isApplied ? 'is-applied' : ''}`}
                                  onClick={() => onTransferCandidature(offer)}
                                >
                                  {isApplied ? 'Fiche carte' : 'Postuler'}
                                </button>
                              )}
                              {offer.url && (
                                <a href={offer.url} target="_blank" rel="noopener noreferrer" className="rw-btn-url">
                                  Site officiel ↗
                                </a>
                              )}
                              <button type="button" className="rw-btn-details" onClick={() => setDrawerOffer(offer)}>
                                Description
                              </button>
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              {onRequeue && (
                                <button type="button" className="rw-icon-action requeue" title="Swiper" onClick={() => handleRequeue(offer)}>
                                  <Icon name="refresh" size={14} />
                                </button>
                              )}
                              {onDecide && (
                                <button type="button" className="rw-icon-action danger" title="Rejeter" onClick={() => handleReject(offer)}>
                                  <Icon name="trash" size={14} />
                                </button>
                              )}
                            </div>
                          </div>
                        </>
                      )}

                      {/* ----------------------------------------------------
                          WIREFRAME 10 : Cockpit Décisionnel XXL (Action-First)
                          ---------------------------------------------------- */}
                      {wfId === 'action-cockpit-large' && (
                        <>
                          {/* En-tête avec avatar 46px et score */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                              <div className="rw-avatar-square" style={{ width: 44, height: 44, fontSize: 14, background: getAvatarGradient(offer.company) }}>
                                {String(offer.company || 'SH').slice(0, 2).toUpperCase()}
                              </div>
                              <div>
                                <strong style={{ fontSize: '15px', color: '#0f172a', fontWeight: 800 }}>{offer.company}</strong>
                                <span style={{ fontSize: '12px', color: '#64748b', display: 'block' }}>{offer.location || 'Suisse'}</span>
                              </div>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                              <span className={`rw-score-pill ${offer._score >= 70 ? 'high' : 'mid'}`} style={{ padding: '4px 10px', fontSize: '13px' }}>
                                {offer._score}% Match
                              </span>
                              {isApplied ? <span className="rw-applied-badge">Postulée</span> : <span className="rw-not-applied-badge">Non postulée</span>}
                            </div>
                          </div>

                          <h3
                            style={{ fontSize: '17px', fontWeight: 850, margin: '2px 0', cursor: 'pointer', lineHeight: 1.35 }}
                            onClick={() => setDrawerOffer(offer)}
                          >
                            {offer.title}
                          </h3>

                          {/* Grille de 4 Tuiles KPI */}
                          <div className="card-acl-kpi-grid">
                            <div className="card-acl-kpi-item">
                              <span style={{ fontSize: '9.5px', color: '#94a3b8', fontWeight: 800 }}>TYPE</span>
                              <strong style={{ fontSize: '11.5px', color: '#0f172a' }}>{offer.duration || 'CDI'}</strong>
                            </div>
                            <div className="card-acl-kpi-item">
                              <span style={{ fontSize: '9.5px', color: '#94a3b8', fontWeight: 800 }}>CANTON</span>
                              <strong style={{ fontSize: '11.5px', color: '#0f172a' }}>{offer.canton || 'CH'}</strong>
                            </div>
                            <div className="card-acl-kpi-item">
                              <span style={{ fontSize: '9.5px', color: '#94a3b8', fontWeight: 800 }}>LANGUE</span>
                              <strong style={{ fontSize: '11.5px', color: '#0f172a' }}>{offer.language || 'FR'}</strong>
                            </div>
                            <div className="card-acl-kpi-item">
                              <span style={{ fontSize: '9.5px', color: '#94a3b8', fontWeight: 800 }}>MATCH</span>
                              <strong style={{ fontSize: '11.5px', color: offer._score >= 70 ? '#059669' : '#d97706' }}>{offer._score}%</strong>
                            </div>
                          </div>

                          {/* Synthèse IA express */}
                          <div className="rw-recap-box" style={{ padding: '12px 14px' }}>
                            <div className="rw-recap-header">
                              <Icon name="spark" size={13} />
                              <span>Synthèse Flash IA</span>
                            </div>
                            <p className="rw-recap-bullet">✦ {recap.highlight || 'Points forts en adéquation'}</p>
                            {recap.excerpt && <p className="rw-recap-excerpt">{recap.excerpt}</p>}
                          </div>

                          {/* Grand Pavé Décisionnel XXL */}
                          <div className="card-acl-action-pad">
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                              {onTransferCandidature && (
                                <button
                                  type="button"
                                  className={`rw-btn-apply ${isApplied ? 'is-applied' : ''}`}
                                  style={{ justifyContent: 'center', padding: '9px 12px', fontSize: '12.5px' }}
                                  onClick={() => onTransferCandidature(offer)}
                                >
                                  {isApplied ? '🚀 Fiche carte' : '🚀 Postuler & Suivre'}
                                </button>
                              )}
                              {offer.url && (
                                <a
                                  href={offer.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="rw-btn-url"
                                  style={{ justifyContent: 'center', padding: '9px 12px', fontSize: '12.5px', fontWeight: 800 }}
                                >
                                  Consulter le site ↗
                                </a>
                              )}
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <button type="button" className="rw-btn-details" onClick={() => setDrawerOffer(offer)}>
                                <Icon name="fileText" size={13} /> Description complète
                              </button>
                              <div style={{ display: 'flex', gap: 6 }}>
                                {onRequeue && (
                                  <button
                                    type="button"
                                    className="rw-icon-action requeue"
                                    title="Swiper"
                                    style={{ width: 34, height: 34 }}
                                    onClick={() => handleRequeue(offer)}
                                  >
                                    <Icon name="refresh" size={14} />
                                  </button>
                                )}
                                {onDecide && (
                                  <button
                                    type="button"
                                    className="rw-icon-action danger"
                                    title="Rejeter"
                                    style={{ width: 34, height: 34 }}
                                    onClick={() => handleReject(offer)}
                                  >
                                    <Icon name="trash" size={14} />
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </>
                      )}
                    </article>
                  );
                })}
              </div>
            </>
          )}

          {/* ================================================================
              MODE 2 : COCKPIT SPLIT-VIEW (Maître-Détail)
              ================================================================ */}
          {pageMode === 'cockpit' && (
            <div className="rw-layout-cockpit">
              <div className="rw-cockpit-list-pane">
                <div className="rw-cockpit-list-header">
                  <span>LISTE DES OFFRES ({processedOffers.length})</span>
                  <span style={{ fontSize: '11px', color: '#94a3b8' }}>Cliquer pour inspecter</span>
                </div>
                <div className="rw-cockpit-scroll-area">
                  {processedOffers.map((offer) => {
                    const isSelected = activeCockpitOffer?.id === offer.id;
                    const isApplied = offer._isApplied;

                    return (
                      <div
                        key={offer.id}
                        className={`rw-cockpit-item ${isSelected ? 'active' : ''}`}
                        onClick={() => setCockpitSelectedId(offer.id)}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <strong style={{ fontSize: '13px', color: '#0f172a' }}>{offer.company}</strong>
                          <span
                            className={`rw-score-pill ${
                              offer._score >= 70 ? 'high' : offer._score >= 45 ? 'mid' : 'low'
                            }`}
                            style={{ padding: '2px 7px', fontSize: '11px' }}
                          >
                            {offer._score}%
                          </span>
                        </div>
                        <h4 style={{ fontSize: '13.5px', fontWeight: 800, margin: 0 }}>{offer.title}</h4>
                        {isApplied ? (
                          <span style={{ fontSize: '11px', color: '#059669', fontWeight: 800 }}>
                            🚀 Postulée ({offer._candidature?.status || 'Suivie'})
                          </span>
                        ) : (
                          <span style={{ fontSize: '11px', color: '#64748b' }}>⏳ Non postulée</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {activeCockpitOffer && (
                <div className="rw-inspector-pane">
                  <div className="rw-inspector-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div
                        className="rw-avatar-square"
                        style={{ background: getAvatarGradient(activeCockpitOffer.company || 'SH') }}
                      >
                        {String(activeCockpitOffer.company || 'SH').slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <h2 style={{ fontSize: '18px', fontWeight: 850, margin: 0 }}>
                          {activeCockpitOffer.title}
                        </h2>
                        <span style={{ fontSize: '13px', color: '#64748b' }}>
                          <strong>{activeCockpitOffer.company}</strong> · {activeCockpitOffer.location || 'Suisse'}
                        </span>
                      </div>
                    </div>

                    <div className="rw-inspector-dock">
                      {activeCockpitOffer.url && (
                        <a
                          href={activeCockpitOffer.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rw-btn-url"
                          style={{ background: '#0f172a', color: '#ffffff' }}
                        >
                          <Icon name="external" size={14} />
                          <span>Voir le site ↗</span>
                        </a>
                      )}
                      {onTransferCandidature && (
                        <button
                          type="button"
                          className={`rw-btn-apply ${activeCockpitOffer._isApplied ? 'is-applied' : ''}`}
                          onClick={() => onTransferCandidature(activeCockpitOffer)}
                        >
                          <Icon name={activeCockpitOffer._isApplied ? 'check' : 'target'} size={14} />
                          <span>{activeCockpitOffer._isApplied ? 'Fiche carte' : 'Postuler & Suivre'}</span>
                        </button>
                      )}
                      {onRequeue && (
                        <button
                          type="button"
                          className="rw-icon-action requeue"
                          title="Swiper"
                          onClick={() => handleRequeue(activeCockpitOffer)}
                        >
                          <Icon name="refresh" size={15} />
                        </button>
                      )}
                      {onDecide && (
                        <button
                          type="button"
                          className="rw-icon-action danger"
                          title="Rejeter"
                          onClick={() => handleReject(activeCockpitOffer)}
                        >
                          <Icon name="trash" size={15} />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="rw-inspector-body">
                    {/* Récap */}
                    <div className="rw-recap-box" style={{ padding: '14px' }}>
                      <div className="rw-recap-header">
                        <Icon name="spark" size={14} />
                        <span>Synthèse de correspondance IA</span>
                      </div>
                      {activeCockpitOffer._recap.highlight && (
                        <p style={{ margin: '4px 0', fontSize: '13px', fontWeight: 750 }}>
                          ✦ {activeCockpitOffer._recap.highlight}
                        </p>
                      )}
                      {activeCockpitOffer._recap.secondaryHighlight && (
                        <p style={{ margin: '4px 0', fontSize: '12.5px', color: '#475569' }}>
                          • {activeCockpitOffer._recap.secondaryHighlight}
                        </p>
                      )}
                    </div>

                    {/* Description intégrée sans popup */}
                    <div>
                      <h4 style={{ fontSize: '13px', fontWeight: 850, color: '#0f172a', marginBottom: '8px' }}>
                        Description complète
                      </h4>
                      <div className="rw-drawer-prose">
                        {descriptionText(
                          activeCockpitOffer.body_preview ||
                            activeCockpitOffer.body ||
                            activeCockpitOffer.snippet ||
                            ''
                        )
                          .split(/\n{2,}|\r\n\r\n/)
                          .map((p, i) => (
                            <p key={i}>{p.trim()}</p>
                          ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ================================================================
              MODE 3 : PIPELINE KANBAN (3 Colonnes)
              ================================================================ */}
          {pageMode === 'kanban' && (
            <div className="rw-layout-kanban">
              {/* Colonne 1 : Non postulées */}
              <div className="rw-kanban-col">
                <div className="rw-kanban-col-header">
                  <strong style={{ fontSize: '13.5px' }}>⏳ À postuler (Non postulées)</strong>
                  <span className="rw-tab-count">
                    {processedOffers.filter((o) => !o._isApplied).length}
                  </span>
                </div>
                <div className="rw-kanban-cards">
                  {processedOffers
                    .filter((o) => !o._isApplied)
                    .map((offer) => (
                      <div key={offer.id} className="rw-kanban-card">
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span
                            className={`rw-score-pill ${
                              offer._score >= 70 ? 'high' : offer._score >= 45 ? 'mid' : 'low'
                            }`}
                            style={{ padding: '2px 7px', fontSize: '11px' }}
                          >
                            {offer._score}%
                          </span>
                          <strong style={{ fontSize: '12px', color: '#475569' }}>{offer.company}</strong>
                        </div>
                        <h4
                          style={{ fontSize: '13.5px', margin: 0, cursor: 'pointer' }}
                          onClick={() => setDrawerOffer(offer)}
                        >
                          {offer.title}
                        </h4>
                        {offer._recap.highlight && (
                          <p style={{ margin: 0, fontSize: '11.5px', color: '#4338ca', fontWeight: 650 }}>
                            ✦ {offer._recap.highlight}
                          </p>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '6px' }}>
                          <div style={{ display: 'flex', gap: 4 }}>
                            {onTransferCandidature && (
                              <button
                                type="button"
                                className="rw-btn-apply"
                                style={{ padding: '3px 8px', fontSize: '11px' }}
                                onClick={() => onTransferCandidature(offer)}
                              >
                                Postuler
                              </button>
                            )}
                            {offer.url && (
                              <a
                                href={offer.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="rw-btn-url"
                                style={{ padding: '3px 8px', fontSize: '11px' }}
                              >
                                Site ↗
                              </a>
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: 4 }}>
                            {onRequeue && (
                              <button
                                type="button"
                                className="rw-icon-action requeue"
                                style={{ width: 26, height: 26 }}
                                onClick={() => handleRequeue(offer)}
                              >
                                <Icon name="refresh" size={12} />
                              </button>
                            )}
                            {onDecide && (
                              <button
                                type="button"
                                className="rw-icon-action danger"
                                style={{ width: 26, height: 26 }}
                                onClick={() => handleReject(offer)}
                              >
                                <Icon name="trash" size={12} />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>

              {/* Colonne 2 : Déjà postulées */}
              <div className="rw-kanban-col">
                <div className="rw-kanban-col-header">
                  <strong style={{ fontSize: '13.5px' }}>🚀 Déjà postulées & Suivies</strong>
                  <span className="rw-tab-count">
                    {processedOffers.filter((o) => o._isApplied).length}
                  </span>
                </div>
                <div className="rw-kanban-cards">
                  {processedOffers
                    .filter((o) => o._isApplied)
                    .map((offer) => (
                      <div key={offer.id} className="rw-kanban-card" style={{ borderLeft: '3.5px solid #10b981' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span className="rw-applied-badge" style={{ padding: '2px 6px', fontSize: '10px' }}>
                            {offer._candidature?.status || 'Envoyée'}
                          </span>
                          <strong style={{ fontSize: '12px', color: '#475569' }}>{offer.company}</strong>
                        </div>
                        <h4
                          style={{ fontSize: '13.5px', margin: 0, cursor: 'pointer' }}
                          onClick={() => setDrawerOffer(offer)}
                        >
                          {offer.title}
                        </h4>
                        <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '6px' }}>
                          <div style={{ display: 'flex', gap: 4 }}>
                            {onTransferCandidature && (
                              <button
                                type="button"
                                className="rw-btn-apply is-applied"
                                style={{ padding: '3px 8px', fontSize: '11px' }}
                                onClick={() => onTransferCandidature(offer)}
                              >
                                Fiche carte
                              </button>
                            )}
                            {offer.url && (
                              <a
                                href={offer.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="rw-btn-url"
                                style={{ padding: '3px 8px', fontSize: '11px' }}
                              >
                                Site ↗
                              </a>
                            )}
                          </div>
                          {onDecide && (
                            <button
                              type="button"
                              className="rw-icon-action danger"
                              style={{ width: 26, height: 26 }}
                              onClick={() => handleReject(offer)}
                            >
                              <Icon name="trash" size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              </div>

              {/* Colonne 3 : Mises de côté */}
              <div className="rw-kanban-col">
                <div className="rw-kanban-col-header">
                  <strong style={{ fontSize: '13.5px' }}>🕒 Mises de côté (À revoir)</strong>
                  <span className="rw-tab-count">
                    {processedOffers.filter((o) => o.review_decision === 'unsure').length}
                  </span>
                </div>
                <div className="rw-kanban-cards">
                  {processedOffers
                    .filter((o) => o.review_decision === 'unsure')
                    .map((offer) => (
                      <div key={offer.id} className="rw-kanban-card">
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span
                            className={`rw-score-pill ${
                              offer._score >= 70 ? 'high' : offer._score >= 45 ? 'mid' : 'low'
                            }`}
                            style={{ padding: '2px 7px', fontSize: '11px' }}
                          >
                            {offer._score}%
                          </span>
                          <strong style={{ fontSize: '12px', color: '#475569' }}>{offer.company}</strong>
                        </div>
                        <h4
                          style={{ fontSize: '13.5px', margin: 0, cursor: 'pointer' }}
                          onClick={() => setDrawerOffer(offer)}
                        >
                          {offer.title}
                        </h4>
                        <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '6px' }}>
                          <button
                            type="button"
                            className="rw-btn-details"
                            style={{ padding: '3px 8px', fontSize: '11px' }}
                            onClick={() => setDrawerOffer(offer)}
                          >
                            Détails
                          </button>
                          <div style={{ display: 'flex', gap: 4 }}>
                            {onRequeue && (
                              <button
                                type="button"
                                className="rw-icon-action requeue"
                                style={{ width: 26, height: 26 }}
                                title="Swiper"
                                onClick={() => handleRequeue(offer)}
                              >
                                <Icon name="refresh" size={12} />
                              </button>
                            )}
                            {onDecide && (
                              <button
                                type="button"
                                className="rw-icon-action danger"
                                style={{ width: 26, height: 26 }}
                                onClick={() => handleReject(offer)}
                              >
                                <Icon name="trash" size={12} />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}

          {/* ================================================================
              MODE 4 : TABLEAU PRO (Data Grid Tableur)
              ================================================================ */}
          {pageMode === 'table' && (
            <div className="rw-layout-table">
              <div className="rw-table-responsive">
                <table className="rw-table">
                  <thead>
                    <tr>
                      <th style={{ width: '80px' }}>Match</th>
                      <th style={{ width: '220px' }}>Entreprise & Lieu</th>
                      <th>Intitulé & Récap express</th>
                      <th style={{ width: '150px' }}>Statut candidature</th>
                      <th style={{ width: '130px' }}>Conditions</th>
                      <th style={{ width: '180px', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {processedOffers.map((offer) => {
                      const isApplied = offer._isApplied;

                      return (
                        <tr key={offer.id}>
                          <td>
                            <span
                              className={`rw-score-pill ${
                                offer._score >= 70 ? 'high' : offer._score >= 45 ? 'mid' : 'low'
                              }`}
                            >
                              {offer._score}%
                            </span>
                          </td>
                          <td>
                            <strong style={{ color: '#0f172a' }}>{offer.company}</strong>
                            <span style={{ fontSize: '11.5px', color: '#64748b', display: 'block' }}>
                              {offer.location || offer.canton || 'Suisse'}
                            </span>
                          </td>
                          <td>
                            <h4
                              style={{ margin: '0 0 3px 0', fontSize: '13.5px', cursor: 'pointer' }}
                              onClick={() => setDrawerOffer(offer)}
                            >
                              {offer.title}
                            </h4>
                            {offer._recap.highlight && (
                              <span style={{ fontSize: '11.5px', color: '#4f46e5', fontWeight: 700 }}>
                                ✦ {offer._recap.highlight}
                              </span>
                            )}
                          </td>
                          <td>
                            {isApplied ? (
                              <span className="rw-applied-badge">
                                <Icon name="check" size={13} />
                                <span>{offer._candidature?.status || 'Postulée'}</span>
                              </span>
                            ) : (
                              <span className="rw-not-applied-badge">
                                <Icon name="clock" size={13} />
                                <span>Non postulée</span>
                              </span>
                            )}
                          </td>
                          <td>
                            <span style={{ fontSize: '12px', color: '#475569' }}>
                              {offer.duration || 'N.C.'}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <div style={{ display: 'inline-flex', gap: 5 }}>
                              {offer.url && (
                                <a
                                  href={offer.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="rw-btn-url"
                                  style={{ padding: '4px 8px', fontSize: '11px' }}
                                >
                                  Site ↗
                                </a>
                              )}
                              <button
                                type="button"
                                className="rw-btn-details"
                                style={{ padding: '4px 6px' }}
                                onClick={() => setDrawerOffer(offer)}
                              >
                                <Icon name="fileText" size={13} />
                              </button>
                              {onTransferCandidature && (
                                <button
                                  type="button"
                                  className={`rw-btn-apply ${isApplied ? 'is-applied' : ''}`}
                                  style={{ padding: '4px 8px', fontSize: '11px' }}
                                  onClick={() => onTransferCandidature(offer)}
                                >
                                  <Icon name={isApplied ? 'check' : 'target'} size={12} />
                                </button>
                              )}
                              {onRequeue && (
                                <button
                                  type="button"
                                  className="rw-icon-action requeue"
                                  style={{ width: 28, height: 28 }}
                                  onClick={() => handleRequeue(offer)}
                                >
                                  <Icon name="refresh" size={12} />
                                </button>
                              )}
                              {onDecide && (
                                <button
                                  type="button"
                                  className="rw-icon-action danger"
                                  style={{ width: 28, height: 28 }}
                                  onClick={() => handleReject(offer)}
                                >
                                  <Icon name="trash" size={12} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* --------------------------------------------------------------------
          SLIDE-OVER DRAWER FOR DEEP DESCRIPTION INSPECTION
          -------------------------------------------------------------------- */}
      {drawerOffer && (
        <OfferDetailDrawer
          offer={drawerOffer}
          candidature={drawerOffer._candidature}
          busy={busy}
          onClose={() => setDrawerOffer(null)}
          onDecide={(offer, decision) => {
            if (decision === 'reject') handleReject(offer);
            else if (onDecide) onDecide(offer, decision);
          }}
          onTransferCandidature={onTransferCandidature}
          onRequeue={onRequeue}
        />
      )}

      {/* --------------------------------------------------------------------
          UNDO FLOATING BANNER
          -------------------------------------------------------------------- */}
      {undoToast && (
        <div className="rw-undo-toast" role="status">
          <span>{undoToast.message}</span>
          <button type="button" className="rw-undo-btn" onClick={handleUndo}>
            Annuler
          </button>
          <button type="button" className="rw-undo-close" onClick={() => setUndoToast(null)}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}

export default ResultsView;
