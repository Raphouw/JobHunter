import React, { useMemo, useState, useEffect } from 'react';
import { Icon } from '../Common/Icons';
import { OfferDetailDrawer } from './OfferDetailDrawer';
import { OfferScore } from './OfferScore';
import { offerInsights, offerSkills } from '../Swiper/TinderCard';
import './ResultsView.css';

function getOfferApplication(offer, candidatures) {
  return candidatures.find((item) => item.offer_id && offer.id && String(item.offer_id) === String(offer.id))
    || candidatures.find((item) => !item.offer_id && item.company && offer.company
      && item.company.trim().toLowerCase() === offer.company.trim().toLowerCase()
      && item.title && offer.title && item.title.trim().toLowerCase() === offer.title.trim().toLowerCase())
    || null;
}

function scanDate(offer) {
  const date = new Date(offer.discovered_at || offer.created_at || '');
  return Number.isNaN(date.getTime()) ? 'Date inconnue' : date.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function ResultsView({ results = [], profileId, busy = false, onDecide, onRequeue, onCommand, onExport, onTransferCandidature, candidatures = [] }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('not_applied');
  const [drawerOffer, setDrawerOffer] = useState(null);
  const [undoToast, setUndoToast] = useState(null);
  const [pendingId, setPendingId] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!undoToast) return;
    const timer = setTimeout(() => setUndoToast(null), 6000);
    return () => clearTimeout(timer);
  }, [undoToast]);
  const offers = useMemo(() => results.filter((offer) => offer.review_decision !== 'reject').map((offer) => ({ ...offer, _candidature: getOfferApplication(offer, candidatures) })), [results, candidatures]);
  const appliedCount = offers.filter((offer) => offer._candidature).length;
  const visible = useMemo(() => offers.filter((offer) => Boolean(offer._candidature) === (filter === 'applied')
    && `${offer.title || ''} ${offer.company || ''} ${offer.location || ''} ${offer.skills_found || ''}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0)), [offers, filter, query]);
  async function reject(offer) {
    if (!onDecide || pendingId !== null) return;
    setPendingId(offer.id); setError('');
    try {
      await onDecide(offer, 'reject');
      setUndoToast({ offer, previousDecision: offer.review_decision || 'keep' });

      if (drawerOffer?.id === offer.id) setDrawerOffer(null);
    } catch { setError('Impossible de mettre cette offre à la poubelle. Réessaie.'); }
    finally { setPendingId(null); }
  }
  async function undo() {
    if (!undoToast || pendingId !== null) return;
    setPendingId(undoToast.offer.id);
    try { await onDecide(undoToast.offer, undoToast.previousDecision); setUndoToast(null); }
    catch { setError('Impossible de restaurer cette offre. Réessaie.'); }
    finally { setPendingId(null); }
  }
  return <div className="results-workspace saved-offers">
    <header className="so-header">
      <div><span className="so-eyebrow">TES OPPORTUNITÉS</span><h1>Mes offres</h1><p>Les bonnes pistes, au même endroit.</p></div>
      <div className="so-tools">
        {onExport ? <button onClick={() => onExport(results)}><Icon name="download" size={16} /> Exporter CSV</button>
          : <a href={`/api/export-csv?profile=${encodeURIComponent(profileId || '')}`} download><Icon name="download" size={16} /> Exporter CSV</a>}
        {onCommand && <button disabled={busy} onClick={() => onCommand('review-sync')}>Sync Sheets</button>}
      </div>
    </header>
    <div className="so-toolbar">
      <div className="so-tabs" aria-label="Statut des candidatures">
        {[['not_applied', 'À postuler', offers.length - appliedCount], ['applied', 'Déjà postulé', appliedCount]].map(([id, label, count]) =>
          <button key={id} aria-pressed={filter === id} className={filter === id ? 'active' : ''} onClick={() => { setFilter(id); }}>{label}<span>{count}</span></button>)}
      </div>
      <label className="so-search"><Icon name="search" size={17} /><input aria-label="Rechercher une offre" placeholder="Métier, entreprise, compétence…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    </div>
    <div className="so-count">{visible.length} offre{visible.length > 1 ? 's' : ''} · Meilleurs scores en premier</div>
    {error && <p role="alert" className="so-error">{error}</p>}
    <div className="so-grid">
      {visible.map((offer) => {
        const { strong, checks } = offerInsights(offer);
        const skills = offerSkills(offer).slice(0, 3);
        const score = Math.max(0, Math.min(100, Math.round(Number(offer.score) || 0)));
        const disabled = busy || pendingId !== null;
        return <article key={offer.id} className={`so-card ${offer._candidature ? 'is-applied' : ''}`}>
          <button className="so-card-toggle" aria-haspopup="dialog" aria-label={`Afficher la description de ${offer.title || 'cette offre'}`} onClick={() => setDrawerOffer(offer)} />
          <div className="so-card-top">
            <div className="so-identity" tabIndex={0} aria-label="Intitulé et conditions du poste" onClick={() => setDrawerOffer(offer)}><h2>{offer.title || 'Offre sans titre'}</h2><p className="so-company">{offer.company || 'Entreprise non précisée'} · {[offer.location || offer.canton, offer.country].filter(Boolean).join(' · ') || 'Lieu non précisé'}</p><p className="so-contract">{[offer.contract_type, offer.duration].filter(Boolean).join(' · ') || 'Contrat et durée à confirmer'}</p></div>
            <OfferScore score={score} />
          </div>
          <div className="so-domains" tabIndex={0} aria-label="Domaines du poste" onClick={() => setDrawerOffer(offer)}>{skills.length ? skills.map((skill) => <span key={skill}>{skill}</span>) : <span>Domaine à préciser</span>}</div>
          <div className="so-insights" tabIndex={0} aria-label="Points clés avec ton profil" onClick={() => setDrawerOffer(offer)}><span className="so-section-label"><Icon name="spark" size={15} /> POINTS CLÉS AVEC TON PROFIL</span>
            {strong.length ? <ul>{strong.slice(0, 3).map((line, index) => <li key={index}><Icon name="check" size={14} /><span>{line}</span></li>)}</ul> : <p>Les points de correspondance ne sont pas encore disponibles.</p>}
            {checks.length > 0 && <p className="so-check">À vérifier : {checks[0]}</p>}
          </div>
          {onDecide && <button className="so-trash so-hover-trash" aria-label={`Mettre ${offer.title || 'cette offre'} à la poubelle`} title="Mettre à la poubelle" disabled={disabled} onClick={() => reject(offer)}><Icon name="trash" size={16} /></button>}
          <footer className="so-footer"><div className="so-footer-actions">
            {onTransferCandidature && <button className="so-apply" disabled={disabled || Boolean(offer._candidature)} onClick={() => onTransferCandidature(offer)}>{offer._candidature ? 'Déjà postulé' : 'Postuler'}<Icon name={offer._candidature ? 'check' : 'external'} size={13} /></button>}
            {offer.url && <a href={offer.url} target="_blank" rel="noopener noreferrer">Site <Icon name="external" size={12} /></a>}
            <button onClick={() => setDrawerOffer(offer)}>Description</button>
          </div><span className="so-scan">Scan · {scanDate(offer)}</span></footer>
        </article>;
      })}
    </div>
    {!visible.length && <div className="so-empty"><Icon name="briefcase" size={30} /><h2>{query ? 'Aucune offre correspondante' : filter === 'applied' ? 'Pas encore de candidature' : 'Aucune offre à postuler'}</h2><p>{query ? 'Essaie un autre métier ou une autre entreprise.' : 'Tes offres apparaîtront ici au fil de ta recherche.'}</p></div>}
    {drawerOffer && <OfferDetailDrawer offer={drawerOffer} candidature={drawerOffer._candidature} busy={busy || pendingId !== null} onClose={() => setDrawerOffer(null)} onDecide={onDecide ? (offer, decision) => decision === 'reject' ? reject(offer) : onDecide(offer, decision) : undefined} onTransferCandidature={onTransferCandidature} onRequeue={onRequeue} initialTab="description" />}
    {undoToast && <div className="rw-undo-toast" role="status"><span>Offre mise à la poubelle.</span><button disabled={pendingId !== null} className="rw-undo-btn" onClick={undo}>Annuler</button><button className="rw-undo-close" aria-label="Fermer" onClick={() => setUndoToast(null)}>×</button></div>}
  </div>;
}
export default ResultsView;

