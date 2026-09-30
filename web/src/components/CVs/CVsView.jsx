import React, { useEffect, useMemo, useRef, useState } from 'react';
import { cvRepository } from './cvRepository';
import { editorDocument } from './editorBridge';
import './cvs.css';

export function CVsView({ profileId, userId = 'local', supabase = null }) {
  const repository = useMemo(() => cvRepository({ supabase, userId, profileId }), [supabase, userId, profileId]);
  const [rows, setRows] = useState([]);
  const [active, setActive] = useState(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const frame = useRef(null);
  const snapshot = useRef(null);
  const pending = useRef(new Map());
  const latest = useRef({ active, title });
  latest.current = { active, title };
  const draftKey = id => `jobhunter-cv-draft:${userId}:${profileId}:${id}`;
  const post = (type, extra = {}) => frame.current?.contentWindow?.postMessage({ channel:'job-hunter-cv', type, ...extra }, '*');
  function keepDraft(content, nextTitle = latest.current.title) {
    if (!latest.current.active) return;
    try { sessionStorage.setItem(draftKey(latest.current.active.id), JSON.stringify({ title:nextTitle, content })); }
    catch { /* Saving in the database remains available when browser quota is exhausted. */ }
  }
  async function refresh() { setRows(await repository.list()); }
  async function run(task) {
    setBusy(true); setError(''); setNotice('');
    try { await task(); } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    let cancelled = false;
    setActive(null); setReady(false); setDirty(false); setRows([]); setError('');
    repository.list().then(data => { if (!cancelled) setRows(data); }).catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [repository]);
  useEffect(() => {
    const listener = event => {
      if (event.source !== frame.current?.contentWindow || event.data?.channel !== 'job-hunter-cv') return;
      const message = event.data;
      if (message.type === 'ready') {
        post('init', { title:latest.current.title, data:snapshot.current });
      }
      if (message.type === 'initialized') {
        snapshot.current = message.data; setReady(true);
        if (!latest.current.active?.content) { setDirty(true); keepDraft(message.data); }
      }
      if (message.type === 'change' && JSON.stringify(snapshot.current) !== JSON.stringify(message.data)) {
        snapshot.current = message.data; setDirty(true); keepDraft(message.data);
      }
      if (message.type === 'snapshot') {
        const request = pending.current.get(message.requestId);
        if (request) { pending.current.delete(message.requestId); clearTimeout(request.timer); request.resolve(message.data); }
      }
      if (message.type === 'error') setError(message.message);
      if (message.type === 'render-pdf') {
        setBusy(true);
        import('./pdfExport').then(module => module.exportCvPdf(message))
          .then(() => post('pdf-result'))
          .catch(err => { const message = err.message || 'Le rendu PDF a échoué. Réessaie après avoir enregistré le CV.'; setError(message); post('pdf-result', { error:message }); })
          .finally(() => setBusy(false));
      }
    };
    window.addEventListener('message', listener);
    return () => {
      window.removeEventListener('message', listener);
      for (const request of pending.current.values()) { clearTimeout(request.timer); request.reject(new Error('Éditeur fermé')); }
      pending.current.clear();
    };
  }, [profileId, userId]);
  useEffect(() => {
    if (!dirty) return;
    const unload = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, [dirty]);
  function capture() {
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timer = setTimeout(() => { pending.current.delete(requestId); reject(new Error('L’éditeur ne répond pas. Réessaie la sauvegarde.')); }, 10000);
      pending.current.set(requestId, { resolve, reject, timer });
      post('snapshot', { requestId });
    });
  }
  function open(row) {
    let draft;
    try { draft = JSON.parse(sessionStorage.getItem(draftKey(row.id)) || 'null'); } catch { /* Invalid browser draft. */ }
    snapshot.current = draft?.content || row.content;
    setGeneration(value => value + 1);
    setActive(row); setTitle(draft?.title || row.title); setReady(false); setDirty(Boolean(draft));
    setNotice(draft ? 'Brouillon récupéré : enregistre-le pour le conserver en base.' : '');
  }
  async function save() {
    const cleaned = title.trim();
    if (!cleaned) throw new Error('Donne un titre à ton CV.');
    const content = await capture();
    const saved = await repository.save(active, cleaned, content);
    // Keep edits made during the request as a new draft instead of claiming they are saved.
    const unchanged = JSON.stringify(snapshot.current) === JSON.stringify(content) && latest.current.title.trim() === cleaned;
    setActive(saved);
    if (unchanged) { setDirty(false); try { sessionStorage.removeItem(draftKey(saved.id)); } catch {} }
    await refresh(); setNotice('CV enregistré en base.');
  }
  async function backToLibrary() {
    if (ready) {
      const content = await capture();
      if (JSON.stringify(content) !== JSON.stringify(active.content) || title !== active.title) keepDraft(content);
      else { try { sessionStorage.removeItem(draftKey(active.id)); } catch {} }
    }
    setActive(null); setReady(false); setDirty(false); setNotice('');
    await refresh();
  }
  return <section className={active ? 'cv-library cv-editor-screen' : 'sh-view cv-library'}>
    {active ? <>
      <header className="cv-editor-header">
        <button className="sh-btn-secondary" disabled={busy} onClick={() => run(backToLibrary)}>← Mes CV</button>
        <label>Titre du CV<input disabled={busy} maxLength={120} value={title} onChange={event => {
          setTitle(event.target.value); setDirty(true); keepDraft(snapshot.current, event.target.value); post('title', { title:event.target.value });
        }} /></label>
        <span role="status" className="cv-save-status">{dirty ? 'Modifications à enregistrer' : 'Enregistré'}</span>
        <button className="sh-btn-primary" disabled={busy || !ready} onClick={() => run(save)}>{busy ? 'En cours…' : 'Enregistrer'}</button>
        <button className="sh-btn-secondary" disabled={!ready || busy} onClick={() => post('pdf', { title:title.trim() || active.title })}>Télécharger PDF</button>
      </header>
      {error && <p role="alert" className="cv-error">{error}</p>}
      {notice && <p role="status" className="cv-notice">{notice}</p>}
      <iframe key={`${active.id}:${generation}`} ref={frame} title="Éditeur de CV" className="cv-editor-frame" srcDoc={editorDocument}
        sandbox="allow-scripts allow-downloads allow-modals" />
      <p className="cv-help">Clique sur les textes pour les modifier. Le bouton Charger importe tes anciens fichiers JSON. Enregistre ton CV pour le conserver en base.</p>
    </> : <>
      <div className="cv-library-heading"><div><span className="sh-eyebrow">MON ESPACE</span><h1>Mes CV</h1>
        <p>Toutes tes versions au même endroit. Choisis un CV pour le modifier ou crée-en un nouveau.</p></div>
        <button className="sh-btn-primary" disabled={busy || !profileId} onClick={() => run(async () => {
          const row = await repository.create('Mon CV'); await refresh(); open(row);
        })}>+ Ajouter un CV</button>
      </div>
      {error && <p role="alert" className="cv-error">{error}</p>}
      {notice && <p role="status" className="cv-notice">{notice}</p>}
      <div className="cv-gallery-meta"><span>{rows.length} CV{rows.length > 1 ? ' enregistrés' : ' enregistré'}</span><span>Personnalise chaque version pour tes candidatures</span></div>
      {!rows.length && <div className="cv-empty"><span className="cv-empty-icon" aria-hidden="true">▤</span><h2>Ton prochain CV commence ici</h2><p>Ajoute ton premier CV, personnalise-le dans l’éditeur puis retrouve-le dans cette galerie.</p></div>}
      <div className="cv-gallery" aria-label="CV enregistrés">
        {rows.map(row => <article key={row.id} className="cv-list-item">
          <button className="cv-open" disabled={busy} onClick={() => run(async () => { open(await repository.get(row.id)); })}>
            <div className="cv-card-cover" aria-hidden="true"><div className="cv-paper"><div className="cv-paper-top"><i /><div><b /><b /></div></div><div className="cv-paper-columns"><div><i /><b /><b /><i /><b /></div><div><i /><b /><b /><b /><i /><b /><b /><b /></div></div></div><span className="cv-card-open">Ouvrir le CV ↗</span></div>
            <div className="cv-card-info"><strong>{row.title}</strong><small>Modifié le {new Date(row.updated_at).toLocaleString('fr-FR')}</small></div>
          </button>
          <div className="cv-row-actions"><button disabled={busy} onClick={() => run(async () => {
            const source = await repository.get(row.id);
            await repository.create(`${source.title.slice(0,110)} — copie`, source.content); await refresh();
            setNotice('CV dupliqué.');
          })}>Dupliquer</button><button disabled={busy} onClick={() => setDeleteTarget(row)}>Supprimer</button></div>
        </article>)}
      </div>
    </>}
    {deleteTarget && <div className="cv-dialog-backdrop"><div role="dialog" aria-modal="true" aria-labelledby="cv-delete-title" className="cv-dialog">
      <h2 id="cv-delete-title">Supprimer « {deleteTarget.title} » ?</h2><p>Cette version sera supprimée de la base de données.</p>
      <button className="sh-btn-secondary" onClick={() => setDeleteTarget(null)}>Annuler</button>{' '}
      <button className="sh-btn-primary" disabled={busy} onClick={() => run(async () => {
        await repository.remove(deleteTarget.id);
        try { sessionStorage.removeItem(draftKey(deleteTarget.id)); } catch {}
        if (active?.id === deleteTarget.id) { setActive(null); setDirty(false); }
        setDeleteTarget(null); await refresh();
      })}>Supprimer</button>
    </div></div>}
  </section>;
}
