import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Icon } from '../Common/Icons';
import { descriptionText } from '../Swiper/descriptionText';
import { offerInsights, offerSkills } from '../Swiper/TinderCard';

function getDomain(url) {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (_) {
    return null;
  }
}

export function OfferDetailDrawer({
  offer,
  candidature,
  onClose,
  onDecide,
  onTransferCandidature,
  onRequeue,
  busy = false,
}) {
  const [activeTab, setActiveTab] = useState('recap'); // 'recap' | 'description' | 'specs'

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  if (!offer) return null;

  const { strong, checks } = offerInsights(offer);
  const skills = offerSkills(offer);
  const domain = getDomain(offer.url);
  const score = Math.max(0, Math.min(100, Math.round(Number(offer.score) || 0)));
  const paragraphs = descriptionText(offer.body_preview || offer.body || offer.snippet || '')
    .split(/\n{2,}|\r\n\r\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const isApplied = Boolean(candidature);

  return (
    <AnimatePresence>
      <motion.div
        className="rw-drawer-scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.aside
        className="rw-drawer-aside"
        role="dialog"
        aria-modal="true"
        aria-label={`Détails de ${offer.title || 'l’offre'}`}
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 360, damping: 38 }}
      >
        {/* Header */}
        <div className="rw-drawer-header">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className={`rw-score-pill ${score >= 70 ? 'high' : score >= 45 ? 'mid' : 'low'}`}>
                {score}% Match
              </span>
              {isApplied ? (
                <span className="rw-applied-badge">
                  <Icon name="check" size={13} />
                  <span>Candidature suivie ({candidature.status || 'Envoyée'})</span>
                </span>
              ) : (
                <span className="rw-not-applied-badge">
                  <Icon name="clock" size={13} />
                  <span>Non postulée</span>
                </span>
              )}
              {domain && (
                <span className="rw-spec-chip" title="Source">
                  <Icon name="globe" size={12} />
                  <span>{domain}</span>
                </span>
              )}
            </div>

            <h2 style={{ fontSize: '20px', fontWeight: 850, color: '#0f172a', margin: '4px 0 0 0', lineHeight: 1.3 }}>
              {offer.title || 'Offre sans titre'}
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '13px', color: '#64748b' }}>
              <strong style={{ color: '#1e293b' }}>{offer.company || 'Entreprise'}</strong>
              <span>·</span>
              <span>{offer.location || offer.canton || 'Lieu à confirmer'}</span>
            </div>
          </div>

          <button className="rw-drawer-close" onClick={onClose} aria-label="Fermer le tiroir">
            ×
          </button>
        </div>

        {/* Tab Controls */}
        <div className="rw-inspector-tabs">
          <button
            className={`rw-inspector-tab ${activeTab === 'recap' ? 'active' : ''}`}
            onClick={() => setActiveTab('recap')}
          >
            ✦ Analyse & Récap IA
          </button>
          <button
            className={`rw-inspector-tab ${activeTab === 'description' ? 'active' : ''}`}
            onClick={() => setActiveTab('description')}
          >
            📄 Description du poste ({paragraphs.length})
          </button>
          <button
            className={`rw-inspector-tab ${activeTab === 'specs' ? 'active' : ''}`}
            onClick={() => setActiveTab('specs')}
          >
            ℹ️ Fiche technique
          </button>
        </div>

        {/* Body Content */}
        <div className="rw-drawer-body">
          {activeTab === 'recap' && (
            <>
              {/* Highlight callout */}
              <div className="rw-recap-box" style={{ padding: '16px', gap: '8px' }}>
                <div className="rw-recap-header">
                  <Icon name="spark" size={15} />
                  <span>Synthèse d'adéquation avec ton profil</span>
                </div>
                {strong.length > 0 ? (
                  <ul style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {strong.map((point, i) => (
                      <li key={i} style={{ fontSize: '13px', fontWeight: 650, color: '#1e293b' }}>
                        {point}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
                    Aucune raison détaillée d'affinité extraite pour le moment.
                  </p>
                )}
              </div>

              {/* Warning points */}
              {checks.length > 0 && (
                <div className="rw-drawer-section">
                  <h3 className="rw-drawer-section-title" style={{ color: '#d97706' }}>
                    <Icon name="info" size={16} />
                    <span>Points à vérifier avant de postuler</span>
                  </h3>
                  <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '10px', padding: '12px 16px' }}>
                    <ul style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {checks.map((check, i) => (
                        <li key={i} style={{ fontSize: '12.5px', color: '#92400e' }}>
                          {check}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {/* Skills */}
              <div className="rw-drawer-section">
                <h3 className="rw-drawer-section-title">
                  <Icon name="target" size={16} />
                  <span>Compétences détectées</span>
                </h3>
                <div className="rw-skills-wrap">
                  {skills.length > 0 ? (
                    skills.map((s, i) => (
                      <span key={i} className="rw-skill-tag" style={{ fontSize: '12px', padding: '4px 10px' }}>
                        {s}
                      </span>
                    ))
                  ) : (
                    <span style={{ fontSize: '13px', color: '#94a3b8' }}>Aucune compétence spécifique listée.</span>
                  )}
                </div>
              </div>

              {/* Quick specs pills */}
              <div className="rw-drawer-section">
                <h3 className="rw-drawer-section-title">
                  <Icon name="briefcase" size={16} />
                  <span>Conditions du poste</span>
                </h3>
                <div className="rw-specs-row">
                  {offer.duration && <span className="rw-spec-chip">⏱ Durée : {offer.duration}</span>}
                  {offer.start_date && <span className="rw-spec-chip">📅 Début : {offer.start_date}</span>}
                  {offer.language && <span className="rw-spec-chip">🗣 Langue : {offer.language}</span>}
                  <span className={`rw-spec-chip ${offer.availability_status === 'open' ? 'open' : ''}`}>
                    {offer.availability_status === 'open' ? '✓ Candidature ouverte' : 'À confirmer'}
                  </span>
                </div>
              </div>
            </>
          )}

          {activeTab === 'description' && (
            <div className="rw-drawer-section">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h3 className="rw-drawer-section-title">
                  <Icon name="fileText" size={16} />
                  <span>Texte complet de l'annonce</span>
                </h3>
                {offer.url && (
                  <a
                    href={offer.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rw-btn-url"
                    style={{ fontSize: '11.5px', padding: '4px 8px' }}
                  >
                    <Icon name="external" size={13} />
                    <span>Source originale ↗</span>
                  </a>
                )}
              </div>
              <div className="rw-drawer-prose">
                {paragraphs.length > 0 ? (
                  paragraphs.map((p, i) => <p key={i}>{p}</p>)
                ) : (
                  <p style={{ color: '#94a3b8', fontStyle: 'italic' }}>
                    Aucune description textuelle n'a pu être extraite pour cette annonce. Visitez le lien direct ci-dessous pour voir l'annonce originale.
                  </p>
                )}
              </div>
            </div>
          )}

          {activeTab === 'specs' && (
            <div className="rw-drawer-section">
              <h3 className="rw-drawer-section-title">
                <Icon name="layers" size={16} />
                <span>Métadonnées d'acquisition</span>
              </h3>
              <table className="rw-table" style={{ border: '1px solid #e2e8f0', borderRadius: '10px' }}>
                <tbody>
                  <tr>
                    <td style={{ fontWeight: 750, color: '#64748b', width: '35%' }}>Entreprise</td>
                    <td style={{ fontWeight: 800 }}>{offer.company || 'Inconnue'}</td>
                  </tr>
                  <tr>
                    <td style={{ fontWeight: 750, color: '#64748b' }}>Intitulé exact</td>
                    <td>{offer.title || 'Non renseigné'}</td>
                  </tr>
                  <tr>
                    <td style={{ fontWeight: 750, color: '#64748b' }}>Localisation / Canton</td>
                    <td>{offer.location || offer.canton || 'Suisse'}</td>
                  </tr>
                  {offer.contract_type && <tr><td style={{ fontWeight: 750, color: '#64748b' }}>Contrat</td><td>{offer.contract_type}</td></tr>}
                  {offer.posting_date && <tr><td style={{ fontWeight: 750, color: '#64748b' }}>Date de l’annonce</td><td>{offer.posting_date}</td></tr>}
                  <tr>
                    <td style={{ fontWeight: 750, color: '#64748b' }}>Score de matching</td>
                    <td>{score}%</td>
                  </tr>
                  <tr>
                    <td style={{ fontWeight: 750, color: '#64748b' }}>Source crawler</td>
                    <td>{offer.source || domain || 'Web Scanner'}</td>
                  </tr>
                  {offer.discovered_at && (
                    <tr>
                      <td style={{ fontWeight: 750, color: '#64748b' }}>Détectée le</td>
                      <td>{new Date(offer.discovered_at).toLocaleDateString('fr-FR')}</td>
                    </tr>
                  )}
                  {(offer.application_url || offer.url) && (
                    <tr>
                      <td style={{ fontWeight: 750, color: '#64748b' }}>Lien de candidature</td>
                      <td>
                        <a
                          href={offer.application_url || offer.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: '#2563eb', wordBreak: 'break-all' }}
                        >
                          {offer.application_url || offer.url} ↗
                        </a>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="rw-drawer-footer">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {offer.url && (
              <a
                href={offer.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rw-btn-url"
                style={{ background: '#f8fafc', fontWeight: 800 }}
              >
                <Icon name="external" size={14} />
                <span>{domain ? `Voir sur ${domain}` : "Site officiel"} ↗</span>
              </a>
            )}

            {onTransferCandidature && (
              <button
                type="button"
                className={`rw-btn-apply ${isApplied ? 'is-applied' : ''}`}
                onClick={() => {
                  onTransferCandidature(offer);
                  onClose();
                }}
              >
                <Icon name={isApplied ? 'check' : 'target'} size={14} />
                <span>{isApplied ? 'Fiche candidature' : 'Postuler & Suivre'}</span>
              </button>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {onRequeue && (
              <button
                type="button"
                className="rw-icon-action requeue"
                title="Remettre dans le Swiper"
                disabled={busy}
                onClick={() => {
                  onRequeue({ offer_ids: [offer.id] });
                  onClose();
                }}
              >
                <Icon name="refresh" size={15} />
              </button>
            )}

            {onDecide && (
              <button
                type="button"
                className="rw-icon-action danger"
                title="Rejeter cette offre"
                disabled={busy}
                onClick={() => {
                  onDecide(offer, 'reject');
                  onClose();
                }}
              >
                <Icon name="trash" size={15} />
              </button>
            )}
          </div>
        </div>
      </motion.aside>
    </AnimatePresence>
  );
}
