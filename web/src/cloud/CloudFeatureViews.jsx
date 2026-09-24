import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Icon } from '../components/Common/Icons';
import { ColoredTerminal } from '../components/Common/ColoredTerminal';
import { LiveActivityTicker } from '../components/Search/LiveActivityTicker';

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

const MODE_DESCRIPTIONS = {
  Rapide: {
    label: 'Rapide (2-5 min)',
    desc: 'Un aperçu rapide avec 24 requêtes et 8 sites fixés. Idéal pour un contrôle quotidien.',
    badge: 'Express',
    seconds: 180,
  },
  Complet: {
    label: 'Complet (10-15 min)',
    desc: 'Le meilleur équilibre avec 45 requêtes, exploration récursive et vérification de disponibilité.',
    badge: 'Recommandé',
    seconds: 600,
  },
  Maximum: {
    label: 'Maximum (25-35 min)',
    desc: 'Exploration large avec 70 requêtes, 25 sites fixés et 8 workers en parallèle.',
    badge: 'Intensif',
    seconds: 1500,
  },
  'Exhaustif 1h': {
    label: 'Exhaustif 1h',
    desc: 'Scan complet de 60 minutes sans coupe-circuit. Explore les pistes les plus profondes.',
    badge: 'Profondeur max',
    seconds: 3600,
  },
};

