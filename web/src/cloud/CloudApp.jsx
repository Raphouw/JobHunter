import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Common/Icons';
import { TinderDeck } from '../components/Swiper/TinderDeck';
import { ProfileView } from '../components/Profile/ProfileView';
import { DashboardView } from '../components/Dashboard/DashboardView';
import { ResultsView } from '../components/Results/ResultsView';
import { DiagnosticView } from '../components/Diagnostic/DiagnosticView';
import { CandidaturesView } from '../components/Candidatures/CandidaturesView';
import { CloudSearchView, CloudConnectionsView, CloudAutomationView } from './CloudFeatureViews';
import { DeleteProfileDialog, ProfileSwitcher } from './ProfileSwitcher';
import { supabase, unwrap } from './client';

const EMPTY_CONFIG = {
  student: { contract_types: ['Internship'], min_weeks: 20 },
  target: { job_titles: [], sectors: [], red_flags: [] },
  location: { countries: [], acceptable_language: ['fr', 'en'], priority_cantons: [] },
  skills: { core: [], strong_domains: [] },
  interests: { professional: [] },
  search: {},
  sources: { packs: [] },
};

const NAV_ITEMS = [
  ['dashboard', 'Vue d’ensemble', 'spark'],
  ['swipe', 'Swiper les offres', 'heart'],
  ['results', 'Mes offres', 'briefcase'],
  ['candidatures', 'Candidatures & Carte', 'map'],
  ['profile', 'Mon profil', 'building'],
  ['search', 'Recherche & Scan', 'search'],
  ['diagnostic', 'Diagnostic', 'layers'],
  ['connections', 'Connexions Google', 'external'],
  ['automation', 'Automatisation', 'clock'],
];

function exportOffersCsv(rows) {
  const fields = ['score', 'company', 'title', 'location', 'duration', 'language', 'review_decision', 'url'];
  const cell = (value) => {
    const safe = String(value ?? '').replace(/^[\s\t]*[=+\-@]/, (match) => `'${match}`);
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const csv = [fields.join(';'), ...rows.map((row) => fields.map((field) => cell(row[field])).join(';'))].join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = 'job-hunter-offres.csv'; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Login({ onError }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      unwrap(await supabase.auth.signInWithPassword({ email: email.trim(), password }));
    } catch (error) {
      onError(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cloud-login-shell">
      <form className="cloud-login-card" onSubmit={submit}>
        <span className="sh-eyebrow">JOB HUNTER</span>
        <h1>Connexion à ton espace</h1>
        <p>Chaque membre dispose de ses propres profils et de ses propres offres.</p>
        <label htmlFor="cloud-email">Adresse e-mail</label>
        <input id="cloud-email" type="email" autoComplete="username" required
          value={email} onChange={(event) => setEmail(event.target.value)} />
        <label htmlFor="cloud-password">Mot de passe</label>
        <input id="cloud-password" type="password" autoComplete="current-password" required
          value={password} onChange={(event) => setPassword(event.target.value)} />
        <button className="sh-btn-primary" disabled={busy} type="submit">
          {busy ? 'Connexion…' : 'Se connecter'}
        </button>
        <small>Accès réservé aux comptes créés par l’administrateur.</small>
      </form>
    </div>
  );
}

function parseCustomDate(str) {
  if (!str) return null;
  const match = String(str).match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
  if (match) {
    const [, d, m, y] = match;
    const timeMatch = String(str).match(/(\d{1,2}):(\d{1,2})/);
    const h = timeMatch ? parseInt(timeMatch[1], 10) : 12;
    const min = timeMatch ? parseInt(timeMatch[2], 10) : 0;
    return new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10), h, min);
  }
  const iso = new Date(str);
  return isNaN(iso.getTime()) ? null : iso;
}

