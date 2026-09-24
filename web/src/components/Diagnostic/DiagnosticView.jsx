import React, { useMemo, useState } from 'react';
import { Icon } from '../Common/Icons';

function getSourceMeta(domain = '') {
  const d = domain.toLowerCase();
  if (d.includes('linkedin')) {
    return { name: 'LinkedIn', color: '#0a66c2', bg: '#e8f3fc', badge: 'Réseau pro' };
  }
  if (d.includes('jobs.ch') || d.includes('jobup.ch') || d.includes('jobscout')) {
    return { name: 'Swiss Jobs', color: '#e11d48', bg: '#ffe4e6', badge: 'Portail suisse' };
  }
  if (d.includes('iagora')) {
    return { name: 'iAgora', color: '#ea580c', bg: '#ffedd5', badge: 'Stages & Europe' };
  }
  if (d.includes('glassdoor')) {
    return { name: 'Glassdoor', color: '#059669', bg: '#d1fae5', badge: 'Avis & Jobs' };
  }
  if (d.includes('indeed')) {
    return { name: 'Indeed', color: '#2563eb', bg: '#dbeafe', badge: 'Agrégateur' };
  }
  if (d.includes('stepstone')) {
    return { name: 'StepStone', color: '#7c3aed', bg: '#ede9fe', badge: 'Emploi' };
  }
  if (d.includes('jobteaser')) {
    return { name: 'JobTeaser', color: '#0284c7', bg: '#e0f2fe', badge: 'Écoles / Étudiants' };
  }
  return { name: domain, color: '#8b5cf6', bg: '#f5f3ff', badge: 'Site carrière' };
}