function formatDuration(totalSeconds = 0) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${hrs}h ${mins.toString().padStart(2, '0')}m ${secs.toString().padStart(2, '0')}s`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function CloudSearchView({ scanJobs = [], scanEvents = [], workerReady = false, onRun, onCancel, onRefresh, busy = false }) {
  const [mode, setMode] = useState('Complet');
  const [elapsed, setElapsed] = useState(0);
  const [autoScroll, setAutoScroll] = useState(true);
  const terminalRef = useRef(null);

  const active = scanJobs.find((job) => ['queued', 'running'].includes(job.status));
  const latestJob = scanJobs[0];
  const isRunning = !!active;

  // 1-second client timer for active scan
  useEffect(() => {
    if (!active) {
      setElapsed(0);
      return undefined;
    }
    const startEpoch = active.created_at ? new Date(active.created_at).getTime() : Date.now();
    const tick = () => {
      setElapsed(Math.max(0, Math.floor((Date.now() - startEpoch) / 1000)));
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [active?.id, active?.created_at]);

  // Expected duration & progress calculation
  const currentMode = active ? active.mode : mode;
  const expectedSec = MODE_DESCRIPTIONS[currentMode]?.seconds || 600;
  const progressPercent = active
    ? (active.progress_percent !== undefined && active.progress_percent !== null
        ? Math.max(6, Math.min(99, active.progress_percent))
        : Math.min(96, Math.max(6, Math.round((elapsed / expectedSec) * 100))))
    : latestJob?.status === 'completed'
    ? 100
    : 0;

  const etaRemainingSec = Math.max(0, Math.round(expectedSec * (1 - (progressPercent / 100))));

  // Format scan events for ColoredTerminal
  const terminalLines = useMemo(() => {
    return (scanEvents || []).map((e) => {
      const d = e.created_at ? new Date(e.created_at) : new Date();
      const timeStr = `[${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}]`;
      return `${timeStr} ${e.message}`;
    });
  }, [scanEvents]);

  // Auto-scroll terminal
  useEffect(() => {
    if (autoScroll && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [terminalLines, autoScroll]);

  const handleDownloadLog = () => {
    const text = terminalLines.join('\n') || (latestJob ? `Scan ${latestJob.id}\nStatus: ${latestJob.status}` : 'Aucun log');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scan_${active?.id || latestJob?.id || 'log'}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const lastEvent = scanEvents && scanEvents.length > 0 ? scanEvents[scanEvents.length - 1] : null;
  const tickerScan = {
    running: isRunning,
    current_action: {
      text: lastEvent ? lastEvent.message : (isRunning ? `Phase : ${SCAN_PHASES[active?.phase] || active?.phase}...` : 'Moteur prêt pour le prochain scan'),
      type: active?.phase === 'discover' ? 'search' : active?.phase === 'analyze' ? 'analyze' : 'spark',
      timestamp: lastEvent?.created_at ? new Date(lastEvent.created_at).toLocaleTimeString('fr-FR') : '',
    }
  };

  return (
    <div className="sh-view search-view">
      <div className="sh-view-header">
        <div>
          <span className="sh-eyebrow">MOTEUR DE RECHERCHE</span>
          <h1>Exploration & Télémétrie en direct</h1>
          <p>
            Lance l'exploration des plateformes carrières avec suivi de progression en temps réel,
            estimation du temps restant et console en direct.
          </p>
        </div>
      </div>

      {/* Mode Selection Grid */}
      <section className="sh-search-section">
        <div className="sh-section-header">
          <div>
            <h2>1. Choisis la puissance du scan</h2>
            <p>Sélectionne la durée et le nombre de sources explorées.</p>
          </div>
        </div>

        <div className="sh-mode-grid">
          {Object.entries(MODE_DESCRIPTIONS).map(([key, meta]) => {
            const isSelected = mode === key;
            return (
              <button
                key={key}
                type="button"
                className={`sh-mode-card ${isSelected ? 'selected' : ''}`}
                onClick={() => setMode(key)}
                disabled={isRunning}
              >
                <div className="sh-mode-top">
                  <strong>{meta.label}</strong>
                  {meta.badge && <span className={`sh-mode-badge ${meta.badge.toLowerCase().replace(/\s+/g, '-')}`}>{meta.badge}</span>}
                </div>
                <p>{meta.desc}</p>
                <div className="sh-mode-radio">
                  <span className={`sh-radio-dot ${isSelected ? 'checked' : ''}`} />
                  <span>{isSelected ? 'Sélectionné' : 'Choisir'}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Scan Action Bar */}
        <div className="sh-scan-launch-bar">
          <button
            type="button"
            className={`sh-btn-launch ${isRunning ? 'running' : ''}`}
            onClick={() => onRun(mode)}
            disabled={!workerReady || busy || isRunning}
          >
            {isRunning ? (
              <>
                <span className="sh-spinner" />
                <span>Scan en cours d'exécution ({active.mode})...</span>
              </>
            ) : (
              <>
                <Icon name="play" size={18} />
                <span>Lancer le scan ({mode})</span>
              </>
            )}
          </button>

          {active && (
            <button
              type="button"
              className="sh-btn-secondary sh-btn-cancel-scan"
              onClick={() => onCancel(active.id)}
              disabled={busy || active.cancel_requested}
            >
              <Icon name="x" size={16} />
              <span>{active.cancel_requested ? 'Annulation demandée...' : 'Annuler le scan'}</span>
            </button>
          )}

          {active?.created_at && (
            <span className="sh-scan-meta">
              Démarré à {new Date(active.created_at).toLocaleTimeString('fr-FR')}
            </span>
          )}

          {!workerReady && (
            <span className="sh-scan-meta-warning">
              Worker Python en cours d’initialisation...
            </span>
          )}
        </div>
      </section>

      {/* ACTIVE SCAN PROGRESS & TELEMETRY */}
      {(isRunning || latestJob) && (
        <section className="sh-search-section sh-telemetry-section">
          {/* Live Activity Ticker */}
          <LiveActivityTicker scan={tickerScan} mode={active?.mode || latestJob?.mode || mode} />

          <div className="sh-telemetry-header">
            <div>
              <h2>Suivi du scan</h2>
              <span className="sh-scan-phase-pill">
                <i className={isRunning ? 'pulse' : ''} />
                {active
                  ? (SCAN_PHASES[active.phase] || active.phase)
                  : (latestJob ? (SCAN_STATUSES[latestJob.status] || latestJob.status) : 'Prêt')}
              </span>
            </div>
            {terminalLines.length > 0 && (
              <button
                type="button"
                className="sh-btn-download-log"
                onClick={handleDownloadLog}
                title="Télécharger l'intégralité du journal de scan"
              >
                <Icon name="download" size={15} />
                <span>Télécharger le journal</span>
              </button>
            )}
          </div>

          {/* Progress & Time Stats Card */}
          <div className="sh-progress-dashboard-card">
            <div className="sh-progress-row-info">
              <div className="sh-timer-box">
                <span className="sh-timer-label">TEMPS ÉCOULÉ</span>
                <strong className="sh-timer-val">{formatDuration(elapsed)}</strong>
              </div>

              {isRunning && (
                <div className="sh-timer-box">
                  <span className="sh-timer-label">ESTIMATION RESTANTE (ETA)</span>
                  <strong className="sh-timer-val">~ {formatDuration(etaRemainingSec)}</strong>
                </div>
              )}

              <div className="sh-timer-box right">
                <span className="sh-timer-label">AVANCEMENT ESTIMÉ</span>
                <strong className="sh-timer-val">{progressPercent}%</strong>
              </div>
            </div>

            <div className="sh-main-progress-track">
              <div
                className={`sh-main-progress-bar ${isRunning ? 'animated' : ''}`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {/* Real-time Colored Terminal */}
          <div className="sh-terminal-wrapper">
            <ColoredTerminal
              lines={terminalLines}
              autoScroll={autoScroll}
              setAutoScroll={setAutoScroll}
              terminalRef={terminalRef}
              onDownloadLog={handleDownloadLog}
            />
          </div>
        </section>
      )}

      {/* History Section */}
      <section className="sh-search-section">
        <div className="sh-section-header">
          <div>
            <h2>Historique des scans</h2>
            <p>Historique des explorations associées au profil sélectionné.</p>
          </div>
          <button type="button" className="sh-btn-secondary" onClick={onRefresh} disabled={busy}>
            <Icon name="refresh" size={15} />
            <span>Actualiser</span>
          </button>
        </div>

        {scanJobs.length > 0 ? (
          <div className="cloud-result-list">
            {scanJobs.map((job) => {
              const statusClass = job.status === 'completed' ? 'success' : job.status === 'failed' ? 'error' : job.status === 'running' ? 'running' : 'queued';
              return (
                <div className="cloud-result-row" key={job.id}>
                  <div className="cloud-result-title">
                    <strong className="sh-scan-history-mode">{job.mode}{job.summary?.origin === 'local_import' ? ' · Import local' : ''}</strong>
                    <span className={`sh-status-tag ${statusClass}`}>
                      {SCAN_STATUSES[job.status] || job.status}
                    </span>
                  </div>
                  <div className="cloud-result-meta">
                    <span>Phase : {SCAN_PHASES[job.phase] || job.phase}</span>
                    <span>·</span>
                    <span>Progression : {job.progress_percent}%</span>
                    <span>·</span>
                    <span>{new Date(job.created_at).toLocaleString('fr-FR')}</span>
                    {job.summary?.new !== undefined && (
                      <>
                        <span>·</span>
                        <strong className="sh-history-offers-count">{job.summary.new} offre(s) retenue(s)</strong>
                      </>
                    )}
                  </div>
                  {job.error_message && (
                    <div className="sh-history-error-msg">
                      <Icon name="alert" size={14} />
                      <small>{job.error_message}</small>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="sh-empty-state">
            <Icon name="search" size={32} />
            <h3>Aucun scan pour ce profil</h3>
            <p>Choisis un mode ci-dessus et lance ton premier scan d’opportunités.</p>
          </div>
        )}
      </section>
    </div>
  );
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
