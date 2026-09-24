import React, { useEffect, useState } from 'react';
import { Icon } from '../components/Common/Icons';

const SCAN_PHASES = {
  discover: 'Recherche des candidats',
  analyze: 'Analyse des offres',
  finish: 'Finalisation',
};

const SCAN_STATUSES = {
  queued: 'En attente',
  running: 'En cours',
  completed: 'Terminé',
  failed: 'Échec',
  cancelled: 'Annulé',
};

const SCAN_MODES = [
  ['Rapide', '24 requêtes · 8 sites'],
  ['Complet', '45 requêtes · 16 sites'],
  ['Maximum', '70 requêtes · 25 sites'],
  ['Exhaustif 1h', '240 requêtes · 30 sites'],
];

export function CloudSearchView({ scanJobs, scanEvents, workerReady, onRun, onCancel, onRefresh, busy }) {
  const [mode, setMode] = useState('Rapide');
  const active = scanJobs.find((job) => ['queued', 'running'].includes(job.status));
  return <div className="sh-view">
    <div className="sh-view-header"><div>
      <span className="sh-eyebrow">RECHERCHE & SCAN</span>
      <h1>Scans du profil</h1>
      <p>Les étapes du scan sont enregistrées dans Supabase pour pouvoir reprendre après chaque appel du worker.</p>
    </div></div>
    <section className="sh-form-section">
      <div className="sh-section-header"><div><h2>Lancer un scan</h2>
        <p>Un seul scan actif par profil. Les quatre niveaux réutilisent le moteur de scoring Python.</p>
      </div></div>
      <div className="sh-form-save-bar">
        <select aria-label="Puissance du scan" value={mode} onChange={(event) => setMode(event.target.value)}>
          {SCAN_MODES.map(([value, description]) => <option value={value} key={value}>{value} — {description}</option>)}
        </select>
        <button type="button" className="sh-btn-primary" disabled={!workerReady || busy || !!active}
          onClick={() => onRun(mode)}>Lancer le scan</button>
        {active && <button type="button" className="sh-btn-secondary" disabled={busy || active.cancel_requested}
          onClick={() => onCancel(active.id)}>{active.cancel_requested ? 'Annulation demandée' : 'Annuler le scan'}</button>}
      </div>
      {!workerReady && <p>Le worker Python sera activé après l’ajout des secrets serveur et un essai de reprise.</p>}
      {active && <p>En cours : {active.mode} · {SCAN_PHASES[active.phase] || active.phase} · {active.progress_percent}%</p>}
    </section>
    <section className="sh-form-section">
      <div className="sh-section-header"><div><h2>Historique</h2><p>Scans associés au profil sélectionné.</p></div>
        <button type="button" className="sh-btn-secondary" onClick={onRefresh} disabled={busy}>
          <Icon name="refresh" size={15} /> Actualiser
        </button>
      </div>
      {scanJobs.length ? <div className="cloud-result-list">{scanJobs.map((job) =>
        <div className="cloud-result-row" key={job.id}>
          <strong>{job.mode}{job.summary?.origin === 'local_import' ? ' · Import local' : ''}</strong>
          <span>{SCAN_STATUSES[job.status] || job.status} · {SCAN_PHASES[job.phase] || job.phase}
            {' · '}{job.progress_percent}% · {new Date(job.created_at).toLocaleString('fr-FR')}</span>
          {job.error_message && <small>{job.error_message}</small>}
        </div>)}</div> : <div className="sh-empty-state"><Icon name="search" size={30} />
        <h3>Aucun scan web pour ce profil</h3>
        <p>Les résultats actuels proviennent de tes tests locaux.</p></div>}
    </section>
    {scanEvents.length > 0 && <section className="sh-form-section">
      <div className="sh-section-header"><div><h2>Derniers événements</h2>
        <p>Décisions et progression du dernier scan.</p></div></div>
      <div className="cloud-result-list">{scanEvents.map((event) => <div className="cloud-result-row" key={event.id}>
        <small>{new Date(event.created_at).toLocaleString('fr-FR')}</small><span>{event.message}</span>
      </div>)}</div>
    </section>}
  </div>;
}