export function DiagnosticView({ diagnostic = {}, scan = {} }) {
  const [sourceSearch, setSourceSearch] = useState('');
  const [sortBy, setSortBy] = useState('count'); // count | alpha

  const runtime = diagnostic.runtime || {};
  const funnel = runtime.funnel || diagnostic.stats || {};
  const sources = runtime.source_yield || {};
  const recommendations = runtime.recommendations || [];

  const hasData = Object.keys(diagnostic).length > 0;

  // Process sources data for UI & UX
  const sourceEntries = useMemo(() => {
    const list = Object.entries(sources).map(([domain, data]) => {
      const retained = typeof data === 'object' ? data.retained || 0 : Number(data) || 0;
      const meta = getSourceMeta(domain);
      return { domain, retained, ...meta };
    });

    return list.filter((s) =>
      s.domain.toLowerCase().includes(sourceSearch.toLowerCase()) ||
      s.name.toLowerCase().includes(sourceSearch.toLowerCase())
    );
  }, [sources, sourceSearch]);

  const sortedSources = useMemo(() => {
    const copy = [...sourceEntries];
    if (sortBy === 'count') {
      copy.sort((a, b) => b.retained - a.retained);
    } else {
      copy.sort((a, b) => a.domain.localeCompare(b.domain));
    }
    return copy;
  }, [sourceEntries, sortBy]);

  const maxRetained = useMemo(() => {
    return Math.max(1, ...sourceEntries.map((s) => s.retained));
  }, [sourceEntries]);

  const totalRetainedSources = useMemo(() => {
    return sourceEntries.reduce((acc, s) => acc + s.retained, 0);
  }, [sourceEntries]);

  const topSource = sortedSources[0];

  return (
    <div className="sh-view diagnostic-view">
      <div className="sh-view-header">
        <div>
          <span className="sh-eyebrow">DIAGNOSTIC & PERFORMANCE DU MOTEUR</span>
          <h1>Analyse du dernier scan</h1>
          <p>
            Évaluation détaillée de la performance de recherche, de l’entonnoir de conversion et du
            rendement par plateforme.
          </p>
        </div>
      </div>

      {!hasData ? (
        <div className="sh-empty-state">
          <Icon name="search" size={32} />
          <h3>Aucun diagnostic récent disponible</h3>
          <p>Lance un scan depuis l’onglet Recherche & Scan pour générer le rapport complet.</p>
        </div>
      ) : (
        <>
          {/* Funnel Metrics */}
          <section className="sh-diagnostic-section">
            <div className="sh-section-header">
              <div>
                <h2>Entonnoir de sélection</h2>
                <p>Du volume brut de candidats aux offres validées pour ton profil.</p>
              </div>
            </div>

            <div className="sh-metrics-grid">
              <div className="sh-stat-card card-blue">
                <div className="sh-stat-icon">
                  <Icon name="search" size={24} />
                </div>
                <strong className="sh-stat-val">{diagnostic.input_candidates || 0}</strong>
                <span className="sh-stat-label">Candidats bruts</span>
                <span className="sh-stat-desc">Détectés sur le web & sites fixes</span>
              </div>

              <div className="sh-stat-card card-purple">
                <div className="sh-stat-icon">
                  <Icon name="layers" size={24} />
                </div>
                <strong className="sh-stat-val">{diagnostic.expanded_candidates || 0}</strong>
                <span className="sh-stat-label">Analysés en profondeur</span>
                <span className="sh-stat-desc">Fiches explorées & text extrait</span>
              </div>

              <div className="sh-stat-card card-emerald">
                <div className="sh-stat-icon">
                  <Icon name="check" size={24} />
                </div>
                <strong className="sh-stat-val">{funnel.retained || 0}</strong>
                <span className="sh-stat-label">Offres retenues</span>
                <span className="sh-stat-desc">Compatibles avec tes critères</span>
              </div>

              <div className="sh-stat-card card-pink">
                <div className="sh-stat-icon">
                  <Icon name="x" size={24} />
                </div>
                <strong className="sh-stat-val">{funnel.closed || 0}</strong>
                <span className="sh-stat-label">Offres fermées / hors profil</span>
                <span className="sh-stat-desc">Exclues ou expirées</span>
              </div>
            </div>
          </section>

          {/* Source Yield & Engine Recommendations */}
          <section className="sh-two-col">
            {/* ENHANCED SOURCE YIELD DASHBOARD */}
            <div className="sh-panel sh-panel-yield">
              <div className="sh-panel-head">
                <div>
                  <h3>Rendement par source</h3>
                  <p className="sh-panel-desc">
                    Efficacité de chaque site carrière et job board exploré.
                  </p>
                </div>
                <span className="sh-panel-badge">{sourceEntries.length} sources analysées</span>
              </div>

              {/* Quick Yield Summary KPIs */}
              <div className="sh-yield-kpi-row">
                <div className="sh-yield-mini-kpi">
                  <span>Top source</span>
                  <strong>{topSource ? `${topSource.domain} (${topSource.retained})` : '—'}</strong>
                </div>
                <div className="sh-yield-mini-kpi">
                  <span>Total retenues</span>
                  <strong>{totalRetainedSources} offres</strong>
                </div>
              </div>

              {/* Source Filter & Sort Controls */}
              <div className="sh-source-controls">
                <div className="sh-source-search">
                  <Icon name="search" size={15} />
                  <input
                    type="text"
                    placeholder="Filtrer les sources..."
                    value={sourceSearch}
                    onChange={(e) => setSourceSearch(e.target.value)}
                  />
                </div>
                <div className="sh-source-sort-buttons">
                  <button
                    className={`sh-sort-btn ${sortBy === 'count' ? 'active' : ''}`}
                    onClick={() => setSortBy('count')}
                    title="Trier par nombre d'offres"
                  >
                    Volume
                  </button>
                  <button
                    className={`sh-sort-btn ${sortBy === 'alpha' ? 'active' : ''}`}
                    onClick={() => setSortBy('alpha')}
                    title="Trier par nom"
                  >
                    A-Z
                  </button>
                </div>
              </div>

              {/* Yield Cards List */}
              {sortedSources.length > 0 ? (
                <div className="sh-source-rich-list">
                  {sortedSources.map((item) => {
                    const pct = Math.round((item.retained / maxRetained) * 100);
                    const isTop = item.retained > 10;

                    return (
                      <div key={item.domain} className="sh-source-rich-card">
                        <div className="sh-source-card-top">
                          <div className="sh-source-badge-icon" style={{ background: item.bg, color: item.color }}>
                            {item.name.slice(0, 2).toUpperCase()}
                          </div>
                          <div className="sh-source-card-info">
                            <div className="sh-source-title-row">
                              <strong>{item.domain}</strong>
                              <span className="sh-platform-tag" style={{ color: item.color, background: item.bg }}>
                                {item.badge}
                              </span>
                            </div>
                            <span className="sh-source-url-text">Domaine exploré</span>
                          </div>
                          <div className="sh-source-count-box">
                            <span className="sh-yield-number">{item.retained}</span>
                            <span className="sh-yield-unit">retenue{item.retained > 1 ? 's' : ''}</span>
                          </div>
                        </div>

                        {/* Visual Yield Bar */}
                        <div className="sh-yield-bar-track">
                          <div
                            className={`sh-yield-bar-fill ${isTop ? 'top-fill' : ''}`}
                            style={{ width: `${Math.max(5, pct)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="sh-muted">Aucune source ne correspond à ta recherche.</p>
              )}
            </div>

            {/* Engine Recommendations */}
            <div className="sh-panel">
              <div className="sh-panel-head">
                <div>
                  <h3>Recommandations du moteur</h3>
                  <p className="sh-panel-desc">Conseils d’optimisation calculés par l’algorithme.</p>
                </div>
                <span className="sh-panel-badge">Conseils IA</span>
              </div>

              {recommendations.length > 0 ? (
                <div className="sh-recom-list">
                  {recommendations.map((rec, i) => (
                    <div key={i} className="sh-recom-item">
                      <Icon name="spark" size={17} />
                      <p>{rec}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="sh-recom-empty">
                  <Icon name="check" size={24} />
                  <strong>Recherche optimale</strong>
                  <p>Le moteur n’a détecté aucun point de friction ou blocage sur ce scan.</p>
                </div>
              )}
            </div>
          </section>
        </>
      )}

      {/* Log terminal collapse */}
      {scan.lines && scan.lines.length > 0 && (
        <details className="sh-log-details">
          <summary>Consulter le journal complet du dernier scan</summary>
          <pre className="sh-log-terminal-pre">{scan.lines.join('\n')}</pre>
        </details>
      )}
    </div>
  );
}
