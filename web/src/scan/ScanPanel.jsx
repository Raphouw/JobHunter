import React, { useEffect, useState } from 'react';
import './scan-panel.css';

export function ScanPanel({ controller, snapshot, onDetail }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!['starting', 'running'].includes(snapshot.status)) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [snapshot.status]);
  if (['idle', 'completed', 'cancelled'].includes(snapshot.status)) return null;
  const job = snapshot.job || { mode: snapshot.request?.mode || 'Scan', created_at: new Date(snapshot.initializationStartedAt || now).toISOString() };
  const checkpoint = job.checkpoint || {};
  const totals = checkpoint.telemetry?.totals || {};
  const seconds = Math.max(1, (now - Date.parse(job.created_at)) / 1000);
  const processed = totals.candidates_attempted || checkpoint.analyzed || 0;
  const total = (checkpoint.direct_candidates || 0) + (checkpoint.web_candidates || 0);
  const eta = snapshot.status === 'running' && checkpoint.discovery_complete && processed > 0 && processed < total ? Math.max(0, (total - processed) * seconds / processed) : null;
  const invoke = method => controller[method]().catch(() => {});
  return <section className="sh-browser-scan" aria-label="Scan global" data-initialization-state={snapshot.initializationState} data-initialization-id={snapshot.initializationId}>
    <div className="sh-browser-scan-heading"><strong>{job.mode} · {snapshot.status === 'recoverable' ? 'Scan interrompu détecté' : snapshot.status === 'paused' ? 'En pause' : 'Scan sur cet appareil'}</strong>
      <button className="sh-btn-secondary" onClick={onDetail}>Voir le détail</button></div>
    <progress max="100" value={job.progress_percent || 0} aria-label="Progression du scan" />
    <p>{Math.round(job.progress_percent || 0)} % · {totals.queries || 0}{checkpoint.planned_queries ? ` / ${checkpoint.planned_queries}` : ''} recherches · {snapshot.metrics.pagesFetched} pages · {processed} pistes analysées</p>
    <p>{checkpoint.new_offers || 0} nouvelles · {checkpoint.accepted || 0} pertinentes · {checkpoint.rejected || 0} rejetées · {Math.round(processed * 60 / seconds)} pistes/min</p>
    <p>{snapshot.workers || 0} Worker actif · {Math.floor(seconds / 60)} min{eta !== null ? ` · ≈ ${Math.ceil(eta / 60)} min restantes` : ''}</p>
    {snapshot.error && <p role="alert">{snapshot.error}</p>}
    {(snapshot.status === 'starting' || (snapshot.status === 'running' && !snapshot.workers)) && <p role="status">{snapshot.phaseLabel || 'Préparation du scan…'}</p>}
    <div className="sh-browser-scan-actions">
      {['paused', 'recoverable'].includes(snapshot.status) ? <button className="sh-btn-primary" onClick={() => invoke('resume')}>{snapshot.error ? 'Réessayer' : 'Reprendre'}</button> :
        <button className="sh-btn-secondary" disabled={snapshot.status === 'starting'} onClick={() => invoke('pause')}>Pause</button>}
      <button className="sh-btn-secondary" onClick={() => invoke('cancel')}>{snapshot.status === 'recoverable' ? 'Abandonner' : 'Arrêter'}</button>
    </div>
    <details><summary>Détails et puissance</summary>
      <small>{snapshot.build} · {snapshot.initializationId} · {snapshot.initializationState}</small>
      <p className="sh-browser-scan-phase">{snapshot.phaseLabel || job.phase}</p>
      <label>Utilisation de cet appareil <select value={snapshot.power} onChange={e => controller.setPower(e.target.value)}>
        <option value="eco">Éco</option><option value="normal">Normal</option><option value="fast">Rapide</option><option value="maximum">Maximum</option>
      </select></label>
      <small>Le moteur Python utilise un Worker séquentiel. La puissance règle les lots et leurs pauses. Gardez cet onglet ouvert ; après fermeture ou veille, reprenez le scan.</small>
      <p>{snapshot.metrics.backendRequests} appels backend · {(snapshot.metrics.transferredBytes / 1e6).toFixed(1)} Mo transférés · {(snapshot.metrics.serverCpuMs / 1000).toFixed(2)} s CPU serveur estimées</p>
      <p>{snapshot.metrics.errors} erreurs · {totals.retries || 0} reprises réseau · {totals.filtered_non_public || 0} filtrées · {checkpoint.duplicates || 0} doublons</p>
      <p>{snapshot.metrics.peakJsHeapBytes ? `${Math.round(snapshot.metrics.peakJsHeapBytes / 1e6)} Mo de pic heap JS (hors WASM)` : 'Mémoire non mesurable dans ce navigateur'}</p>
    </details>
  </section>;
}