export function CloudApp() {
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [profiles, setProfiles] = useState([]);
  const [profileId, setProfileId] = useState('');
  const [offers, setOffers] = useState([]);
  const [scanJobs, setScanJobs] = useState([]);
  const [scanEvents, setScanEvents] = useState([]);
  const [workerReady, setWorkerReady] = useState(false);
  const [page, setPage] = useState('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [newName, setNewName] = useState('');
  const [lastDecision, setLastDecision] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteOfferCount, setDeleteOfferCount] = useState(null);
  const [candidatures, setCandidatures] = useState([]);
  const [prefillCandidature, setPrefillCandidature] = useState(null);
  const [googleConnected, setGoogleConnected] = useState(false);

  // Auto-dismiss notices and errors
  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(''), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!error) return undefined;
    const timer = window.setTimeout(() => setError(''), 6000);
    return () => window.clearTimeout(timer);
  }, [error]);

  // Check Google connection status
  useEffect(() => {
    if (!session?.access_token) return;
    fetch('/api/google?action=status', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((r) => r.json())
      .then((res) => setGoogleConnected(!!res.connected))
      .catch(() => setGoogleConnected(false));
  }, [session?.access_token]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data, error: authError }) => {
      if (authError) setError(authError.message);
      setSession(data?.session || null);
      setAuthReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        setProfiles([]); setOffers([]); setProfileId(''); setCandidatures([]);
      }
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const loadProfiles = useCallback(async () => {
    if (!session?.user?.id) return;
    try {
      const rows = unwrap(await supabase.from('hunter_profiles')
        .select('id,name,config').order('created_at')) || [];
      setProfiles(rows);
      setProfileId((previous) => rows.some((row) => row.id === previous) ? previous : rows[0]?.id || '');
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [session?.user?.id]);

  useEffect(() => { loadProfiles(); }, [loadProfiles]);

  useEffect(() => {
    if (!session) return;
    fetch('/api/scan').then((result) => result.json()).then((status) => setWorkerReady(!!status.ready))
      .catch(() => setWorkerReady(false));
  }, [session?.user?.id]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const google = url.searchParams.get('google');
    if (!google) return;
    setPage('connections');
    if (google === 'connected') { setNotice('Compte Google connecté.'); setGoogleConnected(true); }
    else if (google === 'denied') setError('L’autorisation Google a été refusée.');
    else setError('La connexion Google a échoué. Réessaie depuis la page Connexions Google.');
    url.searchParams.delete('google');
    window.history.replaceState({}, '', url);
  }, []);

  const loadCandidatures = useCallback(async () => {
    if (!profileId || !session?.user?.id) {
      setCandidatures([]);
      return;
    }
    try {
      const res = await supabase
        .from('hunter_candidatures')
        .select('*')
        .eq('profile_id', profileId)
        .order('created_at', { ascending: false });
      if (!res.error && res.data) {
        setCandidatures(res.data);
        localStorage.setItem(`sh_candidatures_${profileId}`, JSON.stringify(res.data));
        return;
      }
    } catch (_) {}
    const cached = localStorage.getItem(`sh_candidatures_${profileId}`);
    if (cached) {
      try {
        setCandidatures(JSON.parse(cached));
      } catch (_) {}
    }
  }, [profileId, session?.user?.id]);

  const loadData = useCallback(async () => {
    if (!profileId) { setOffers([]); setScanJobs([]); setScanEvents([]); setCandidatures([]); return; }
    try {
      loadCandidatures();
      const [offerRows, jobRows] = await Promise.all([
        supabase.from('hunter_offers').select('*').eq('profile_id', profileId)
          .order('score', { ascending: false }).limit(1000),
        supabase.from('hunter_scan_jobs')
          .select('id,mode,status,phase,progress_percent,attempt_count,cancel_requested,created_at,finished_at,summary,error_message')
          .eq('profile_id', profileId)
          .order('created_at', { ascending: false }).limit(10),
      ]);
      setOffers(unwrap(offerRows) || []);
      const jobs = unwrap(jobRows) || [];
      setScanJobs(jobs);
      if (jobs[0]) {
        const events = unwrap(await supabase.from('hunter_scan_events').select('id,created_at,level,message')
          .eq('job_id', jobs[0].id).order('id', { ascending: true }).limit(250));
        setScanEvents(events || []);
      } else setScanEvents([]);
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [profileId, loadCandidatures]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (page !== 'search' || !profileId) return undefined;
    const isScanning = scanJobs.some((j) => ['queued', 'running'].includes(j.status));
    const timer = window.setInterval(loadData, isScanning ? 2500 : 15000);
    return () => window.clearInterval(timer);
  }, [loadData, page, profileId, scanJobs]);

  const run = async (operation, success) => {
    setBusy(true); setError('');
    try { await operation(); if (success) setNotice(success); }
    catch (operationError) { setError(operationError.message); }
    finally { setBusy(false); }
  };

  const createProfile = (name) => {
    if (!name.trim()) return;
    run(async () => {
      unwrap(await supabase.from('hunter_profiles').insert({
        user_id: session.user.id, name: name.trim(), config: EMPTY_CONFIG,
      }));
      setNewName('');
      await loadProfiles();
    }, 'Profil créé.');
  };

  const submitNewProfile = (event) => { event.preventDefault(); createProfile(newName); };

  const prepareDeleteProfile = async (target) => {
    setError('');
    try {
      const [offerCount, activeJobs] = await Promise.all([
        supabase.from('hunter_offers').select('id', { count: 'exact', head: true }).eq('profile_id', target.id),
        supabase.from('hunter_scan_jobs').select('id').eq('profile_id', target.id)
          .in('status', ['queued', 'running']).limit(1),
      ]);
      unwrap(offerCount); unwrap(activeJobs);
      if (activeJobs.data?.length) {
        setError('Ce profil possède un scan actif. Annule-le ou attends sa fin avant de supprimer le profil.');
        return;
      }
      setDeleteOfferCount(offerCount.count);
      setDeleteTarget(target);
    } catch (deleteError) { setError(deleteError.message); }
  };

  const deleteProfile = () => run(async () => {
    if (!deleteTarget) return;
    const targetId = deleteTarget.id;
    const activeJobs = unwrap(await supabase.from('hunter_scan_jobs').select('id')
      .eq('profile_id', targetId).in('status', ['queued', 'running']).limit(1));
    if (activeJobs?.length) throw new Error('Un scan a démarré sur ce profil. Annule-le avant de supprimer le profil.');
    const deleted = unwrap(await supabase.from('hunter_profiles').delete()
      .eq('id', targetId).select('id'));
    if (!deleted?.length) throw new Error('La suppression du profil n’a pas été confirmée par la base de données.');
    setDeleteTarget(null);
    setDeleteOfferCount(null);
    await loadProfiles();
    if (targetId === profileId) { setOffers([]); setScanJobs([]); setLastDecision(null); }
  }, 'Profil et données associées supprimés.');

  const saveProfile = (form) => run(async () => {
    const { id, name, ...config } = form;
    unwrap(await supabase.from('hunter_profiles')
      .update({ name, config }).eq('id', profileId));
    await loadProfiles();
  }, 'Profil enregistré.');

  const saveCandidature = (data) => run(async () => {
    const now = new Date();
    const candId = data.id || `cand_${Date.now()}`;
    const payload = {
      ...data,
      id: candId,
      user_id: session.user.id,
      profile_id: profileId,
      updated_at: now.toISOString(),
    };
    if (!data.id) {
      payload.created_at = now.toISOString();
      const day = String(now.getDate()).padStart(2, '0');
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const year = now.getFullYear();
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      payload.status_history = [{
        date: `${day}/${month}/${year} ${hours}:${minutes}`,
        status: data.status || 'Demande initiale',
        text: `[${day}/${month}/${year} ${hours}:${minutes}] 🔄 Statut initial : ${data.status || 'Demande initiale'}`,
      }];
      payload.notes = [];
    }

    try {
      await supabase.from('hunter_candidatures').upsert(payload);
    } catch (err) {
      console.warn('hunter_candidatures storage:', err.message);
    }

    setCandidatures((prev) => {
      const next = prev.some((c) => c.id === candId)
        ? prev.map((c) => (c.id === candId ? { ...c, ...payload } : c))
        : [payload, ...prev];
      localStorage.setItem(`sh_candidatures_${profileId}`, JSON.stringify(next));
      return next;
    });
  }, data.id ? 'Candidature modifiée.' : 'Nouvelle candidature enregistrée.');

  const updateCandidatureStatus = (candId, newStatus) => {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const timestamp = `[${day}/${month}/${year} ${hours}:${minutes}]`;
    const autoNote = `${timestamp} 🔄 Statut passé à : ${newStatus}`;

    setCandidatures((prev) => {
      const next = prev.map((c) => {
        if (c.id !== candId) return c;
        const prevHistory = c.status_history || [];
        const lastEntry = prevHistory[prevHistory.length - 1];
        let deltaDays = 0;
        if (lastEntry) {
          const lastDate = parseCustomDate(lastEntry.date) || parseCustomDate(c.created_at);
          if (lastDate) deltaDays = Math.max(0, Math.floor((now - lastDate) / (1000 * 60 * 60 * 24)));
        }
        const updatedHistory = [
          ...prevHistory,
          { date: `${day}/${month}/${year} ${hours}:${minutes}`, status: newStatus, text: autoNote, delta_days: deltaDays },
        ];
        const updated = {
          ...c,
          status: newStatus,
          status_history: updatedHistory,
          updated_at: now.toISOString(),
        };
        supabase.from('hunter_candidatures').upsert(updated).catch(() => {});
        return updated;
      });
      localStorage.setItem(`sh_candidatures_${profileId}`, JSON.stringify(next));
      return next;
    });
    setNotice(`Statut mis à jour : ${newStatus}`);
  };

  const addCandidatureNote = (candId, note) => {
    setCandidatures((prev) => {
      const next = prev.map((c) => {
        if (c.id !== candId) return c;
        const updated = {
          ...c,
          notes: [...(c.notes || []), note],
          updated_at: new Date().toISOString(),
        };
        supabase.from('hunter_candidatures').upsert(updated).catch(() => {});
        return updated;
      });
      localStorage.setItem(`sh_candidatures_${profileId}`, JSON.stringify(next));
      return next;
    });
    setNotice('Mémo Post-it épinglé.');
  };

  const deleteCandidature = (candId) => run(async () => {
    try {
      await supabase.from('hunter_candidatures').delete().eq('id', candId);
    } catch (_) {}
    setCandidatures((prev) => {
      const next = prev.filter((c) => c.id !== candId);
      localStorage.setItem(`sh_candidatures_${profileId}`, JSON.stringify(next));
      return next;
    });
  }, 'Candidature supprimée.');

  const syncGoogleSheets = () => run(async () => {
    const res = await fetch('/api/google?action=sync-sheet', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ profileId, candidatures }),
    });
    if (!res.ok) throw new Error(`Erreur sync Sheets HTTP ${res.status}`);
    const data = await res.json();
    return data;
  }, 'Synchronisation réussie avec Google Sheets (Opportunités & Réponses).');

  const pullGoogleSheets = () => run(async () => {
    const res = await fetch('/api/google?action=pull-sheet', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ profileId }),
    });
    if (!res.ok) throw new Error(`Erreur import Sheets HTTP ${res.status}`);
    const data = await res.json();
    if (data.candidatures && data.candidatures.length > 0) {
      setCandidatures((prev) => {
        const existingNames = new Set(prev.map((c) => (c.company || '').toLowerCase().trim()));
        const toAdd = data.candidatures.filter((c) => !existingNames.has((c.company || '').toLowerCase().trim()));
        const merged = [...prev, ...toAdd];
        localStorage.setItem(`sh_candidatures_${profileId}`, JSON.stringify(merged));
        toAdd.forEach((c) => {
          supabase.from('hunter_candidatures').upsert({
            ...c,
            user_id: session.user.id,
            profile_id: profileId,
          }).catch(() => {});
        });
        return merged;
      });
      setNotice(`${data.candidatures.length} candidatures chargées depuis Google Sheets.`);
    } else {
      setNotice('Aucune nouvelle candidature trouvée dans le Sheet.');
    }
  });

  const transferOfferToCandidature = (offer) => {
    setPrefillCandidature(offer);
    goToPage('candidatures');
  };

  const startScan = (mode) => run(async () => {
    if (!workerReady) throw new Error('Le worker Python doit être configuré avant le lancement.');
    if (scanJobs.some((job) => ['queued', 'running'].includes(job.status)))
      throw new Error('Un scan est déjà actif sur ce profil.');
    const jobs = unwrap(await supabase.from('hunter_scan_jobs').insert({
      user_id: session.user.id, profile_id: profileId, mode,
    }).select('id'));
    await loadData();
    if (jobs?.[0]?.id) {
      fetch('/api/scan', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jobs[0].id }) })
        .then(() => loadData()).catch(() => {});
    }
  }, 'Scan ajouté à la file. Le traitement démarre et reprendra automatiquement.');

  const cancelScan = (jobId) => run(async () => {
    unwrap(await supabase.from('hunter_scan_jobs').update({ cancel_requested: true })
      .eq('id', jobId).eq('profile_id', profileId));
    await loadData();
  }, 'Annulation demandée.');

  const decide = async (offer, decision) => {
    setBusy(true); setError('');
    try {
      const previous = offer.review_decision;
      unwrap(await supabase.from('hunter_offers').update({
        review_decision: decision,
        reviewed_at: decision === 'pending' ? null : new Date().toISOString(),
      }).eq('id', offer.id).eq('profile_id', profileId));
      setLastDecision({ id: offer.id, previous });
      await loadData();
    } catch (decisionError) { setError(decisionError.message); }
    finally { setBusy(false); }
  };

  const undo = async () => {
    if (!lastDecision) return;
    setBusy(true); setError('');
    try {
      unwrap(await supabase.from('hunter_offers').update({
        review_decision: lastDecision.previous,
        reviewed_at: lastDecision.previous === 'pending' ? null : new Date().toISOString(),
      }).eq('id', lastDecision.id).eq('profile_id', profileId));
      setLastDecision(null);
      await loadData();
    } catch (undoError) { setError(undoError.message); }
    finally { setBusy(false); }
  };

  const requeue = ({ all_unsure, offer_ids }) => run(async () => {
    let query = supabase.from('hunter_offers')
      .update({ review_decision: 'pending', reviewed_at: null }).eq('profile_id', profileId);
    if (all_unsure) query = query.eq('review_decision', 'unsure');
    else if (offer_ids?.length) query = query.in('id', offer_ids);
    else return;
    unwrap(await query);
    await loadData();
  }, 'Offres remises dans le Swiper.');

  const stats = useMemo(() => {
    const result = { pending: 0, keep: 0, unsure: 0, reject: 0 };
    offers.forEach((offer) => { if (offer.review_decision in result) result[offer.review_decision] += 1; });
    return result;
  }, [offers]);
  const activeProfile = profiles.find((row) => row.id === profileId);
  const profile = useMemo(() => activeProfile
    ? { ...EMPTY_CONFIG, ...activeProfile.config, id: activeProfile.id, name: activeProfile.name }
    : null, [activeProfile]);
  const latestScan = scanJobs[0];
  const scan = { cloud: true, available: workerReady, running: ['queued', 'running'].includes(latestScan?.status) };
  const dashboardStats = { ...stats, ready: stats.keep };
  const latestCompleted = scanJobs.find((job) => job.status === 'completed' && job.summary?.metrics);
  const metrics = latestCompleted?.summary?.metrics;
  const diagnostic = metrics ? {
    input_candidates: metrics.funnel?.input_candidates || 0,
    expanded_candidates: metrics.funnel?.expanded_candidates || 0,
    stats: metrics.funnel || {},
    runtime: metrics,
  } : {};
  const urgentCount = useMemo(() => {
    const now = new Date();
    return candidatures.filter((c) => {
      const s = String(c.status || '').toLowerCase();
      if (!(s.includes('initiale') || s.includes('envoy') || !s)) return false;
      const d = parseCustomDate(c.created_at);
      if (!d) return false;
      return Math.floor((now - d) / (1000 * 60 * 60 * 24)) >= 10;
    }).length;
  }, [candidatures]);

  const goToPage = (nextPage) => { setPage(nextPage); setMobileMenuOpen(false); };

  if (!authReady) return <div className="cloud-login-shell">Chargement…</div>;
  return (
    <>
      {error && <div className="sh-toast error" role="alert">{error}<button onClick={() => setError('')}>×</button></div>}
      {notice && <div className="sh-toast success" role="status">{notice}<button onClick={() => setNotice('')}>×</button></div>}
      {!session ? <Login onError={setError} /> : (
        <div className="sh-app">
          <aside className={`sh-sidebar ${mobileMenuOpen ? 'open' : ''}`}>
            <div className="sh-sidebar-brand"><div className="sh-brand-badge"><Icon name="spark" size={22} /></div>
              <div className="sh-brand-text"><strong>stage<span>hunter</span></strong><small>Ton prochain match pro</small></div>
            </div>
            <nav className="sh-sidebar-nav" aria-label="Menu principal">
              <span className="sh-nav-group-label">NAVIGATION</span>
              {NAV_ITEMS.map(([id, label, icon]) => (
                <button key={id} className={`sh-nav-item ${page === id ? 'active' : ''}`}
                  onClick={() => goToPage(id)}><Icon name={icon} size={18} /><span>{label}</span>
                  {id === 'swipe' && stats.pending > 0 && <span className="sh-nav-badge">{stats.pending}</span>}
                  {id === 'candidatures' && urgentCount > 0 && <span className="sh-nav-badge urgent" title="Relances urgentes">{urgentCount}</span>}
                </button>
              ))}
            </nav>
            <div className="sh-sidebar-bottom">
              <div className="sh-promo-card"><div className="sh-promo-star">✦</div>
                <strong>Dating App Mode</strong><p>Glisse, découvre et sauvegarde les offres adaptées à ton profil.</p>
                <button className="sh-promo-btn" onClick={() => goToPage('swipe')}>
                  <span>Ouvrir le Swiper</span><Icon name="arrow" size={14} /></button>
              </div>
              <div className="sh-sidebar-footer"><span>STAGE HUNTER</span><span className="sh-version-tag">WEB</span></div>
            </div>
          </aside>
          <div className="sh-main-wrapper">
            <header className="sh-topbar">
              <button className="sh-mobile-toggle" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                aria-label="Ouvrir le menu"><Icon name="menu" size={22} /></button>
              <div className="sh-breadcrumbs"><span>Stage Hunter</span><span className="sh-sep">/</span>
                <strong>{NAV_ITEMS.find(([id]) => id === page)?.[1] || 'Accueil'}</strong></div>
              <div className="sh-topbar-actions">
                <div className={`sh-scan-status-pill ${scan.running ? 'active' : ''}`}>
                  <span className="sh-scan-dot" /><span>{scan.running ? 'Scan en cours' : workerReady ? 'Moteur prêt' : 'Moteur à configurer'}</span>
                </div>
                <ProfileSwitcher profiles={profiles} activeId={profileId} onSelect={setProfileId}
                  onCreate={createProfile} onDelete={prepareDeleteProfile} busy={busy} />
                <button className="sh-btn-secondary" onClick={() => supabase.auth.signOut()}>Déconnexion</button>
              </div>
            </header>
            <main className="sh-content">
              {!profile ? <section className="sh-view">
                <h1>Créer mon premier profil</h1>
                <p>Chaque profil et ses offres seront visibles uniquement depuis ton compte.</p>
                <form className="cloud-create-form" onSubmit={submitNewProfile}>
                  <input aria-label="Nom du profil" placeholder="Nom du profil" required maxLength={120}
                    value={newName} onChange={(event) => setNewName(event.target.value)} />
                  <button className="sh-btn-primary" disabled={busy}>Créer</button>
                </form>
              </section> : <>
                {page === 'dashboard' && <DashboardView profile={profile} stats={dashboardStats}
                  scan={scan} featuredOffer={offers[0]} onGoToPage={goToPage} />}
                {page === 'swipe' && <TinderDeck offers={offers.filter((offer) => offer.review_decision === 'pending')}
                  stats={stats} busy={busy} onDecide={decide} onUndo={undo} onRequeue={requeue}
                  onGoToPage={goToPage} onTransferCandidature={transferOfferToCandidature} />}
                {page === 'results' && <ResultsView results={offers.filter((offer) => ['keep', 'unsure'].includes(offer.review_decision))}
                  profileId={profileId} busy={busy} onDecide={decide} onRequeue={requeue} onExport={exportOffersCsv}
                  onTransferCandidature={transferOfferToCandidature} candidatures={candidatures} />}
                {page === 'candidatures' && <CandidaturesView
                  candidatures={candidatures}
                  profileId={profileId}
                  busy={busy}
                  onSaveCandidature={saveCandidature}
                  onUpdateStatus={updateCandidatureStatus}
                  onAddNote={addCandidatureNote}
                  onDeleteCandidature={deleteCandidature}
                  onSyncGoogleSheets={syncGoogleSheets}
                  onPullGoogleSheets={pullGoogleSheets}
                  googleConnected={googleConnected}
                  prefillFromOffer={prefillCandidature}
                  onClearPrefill={() => setPrefillCandidature(null)}
                />}
                {page === 'profile' && <div className="sh-view"><ProfileView profile={profile} onSave={saveProfile} busy={busy} />
                  <section className="sh-form-section"><div className="sh-section-header"><div>
                    <h2>Mes profils de recherche</h2><p>Chaque profil possède ses critères et ses offres.</p>
                  </div></div>
                    <form className="cloud-create-form" onSubmit={submitNewProfile}>
                      <input aria-label="Nouveau profil" placeholder="Ajouter un autre profil" required maxLength={120}
                        value={newName} onChange={(event) => setNewName(event.target.value)} />
                      <button className="sh-btn-secondary" disabled={busy}>Ajouter</button>
                    </form>
                  </section>
                </div>}
                {page === 'search' && <CloudSearchView scanJobs={scanJobs} scanEvents={scanEvents}
                  workerReady={workerReady} onRun={startScan} onCancel={cancelScan}
                  onRefresh={loadData} busy={busy} />}
                {page === 'diagnostic' && <DiagnosticView diagnostic={diagnostic} scan={scan} />}
                {page === 'connections' && <CloudConnectionsView profile={profile} accessToken={session.access_token}
                  onSave={saveProfile} onError={setError} onNotice={setNotice} busy={busy} />}
                {page === 'automation' && <CloudAutomationView />}
              </>}
            </main>
          </div>
          <DeleteProfileDialog profile={deleteTarget} count={deleteOfferCount} busy={busy}
            onCancel={() => setDeleteTarget(null)} onConfirm={deleteProfile} />
        </div>
      )}
    </>
  );
}

export default CloudApp;
