import React from 'react';
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

export function CloudSearchView({ scanJobs, onRefresh, busy }) {
  return <div className="sh-view">
    <div className="sh-view-header"><div>
      <span className="sh-eyebrow">RECHERCHE & SCAN</span>
      <h1>Scans du profil</h1>
      <p>Le traitement web par étapes est en préparation. Le moteur local reste disponible pour tes essais.</p>
    </div></div>
    <section className="sh-form-section">
      <div className="sh-section-header"><div>
        <h2>Reprise automatique</h2>
        <p>Les étapes, les candidats et l’avancement sont enregistrés dans Supabase.</p>
      </div></div>
      <p>Le lancement sera activé après la connexion du worker Python et la vérification d’un scan interrompu puis repris.</p>
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
  </div>;
}

export function CloudConnectionsView() {
  return <div className="sh-view connections-view">
    <div className="sh-view-header"><div>
      <span className="sh-eyebrow">INTÉGRATIONS EXTERNES</span>
      <h1>Google Sheets & Gmail</h1>
      <p>Les connexions Google du moteur local ne sont pas encore reliées aux comptes web.</p>
    </div></div>
    <section className="sh-form-section">
      <div className="sh-section-header"><div><h2>Connexion par utilisateur</h2>
        <p>Chaque personne devra autoriser son propre compte Google avant d’utiliser Sheets ou Gmail sur le site.</p>
      </div></div>
      <p>La synchronisation reste disponible dans l’application locale. Le site n’enregistre pas de jeton Google pour le moment.</p>
    </section>
  </div>;
}

export function CloudAutomationView() {
  return <div className="sh-view automation-view">
    <div className="sh-view-header"><div>
      <span className="sh-eyebrow">AUTOMATISATION</span>
      <h1>Scans programmés</h1>
      <p>La planification web utilisera Supabase pour reprendre les scans même si le navigateur est fermé.</p>
    </div></div>
    <section className="sh-form-section">
      <div className="sh-section-header"><div><h2>État de la planification</h2>
        <p>Les tâches Windows restent propres à la version locale.</p></div></div>
      <p>Le déclencheur web sera activé avec le worker Python. Aucune tâche de scan automatique n’est active sur le site actuellement.</p>
    </section>
  </div>;
}
