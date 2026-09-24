import React from 'react';
import { Icon } from '../Common/Icons';
import { descriptionText } from './descriptionText';

function getAvatarGradient(name = '') {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const palettes = [
    ['#7c3aed', '#a855f7'], // Violet / Lilas
    ['#f43f5e', '#fb7185'], // Rose / Saumon
    ['#059669', '#34d399'], // Émeraude
    ['#ea580c', '#fb923c'], // Orange / Pêche
    ['#2563eb', '#60a5fa'], // Bleu roi
    ['#d946ef', '#f472b6'], // Fuchsia / Pivoine
    ['#0891b2', '#22d3ee'], // Cyan lagon
  ];
  const idx = Math.abs(hash) % palettes.length;
  return `linear-gradient(135deg, ${palettes[idx][0]}, ${palettes[idx][1]})`;
}

function getInitials(name = '') {
  const parts = String(name).trim().split(/\s+/).slice(0, 2);
  if (!parts[0]) return 'SH';
  return parts.map((p) => p[0]).join('').toUpperCase();
}

export function TinderCard({
  offer,
  cardRef,
  isFront = false,
  drag = { x: 0, y: 0 },
  isDragging = false,
  flight = '',
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onOpenDetails,
}) {
  if (!offer) return null;

  const score = Math.max(0, Math.min(100, Math.round(Number(offer.score) || 0)));
  const isOpen = offer.availability_status === 'open';

  // Dynamic transforms for front card
  let transform = '';
  let opacity = 1;

  if (flight) {
    if (flight === 'keep') {
      transform = 'translate3d(140%, 15%, 0) rotate(22deg)';
    } else if (flight === 'reject') {
      transform = 'translate3d(-140%, 15%, 0) rotate(-22deg)';
    } else if (flight === 'unsure') {
      transform = 'translate3d(0, 140%, 0) scale(0.92)';
    }
    opacity = 0;
  } else if (isFront) {
    const rotation = drag.x / 20;
    transform = `translate3d(${drag.x}px, ${drag.y}px, 0) rotate(${rotation}deg)`;
  }

  // Stamp opacities
  let keepOpacity = 0;
  let rejectOpacity = 0;
  let unsureOpacity = 0;

  if (isFront && !flight) {
    if (drag.x > 25) {
      keepOpacity = Math.min(1, (drag.x - 25) / 85);
    } else if (drag.x < -25) {
      rejectOpacity = Math.min(1, (-drag.x - 25) / 85);
    } else if (drag.y > 35 && Math.abs(drag.y) > Math.abs(drag.x)) {
      unsureOpacity = Math.min(1, (drag.y - 35) / 75);
    }
  } else if (flight) {
    if (flight === 'keep') keepOpacity = 1;
    if (flight === 'reject') rejectOpacity = 1;
    if (flight === 'unsure') unsureOpacity = 1;
  }

  const tags = [
    offer.location || offer.canton,
    offer.duration,
    offer.start_date ? `Dès ${offer.start_date}` : null,
    offer.language,
    offer.domain_category,
  ].filter(Boolean);

  const reasons = (offer.reasons || '')
    .split('\n')
    .filter(Boolean)
    .slice(0, 3);

  // Excerpt from body or snippet (teaser of job description)
  const excerptRaw = descriptionText(offer.body_preview || offer.body || offer.snippet || '');
  const excerptPlain = excerptRaw.replace(/\s+/g, ' ').trim();
  const excerpt = excerptPlain
    ? excerptPlain.slice(0, 175) + (excerptPlain.length > 175 ? '…' : '')
    : null;

  // SVG Gauge calculations (radius = 24, stroke = 4)
  const radius = 24;
  const circumference = 2 * Math.PI * radius; // ~150.8
  const strokeDashoffset = circumference - (score / 100) * circumference;
  const scoreColor =
    score >= 70
      ? 'var(--accent-love)'
      : score >= 50
      ? 'var(--primary)'
      : 'var(--salmon)';

  return (
    <article
      ref={cardRef}
      className={`tinder-card ${isFront ? 'front' : 'back'} ${isDragging ? 'dragging' : ''} ${flight ? 'flying' : ''}`}
      style={{
        transform,
        opacity,
      }}
      onPointerDown={isFront ? onPointerDown : undefined}
      onPointerMove={isFront ? onPointerMove : undefined}
      onPointerUp={isFront ? onPointerUp : undefined}
      onPointerCancel={isFront ? onPointerUp : undefined}
    >
      {/* Dynamic Action Stamps */}
      <div className="stamp-overlay stamp-keep" style={{ opacity: keepOpacity }}>
        <span>GARDER</span>
      </div>
      <div className="stamp-overlay stamp-reject" style={{ opacity: rejectOpacity }}>
        <span>PASSER</span>
      </div>
      <div className="stamp-overlay stamp-unsure" style={{ opacity: unsureOpacity }}>
        <span>À REVOIR</span>
      </div>

      {/* Card Header */}
      <div className="card-header">
        <div className="card-brand">
          <div
            className="brand-avatar lg"
            style={{ background: getAvatarGradient(offer.company) }}
          >
            {getInitials(offer.company)}
          </div>
          <div className="brand-info">
            <span className="brand-label">ENTREPRISE</span>
            <strong className="brand-name" title={offer.company}>
              {offer.company || 'Entreprise inconnue'}
            </strong>
            <span className="brand-location">
              <Icon name="pin" size={13} />
              {offer.location || offer.canton || 'Lieu à confirmer'}
            </span>
          </div>
        </div>

        {/* Premium SVG Match Gauge */}
        <div
          className="sh-match-gauge-box"
          title={`Score de correspondance : ${score}/100 calculé selon vos critères`}
        >
          <svg className="sh-gauge-svg" width="62" height="62" viewBox="0 0 60 60">
            <defs>
              <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#ec4899" />
                <stop offset="50%" stopColor="#8b5cf6" />
                <stop offset="100%" stopColor="#10b981" />
              </linearGradient>
            </defs>
            {/* Background track circle */}
            <circle
              className="sh-gauge-track"
              cx="30"
              cy="30"
              r={radius}
              strokeWidth="4.5"
            />
            {/* Progress arc */}
            <circle
              className="sh-gauge-bar"
              cx="30"
              cy="30"
              r={radius}
              strokeWidth="4.5"
              stroke={score >= 70 ? 'url(#gaugeGradient)' : scoreColor}
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
            />
          </svg>
          <div className="sh-gauge-center">
            <span className="sh-gauge-num">{score}</span>
            <span className="sh-gauge-pct">%</span>
          </div>
          <span className="sh-gauge-label">MATCH</span>
        </div>
      </div>

      {/* Card Main Body */}
      <div className="card-body">
        {/* Badges Bar */}
        <div className="card-badge-row">
          <span className={`status-pill ${isOpen ? 'open' : 'check'}`}>
            <i />
            {isOpen ? 'Candidature ouverte' : 'Disponibilité à vérifier'}
          </span>
          {offer.source && <span className="source-pill">{offer.source}</span>}

          {/* Swiper Learned Adjustment Badge */}
          {offer.learned_adjustment ? (
            <span
              className="sh-affinity-badge"
              title={`Ajustement Swiper (${offer.learned_adjustment > 0 ? '+' : ''}${offer.learned_adjustment} pts) : calculé selon vos préférences d'offres swipées.`}
            >
              <Icon name="spark" size={13} />
              <span>
                Swiper{' '}
                {offer.learned_adjustment > 0
                  ? `+${offer.learned_adjustment}`
                  : offer.learned_adjustment}
              </span>
            </span>
          ) : null}
        </div>

        {/* Title */}
        <h2 className="card-title" title={offer.title}>
          {offer.title || 'Offre sans titre'}
        </h2>

        {/* Key Info Chips */}
        <div className="card-chips">
          {tags.map((tag, idx) => (
            <span key={idx} className="card-chip">
              {idx === 0 && <Icon name="pin" size={13} />}
              {tag}
            </span>
          ))}
        </div>

        {/* Description Teaser Preview */}
        {excerpt && (
          <div className="card-description-teaser">
            <p>{excerpt}</p>
          </div>
        )}

        {/* Matching Insights */}
        {reasons.length > 0 && (
          <div className="card-insights">
            <div className="insight-title">
              <Icon name="spark" size={14} />
              <span>Pourquoi cette offre correspond à ton profil</span>
            </div>
            <ul className="insight-list">
              {reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Skills detected */}
        {offer.skills_found && (
          <div className="card-skills-row">
            <span className="skills-label">Compétences :</span>
            <div className="skills-chips">
              {offer.skills_found
                .split(/,|\n/)
                .slice(0, 5)
                .map((s, i) => {
                  const clean = s.trim();
                  return clean ? (
                    <span key={i} className="skill-chip">
                      {clean}
                    </span>
                  ) : null;
                })}
            </div>
          </div>
        )}
      </div>

      {/* Card Footer Bar */}
      <div className="card-footer">
        <button
          type="button"
          className="btn-card-details"
          onClick={(e) => {
            e.stopPropagation();
            onOpenDetails(offer);
          }}
        >
          <Icon name="fileText" size={16} />
          <span>Fiche complète & description</span>
        </button>

        {offer.url && (
          <a
            href={offer.url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-card-link"
            onClick={(e) => e.stopPropagation()}
            title="Consulter l'annonce sur le site source"
          >
            <span>Lien officiel</span>
            <Icon name="external" size={14} />
          </a>
        )}
      </div>
    </article>
  );
}
