import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Icon } from '../components/Common/Icons';
import { ColoredTerminal } from '../components/Common/ColoredTerminal';
import { LiveActivityTicker } from '../components/Search/LiveActivityTicker';
import { supabase, unwrap } from './client';

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
    label: 'Rapide · 24 requêtes',
    desc: '24 requêtes, jusqu’à 20 sites et 1 000 pages téléchargées. Le scan reprend automatiquement entre les étapes.',
    badge: 'Express',
    seconds: 900,
  },
  Complet: {
    label: 'Complet · 45 requêtes',
    desc: '45 requêtes et jusqu’à 35 sites, avec exploration récursive et vérification de disponibilité.',
    badge: 'Recommandé',
    seconds: 2400,
  },
  Maximum: {
    label: 'Maximum · 70 requêtes',
    desc: 'Exploration large avec 70 requêtes, jusqu’à 50 sites et 8 workers en parallèle.',
    badge: 'Intensif',
    seconds: 4500,
  },
  'Exhaustif 1h': {
    label: 'Exhaustif',
    desc: 'Exploration profonde avec 240 requêtes et jusqu’à 80 sites, sans coupe-circuit.',
    badge: 'Profondeur max',
    seconds: 9000,
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
  const [mode, setMode] = useState(() => {
    try {
      return localStorage.getItem('jobhunter_cloud_scan_mode') || 'Complet';
    } catch {
      return 'Complet';
    }
  });
  const [elapsed, setElapsed] = useState(0);
  const [autoScroll, setAutoScroll] = useState(true);
  const [downloadError, setDownloadError] = useState('');
  const terminalRef = useRef(null);

  const active = scanJobs.find((job) => ['queued', 'running'].includes(job.status));
  const latestJob = scanJobs[0];
  const isRunning = !!active;

  useEffect(() => {
    if (active?.mode) {
      setMode(active.mode);
      try {
        localStorage.setItem('jobhunter_cloud_scan_mode', active.mode);
      } catch (_) {}
    }
  }, [active?.mode]);

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
  const effectiveMode = active?.mode || mode;
  const expectedSec = MODE_DESCRIPTIONS[effectiveMode]?.seconds || 600;
  const progressPercent = active
    ? (active.progress_percent !== undefined && active.progress_percent !== null
        ? Math.max(6, Math.min(99, active.progress_percent))
        : Math.min(96, Math.max(6, Math.round((elapsed / expectedSec) * 100))))
    : latestJob?.status === 'completed'
    ? 100
    : 0;


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

  const handleDownloadLog = async () => {
    const jobId = active?.id || latestJob?.id;
    if (!jobId) return;
    setDownloadError('');
    try {
      const allEvents = [];
      for (let start = 0; ; start += 1000) {
        const page = unwrap(await supabase.from('hunter_scan_events')
          .select('created_at,level,message').eq('job_id', jobId)
          .order('id', { ascending: true }).range(start, start + 999));
        allEvents.push(...(page || []));
        if (!page || page.length < 1000) break;
      }
      const text = allEvents.map((event) => `[${new Date(event.created_at).toLocaleString('fr-FR')}] ${event.level}: ${event.message}`).join('\n');
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `scan_${jobId}.log`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setDownloadError(error.message || 'Téléchargement du journal impossible');
    }
  };

  const lastEvent = scanEvents && scanEvents.length > 0 ? scanEvents[scanEvents.length - 1] : null;
  const tickerScan = {
    running: isRunning,
    current_action: {
      text: lastEvent ? lastEvent.message : (isRunning ? `Phase : ${SCAN_PHASES[active?.phase] || active?.phase}...` : ''),
      type: active?.phase === 'discover' ? 'search' : active?.phase === 'analyze' ? 'analyze' : 'browse',
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
            const isSelected = effectiveMode === key;
            return (
              <button
                key={key}
                type="button"
                className={`sh-mode-card ${isSelected ? 'selected' : ''}`}
                onClick={() => {
                  if (isRunning) return;
                  setMode(key);
                  try {
                    localStorage.setItem('jobhunter_cloud_scan_mode', key);
                  } catch (_) {}
                }}
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
            onClick={() => onRun(effectiveMode)}
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
                <span>Lancer le scan ({effectiveMode})</span>
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
          <div className="sh-telemetry-header">
            <div>
              <h2>Suivi du scan</h2>
              {isRunning && active && (
                <span className="sh-scan-phase-pill">
                  {SCAN_PHASES[active.phase] || active.phase || 'En cours'}
                </span>
              )}
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
          {downloadError && <p role="alert" className="sh-history-error-msg">{downloadError}</p>}

          {/* Progress & Time Stats Card */}
          <div className="sh-progress-dashboard-card">
            <div className="sh-progress-row-info">
              <div className="sh-timer-box">
                <span className="sh-timer-label">TEMPS ÉCOULÉ</span>
                <strong className="sh-timer-val">{formatDuration(elapsed)}</strong>
              </div>

              {isRunning && (
                <div className="sh-timer-box">
                  <span className="sh-timer-label">ÉTAPE ACTUELLE</span>
                  <strong className="sh-timer-val">{SCAN_PHASES[active?.phase] || active?.phase}</strong>
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

          {/* Real-time Ticker & Colored Terminal */}
          <div className="sh-terminal-wrapper">
            <LiveActivityTicker scan={tickerScan} mode={effectiveMode} />
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
              const isCompleted = job.status === 'completed';
              const hasSummary = Boolean(job.summary && typeof job.summary.new !== 'undefined');
              const retainedCount = job.summary?.new ?? 0;
              const rejectedCount = job.summary?.rejected;
              const deferredCount = job.summary?.deferred;
              const unavailableCount = job.summary?.temporarily_unavailable;
              const totalCandidates = job.summary?.metrics?.funnel?.input_candidates
                ?? (job.summary?.direct_candidates !== undefined || job.summary?.web_candidates !== undefined
                  ? (job.summary?.direct_candidates || 0) + (job.summary?.web_candidates || 0)
                  : undefined);

              return (
                <div className="sh-scan-history-card" key={job.id}>
                  <div className="sh-scan-card-header">
                    <div className="sh-scan-card-header-main">
                      <strong className="sh-scan-history-mode">{job.mode}</strong>
                      {job.summary?.origin === 'local_import' && (
                        <span className="sh-scan-origin-tag">Import local</span>
                      )}
                      <span className={`sh-status-tag ${statusClass}`}>
                        {SCAN_STATUSES[job.status] || job.status}
                      </span>
                    </div>

                    <div className="sh-scan-card-header-meta">
                      <span className="sh-scan-card-date">
                        {new Date(job.created_at).toLocaleString('fr-FR', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      <span className="sh-scan-card-phase-pill">
                        {job.status === 'running'
                          ? `${SCAN_PHASES[job.phase] || job.phase} (${job.progress_percent}%)`
                          : `${job.progress_percent}% complété`}
                      </span>
                    </div>
                  </div>

                  {hasSummary && (
                    <div className="sh-scan-card-stats">
                      <div className={`sh-stat-chip ${retainedCount > 0 ? 'retained-success' : 'retained-zero'}`}>
                        <span className="sh-stat-chip-label">Offres retenues</span>
                        <strong className="sh-stat-chip-val">
                          {retainedCount > 0 ? `+${retainedCount}` : '0'}
                        </strong>
                      </div>

                      {rejectedCount !== undefined && (
                        <div className="sh-stat-chip neutral">
                          <span className="sh-stat-chip-label">Écartées après examen</span>
                          <strong className="sh-stat-chip-val">{rejectedCount}</strong>
                        </div>
                      )}

                      {totalCandidates !== undefined && totalCandidates > 0 && (
                        <div className="sh-stat-chip neutral">
                          <span className="sh-stat-chip-label">Candidats explorés</span>
                          <strong className="sh-stat-chip-val">{totalCandidates}</strong>
                        </div>
                      )}

                      {deferredCount !== undefined && deferredCount > 0 && (
                        <div className="sh-stat-chip deferred">
                          <span className="sh-stat-chip-label">Pistes en réserve</span>
                          <strong className="sh-stat-chip-val">{deferredCount}</strong>
                        </div>
                      )}

                      {unavailableCount !== undefined && unavailableCount > 0 && (
                        <div className="sh-stat-chip unavailable">
                          <span className="sh-stat-chip-label">Inaccessibles</span>
                          <strong className="sh-stat-chip-val">{unavailableCount}</strong>
                        </div>
                      )}
                    </div>
                  )}

                  {isCompleted && hasSummary && retainedCount === 0 && (
                    <div className="sh-scan-notice info">
                      <Icon name="info" size={14} />
                      <span>
                        Toutes les pistes analysées lors de ce scan étaient des doublons déjà présents dans ta base ou hors critères. Aucune nouvelle offre n'a été ajoutée.
                      </span>
                    </div>
                  )}

                  {job.summary?.partial_reason && (
                    <div className="sh-scan-notice warning">
                      <Icon name="alert" size={14} />
                      <span>
                        Scan partiel : {job.summary.partial_reason}
                        {deferredCount > 0 ? ` — Les ${deferredCount} pistes non examinées restent en réserve pour les prochains scans.` : ''}
                      </span>
                    </div>
                  )}

                  {job.error_message && (
                    <div className="sh-scan-notice error">
                      <Icon name="alert" size={14} />
                      <span>{job.error_message}</span>
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
