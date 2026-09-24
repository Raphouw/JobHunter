import React from 'react';
import { Icon } from '../Common/Icons';

function getHeroCardData(profile = {}) {
  const student = profile.student || {};
  const target = profile.target || {};
  const location = profile.location || {};

  // 1. Contract type
  const contracts = student.contract_types || [];
  const primaryContract =
    contracts[0] || (student.stage_type ? String(student.stage_type).split(/[\/,]/)[0].trim() : '');

  // 2. Job title (prioritize localized French title or first targeted title)
  const rawTitles = target.job_titles || [];
  const preferredTitle =
    rawTitles.find((t) => /[à-ÿ]/i.test(t) || /stagiaire|ingénieur|alternant|technicien/i.test(t)) ||
    rawTitles[0] ||
    target.sectors?.[0] ||
    'Ingénieur';

  let title = preferredTitle
    .split(/\s+/)
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()))
    .join(' ');

  // Add contract prefix if title does not already mention it
  const lowTitle = title.toLowerCase();
  const lowContract = (primaryContract || '').toLowerCase();
  let heroJobTitle = title;
  if (
    primaryContract &&
    !lowTitle.includes(lowContract) &&
    !lowTitle.includes('stage') &&
    !lowTitle.includes('intern') &&
    !lowTitle.includes('cdd') &&
    !lowTitle.includes('cdi') &&
    !lowTitle.includes('altern')
  ) {
    heroJobTitle = `${primaryContract.toUpperCase()} · ${title}`;
  }

  // 3. Country & region/canton
  const countries = location.countries || [];
  let country = countries[0] || 'Suisse';
  if (country.toLowerCase() === 'switzerland') country = 'Suisse';

  const subLoc =
    location.priority_locations?.[0] ||
    location.priority_cantons?.[0] ||
    location.french_regions?.[0] ||
    '';

  const locStr = subLoc ? `${country} (${subLoc})` : country;

  // 4. Duration or contract details
  let durationOrType = '';
  const minWeeks = Number(student.min_weeks || 0);
  if (minWeeks > 0) {
    const months = Math.round(minWeeks / 4);
    durationOrType = months >= 3 ? `${months} mois` : `${minWeeks} sem.`;
  } else if (contracts.length > 0) {
    durationOrType = contracts.slice(0, 2).join(' / ');
  } else if (primaryContract) {
    durationOrType = primaryContract;
  } else {
    durationOrType = 'Temps plein';
  }

  const heroSubtitle = `${locStr} · ${durationOrType}`;

  return { heroJobTitle, heroSubtitle };
}