export function CloudConnectionsView({ profile, accessToken, onSave, onError, onNotice, busy }) {
  const [status, setStatus] = useState(null);
  const [form, setForm] = useState(profile);
  const [working, setWorking] = useState(false);
  useEffect(() => { setForm(profile); }, [profile]);
  const google = form?.integrations?.google || {};
  const sheetId = /\/spreadsheets\/d\/([\w-]+)/.exec(google.sheet_id || '')?.[1] || google.sheet_id || '';
  const patch = (key, value) => setForm((previous) => ({ ...previous,
    integrations: { ...previous.integrations, google: { ...previous.integrations?.google, [key]: value } } }));

  const request = async (action, method = 'GET', body) => {
    const response = await fetch(`/api/google?action=${action}`, {
      method, headers: { Authorization: `Bearer ${accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok && action !== 'status') throw new Error(data.error || 'Connexion Google indisponible');
    return data;
  };
  const refresh = async () => {
    try { setStatus(await request('status')); }
    catch (error) { onError(error.message); }
  };
  useEffect(() => { if (accessToken) refresh(); }, [accessToken]);
  const run = async (action) => {
    setWorking(true);
    try {
      if (action === 'start') {
        const data = await request('start', 'POST');
        window.location.assign(data.url);
        return;
      }
      if (action === 'disconnect') {
        await request('disconnect', 'POST');
        onNotice('Compte Google déconnecté.');
      } else {
        const data = await request(action, 'POST', { profileId: profile.id });
        if (action === 'create-sheet') onNotice('Google Sheet créé. Son identifiant est enregistré sur ce profil.');
        else onNotice(`${data.exported} offre(s) gardée(s) exportée(s) vers Google Sheets.`);
        if (action === 'create-sheet') setForm((previous) => ({ ...previous, integrations: {
          ...previous.integrations, google: { ...previous.integrations?.google, sheet_id: data.sheetId, sheets_enabled: true } } }));
      }
      await refresh();
    } catch (error) { onError(error.message); }
    finally { setWorking(false); }
  };

  return <div className="sh-view connections-view">
    <div className="sh-view-header"><div>
      <span className="sh-eyebrow">INTÉGRATIONS EXTERNES</span>
      <h1>Google Sheets & Gmail</h1>
      <p>Connecte ton compte Google à ton espace web et choisis les réglages de ce profil.</p>
    </div></div>
    <section className="sh-form-section">
      <div className="sh-section-header"><div><h2>Compte Google</h2>
        <p>{status?.connected ? `Connecté : ${status.email}` : 'Un compte Google est associé à chaque utilisateur.'}</p>
      </div></div>
      {status?.configured === false && <p>La connexion sera disponible après la création du client OAuth Google Web et la configuration des secrets Vercel.</p>}
      {status?.connected ? <button className="sh-btn-secondary" type="button" disabled={working} onClick={() => run('disconnect')}>Déconnecter Google</button>
        : <button className="sh-btn-primary" type="button" disabled={working || !status?.configured} onClick={() => run('start')}>
          <Icon name="external" size={16} /> Autoriser Google</button>}
    </section>
    <section className="sh-form-section">
      <div className="sh-section-header"><div><h2>Paramètres du profil</h2>
        <p>Le document et ses onglets sont propres au profil sélectionné.</p></div></div>
      <div className="sh-toggles-grid">
        <label className="sh-checkbox-card"><input type="checkbox" checked={!!google.sheets_enabled}
          onChange={(event) => patch('sheets_enabled', event.target.checked)} />
          <div><strong>Google Sheets</strong><small>Exporter les offres gardées</small></div></label>
        <label className="sh-checkbox-card"><input type="checkbox" checked={!!google.gmail_enabled}
          onChange={(event) => patch('gmail_enabled', event.target.checked)} />
          <div><strong>Gmail</strong><small>Autoriser la lecture pour les futures analyses des réponses</small></div></label>
      </div>
      <div className="sh-form-grid" style={{ marginTop: '1.5rem' }}>
        <div className="sh-field"><label htmlFor="cloud-sheet-id">Identifiant du Google Sheet</label>
          <input id="cloud-sheet-id" value={google.sheet_id || ''} onChange={(event) => patch('sheet_id', event.target.value)}
            placeholder="ID ou URL du document" /></div>
        <div className="sh-field"><label htmlFor="cloud-sheet-tab">Onglet des offres</label>
          <input id="cloud-sheet-tab" value={google.opportunity_tab || 'Opportunités'}
            onChange={(event) => patch('opportunity_tab', event.target.value)} /></div>
      </div>
      <div className="sh-form-save-bar"><button className="sh-btn-primary" type="button" disabled={busy}
        onClick={() => onSave(form)}><Icon name="check" size={16} /> Enregistrer les paramètres</button></div>
    </section>
    <section className="sh-form-section">
      <div className="sh-section-header"><div><h2>Actions Google Sheets</h2>
        <p>L’export remplace le contenu de l’onglet des offres par la liste actuelle des offres gardées.</p></div></div>
      <div className="sh-form-save-bar">
        <button className="sh-btn-secondary" type="button" disabled={!status?.connected || working}
          onClick={() => run('create-sheet')}>Créer un Google Sheet</button>
        <button className="sh-btn-primary" type="button" disabled={!status?.connected || !google.sheet_id || working}
          onClick={() => run('sync-sheet')}>Exporter les offres gardées</button>
        {sheetId && <a className="sh-btn-secondary" target="_blank" rel="noopener noreferrer"
          href={`https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}`}>Ouvrir le Sheet</a>}
      </div>
    </section>
  </div>;
}

export function CloudAutomationView() {
  return <div className="sh-view automation-view">
    <div className="sh-view-header"><div>
      <span className="sh-eyebrow">AUTOMATISATION</span>
      <h1>Scans programmés</h1>
      <p>Supabase vérifie chaque minute les scans en attente et relance le worker par étapes.</p>
    </div></div>
    <section className="sh-form-section">
      <div className="sh-section-header"><div><h2>Reprise des scans</h2>
        <p>Les tâches Windows restent propres à la version locale.</p></div></div>
      <p>Le déclencheur Supabase n’envoie une requête que lorsqu’un scan doit avancer. Il nécessite le secret partagé entre Supabase Vault et Vercel. Jusqu’à quatre profils peuvent avancer en parallèle.</p>
    </section>
  </div>;
}
