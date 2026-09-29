import React, { useEffect, useState } from 'react';
import { supabase, unwrap } from './client';

const STATUS_LABELS = {
  pending: 'En attente', deferred: 'Différé', retry: 'À réessayer',
  accepted: 'Retenu', known: 'Déjà connu', filtered: 'Filtré',
  rejected: 'Écarté', unavailable: 'Inaccessible', unexamined: 'Non examiné',
};

export function RawCandidatesView({ profileId, accessToken, scanJobs = [] }) {
  const [jobId, setJobId] = useState('');
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [availableJobs, setAvailableJobs] = useState(scanJobs);

  useEffect(() => {
    setJobId('');
    setAvailableJobs([]);
    if (!profileId) return undefined;
    let active = true;
    supabase.from('hunter_scan_jobs').select('id,mode,status,created_at')
      .eq('profile_id', profileId).order('created_at', { ascending: false }).limit(100)
      .then((result) => { if (active) setAvailableJobs(unwrap(result) || []); })
      .catch((listError) => { if (active) setError(listError.message); });
    return () => { active = false; };
  }, [profileId]);

  useEffect(() => {
    setJobId(availableJobs[0]?.id || '');
  }, [profileId, availableJobs[0]?.id]);

  useEffect(() => {
    if (!profileId || !accessToken || !jobId) {
      setRows([]); setHasMore(false); return undefined;
    }
    const controller = new AbortController();
    setLoading(true); setError('');
    const query = new URLSearchParams({ profile_id: profileId, job_id: jobId,
      offset: String(offset), status });
    fetch(`/api/candidates?${query}`, {
      headers: { Authorization: `Bearer ${accessToken}` }, signal: controller.signal,
    }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Lecture impossible');
      return data;
    }).then((data) => {
      setRows(data.rows || []);
      setHasMore(!!data.has_more);
    }).catch((fetchError) => {
      if (fetchError.name !== 'AbortError') setError(fetchError.message);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [profileId, accessToken, jobId, offset, status, reload]);

  const changeJob = (value) => { setJobId(value); setOffset(0); };
  return <div className="sh-view sh-raw-candidates">
    <div className="sh-view-header"><div>
      <span className="sh-eyebrow">EXPLORATION DU SCAN</span>
      <h1>Candidats bruts</h1>
      <p>Liens collectés avant et pendant l’analyse, y compris les offres écartées ou différées.</p>
    </div></div>
    <div className="sh-raw-controls">
      <label>Scan
        <select value={jobId} onChange={(event) => changeJob(event.target.value)}>
          {availableJobs.map((job) => <option value={job.id} key={job.id}>
            {new Date(job.created_at).toLocaleString('fr-FR')} · {job.mode} · {job.status}
          </option>)}
        </select>
      </label>
      <label>État
        <select value={status} onChange={(event) => { setStatus(event.target.value); setOffset(0); }}>
          <option value="">Tous</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) =>
            <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <button className="sh-btn-secondary" type="button" disabled={loading}
        onClick={() => setReload((value) => value + 1)}>Actualiser</button>
    </div>
    {error && <p role="alert" className="sh-raw-error">{error}</p>}
    {loading ? <p>Chargement des candidats…</p> : rows.length ?
      <div className="sh-raw-list">{rows.map((row) => {
        const payload = row.payload || {};
        const decision = row.decision || {};
        const link = payload.url || row.canonical_url;
        const safeLink = /^https?:\/\//i.test(link) ? link : null;
        return <details className="sh-raw-card" key={row.id}>
          <summary>
            <span className="sh-raw-status">{STATUS_LABELS[row.status] || row.status}</span>
            <strong>{decision.title || payload.title || link}</strong>
            <small>{payload.source || 'Source inconnue'} · {payload.company || 'Entreprise inconnue'}</small>
          </summary>
          <div className="sh-raw-card-body">
            <p><strong>URL :</strong> {safeLink
              ? <a href={safeLink} target="_blank" rel="noopener noreferrer">{link}</a> : link}</p>
            <p><strong>Découverte :</strong> {new Date(row.created_at).toLocaleString('fr-FR')}</p>
            <p><strong>Dernière mise à jour :</strong> {new Date(row.updated_at).toLocaleString('fr-FR')}</p>
            <p><strong>Motif :</strong> {decision.reason || 'Pas encore de décision'}</p>
            <p><strong>Score :</strong> {decision.score ?? 'Non calculé'} · <strong>Confiance :</strong> {decision.confidence ?? 'Non calculée'}</p>
            <p><strong>Tentatives :</strong> {decision.attempts ?? 0} · <strong>Reports :</strong> {decision.deferrals ?? 0}</p>
            <h4>Données brutes du candidat</h4>
            <pre>{JSON.stringify(payload, null, 2)}</pre>
            <h4>Décision complète</h4>
            <pre>{JSON.stringify(decision, null, 2)}</pre>
          </div>
        </details>;
      })}</div> : <p>Aucun candidat à afficher pour cette page et ce filtre.</p>}
    <div className="sh-raw-pagination">
      <button className="sh-btn-secondary" disabled={loading || offset === 0}
        onClick={() => setOffset(Math.max(0, offset - 50))}>Précédents</button>
      <span>Page {Math.floor(offset / 50) + 1}</span>
      <button className="sh-btn-secondary" disabled={loading || !hasMore}
        onClick={() => setOffset(offset + 50)}>Suivants</button>
    </div>
  </div>;
}