export function DashboardView({ profile = {}, stats = {}, scan = {}, featuredOffer = null, onGoToPage }) {
  const studentName = profile.student?.name;
  const firstName = studentName
    ? studentName.trim().split(/\s+/)[0]
    : String(profile.name || '')
        .replace(/profil/i, '')
        .replace(/[—\-].*/, '')
        .trim()
        .split(/\s+/)[0] || 'toi';

  const { heroJobTitle, heroSubtitle } = getHeroCardData(profile);

  const total =
    (stats.pending || 0) + (stats.keep || 0) + (stats.unsure || 0) + (stats.reject || 0);
  const reviewed = total - (stats.pending || 0);
  const progressPct = total > 0 ? Math.round((reviewed / total) * 100) : 0;

  return (
    <div className="sh-view dashboard-view">
      {/* Hero Welcome Card */}
      <section className="sh-hero-banner">
        <div className="sh-hero-content">
          <div className="sh-hero-eyebrow">
            <span>ESPACE DE RECHERCHE ACTIF</span>
            <span className="sh-hero-dot" />
          </div>
          <h1>
            Bonjour {firstName} <span className="sh-wave">✦</span>
          </h1>
          <p>
            {stats.pending > 0
              ? `Tu as ${stats.pending} offre${stats.pending > 1 ? 's' : ''} prête${stats.pending > 1 ? 's' : ''} à être examinée${stats.pending > 1 ? 's' : ''} dans le Swiper. Chaque décision affine ton algorithme.`
              : scan.available === false
                ? 'Toutes les offres actuelles ont été triées ! Le scan web est encore en préparation.'
                : 'Toutes les offres actuelles ont été triées ! Lance un scan pour explorer de nouvelles pistes.'}
          </p>
          <div className="sh-hero-actions">
            <button
              className="sh-btn-hero-primary"
              onClick={() => onGoToPage('swipe')}
            >
              <Icon name="heart" size={18} />
              <span>{stats.pending > 0 ? 'Continuer le Swipe' : 'Ouvrir le Swiper'}</span>
            </button>
            <button
              className="sh-btn-hero-secondary"
              onClick={() => onGoToPage('results')}
            >
              <Icon name="briefcase" size={18} />
              <span>Mes {stats.keep || 0} coups de cœur</span>
            </button>
          </div>
        </div>

        <div className="sh-hero-visual" aria-hidden="true">
          <div className="sh-hero-card-stack">
            <div className="sh-hero-card card-3" />
            <div className="sh-hero-card card-2" />
            <div className="sh-hero-card card-1">
              <span className="sh-hero-badge">✦ MATCH {featuredOffer ? `${Math.round(Number(featuredOffer.score) || 0)}%` : '96%'}</span>
              <strong>{featuredOffer?.title || heroJobTitle}</strong>
              <small>{featuredOffer ? `${featuredOffer.company || 'Entreprise'} · ${featuredOffer.location || 'Lieu à confirmer'}` : heroSubtitle}</small>
            </div>
          </div>
        </div>
      </section>

      {/* Metrics Grid */}
      <section className="sh-dashboard-section">
        <div className="sh-section-header">
          <div>
            <h2>Indicateurs clés</h2>
            <p>Vue d’ensemble de tes opportunités actuelles</p>
          </div>
          <span className="sh-date-badge">
            {new Date().toLocaleDateString('fr-FR', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </span>
        </div>

        <div className="sh-metrics-grid">
          <div className="sh-stat-card card-pink" onClick={() => onGoToPage('swipe')}>
            <div className="sh-stat-icon">
              <Icon name="spark" size={24} />
            </div>
            <strong className="sh-stat-val">{stats.pending || 0}</strong>
            <span className="sh-stat-label">À découvrir</span>
            <span className="sh-stat-desc">En attente de ton tri</span>
          </div>

          <div className="sh-stat-card card-emerald" onClick={() => onGoToPage('results')}>
            <div className="sh-stat-icon">
              <Icon name="heart" size={24} />
            </div>
            <strong className="sh-stat-val">{stats.keep || 0}</strong>
            <span className="sh-stat-label">Coups de cœur</span>
            <span className="sh-stat-desc">Offres gardées</span>
          </div>

          <div className="sh-stat-card card-amber" onClick={() => onGoToPage('swipe')}>
            <div className="sh-stat-icon">
              <Icon name="clock" size={24} />
            </div>
            <strong className="sh-stat-val">{stats.unsure || 0}</strong>
            <span className="sh-stat-label">À revoir</span>
            <span className="sh-stat-desc">Pour décider plus tard</span>
          </div>

          <div className="sh-stat-card card-blue" onClick={() => onGoToPage(scan.cloud ? 'results' : 'connections')}>
            <div className="sh-stat-icon">
              <Icon name="external" size={24} />
            </div>
            <strong className="sh-stat-val">{stats.ready || 0}</strong>
            <span className="sh-stat-label">{scan.cloud ? 'Offres gardées' : 'Prêtes à exporter'}</span>
            <span className="sh-stat-desc">{scan.cloud ? 'Dans mes offres' : 'Vers Google Sheets'}</span>
          </div>
        </div>
      </section>

      {/* Two Column Progress & Quick Actions */}
      <section className="sh-two-col">
        {/* Progress Tracker */}
        <div className="sh-panel">
          <div className="sh-panel-head">
            <h3>Progression du tri</h3>
            <span className="sh-panel-badge">{progressPct}% complété</span>
          </div>
          <p className="sh-panel-desc">
            {reviewed} sur {total} offres découvertes ont été triées.
          </p>
          <div className="sh-progress-bar">
            <div className="sh-progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="sh-progress-footer">
            <span>{stats.pending || 0} restant(es) à voir</span>
            <button className="sh-link-btn" onClick={() => onGoToPage('swipe')}>
              <span>Swiper les offres</span>
              <Icon name="arrow" size={14} />
            </button>
          </div>
        </div>

        {/* Next Step / Scanner Launch */}
        <div className="sh-panel">
          <div className="sh-panel-head">
            <h3>Moteur de recherche</h3>
            {scan.running ? (
              <span className="sh-tag-running">Scan en cours</span>
            ) : (
              <span className="sh-tag-idle">{scan.available === false ? 'En préparation' : 'Moteur prêt'}</span>
            )}
          </div>
          <p className="sh-panel-desc">
            {scan.available === false
              ? 'Les scans web reprendront automatiquement par étapes dès que le worker sera relié.'
              : 'Lance une exploration ciblée sur les sites carrières et agrégateurs selon tes critères.'}
          </p>
          <div className="sh-panel-action-box">
            <button
              className="sh-btn-secondary full-width"
              onClick={() => onGoToPage('search')}
            >
              <Icon name="spark" size={16} />
              <span>{scan.available === false ? 'Voir l’état des scans' : 'Configurer & lancer un scan'}</span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
