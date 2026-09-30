import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Common/Icons';
import { TinderDeck } from '../components/Swiper/TinderDeck';
import { ProfileView } from '../components/Profile/ProfileView';
import { DashboardView } from '../components/Dashboard/DashboardView';
import { ResultsView } from '../components/Results/ResultsView';
import { DiagnosticView } from '../components/Diagnostic/DiagnosticView';
import { ApplicationsAtlas } from '../design-lab/ApplicationsAtlas';
import { CloudSearchView, CloudConnectionsView, CloudAutomationView } from './CloudFeatureViews';
import { RawCandidatesView } from './RawCandidatesView';
import { SiteConfigEditor } from './SiteConfigEditor';
import { DeleteProfileDialog, ProfileSwitcher } from './ProfileSwitcher';
import { supabase, unwrap } from './client';

const EMPTY_CONFIG = {
  student: { stage_type: 'stage / internship', contract_types: ['Internship'], min_weeks: 20 },
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
  ['candidates', 'Candidats bruts', 'layers'],
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

function reviewIdentity(offer) {
  const normalize = (value) => String(value || '').normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return {
    company: normalize(offer.company), title: normalize(offer.title),
    city: normalize(String(offer.location || '').split(',')[0]),
  };
}

function matchesRejectedOffer(offer, rejected) {
  const item = reviewIdentity(offer);
  if (!item.company || !item.title) return false;
  return rejected.some((prior) => {
    const previous = reviewIdentity(prior);
    return item.company === previous.company && item.title === previous.title
      && (!item.city || !previous.city || item.city === previous.city);
  });
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
  const [page, setPage] = useState(() => {
    if (window.location.pathname.replace(/\/$/, '') === '/design-lab/applications-map-v2') return 'candidatures';
    const hash = window.location.hash.slice(1);
    return NAV_ITEMS.some(([id]) => id === hash) || hash === 'sites' ? hash : 'dashboard';
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const userEmail = (session?.user?.email || '').trim().toLowerCase();
  const isOwner = ['confituresmc@gmail.com', 'raph.brassart@gmail.com'].includes(userEmail);

  const navItems = useMemo(() => {
    const list = [
      ['dashboard', 'Vue d’ensemble', 'spark'],
      ['swipe', 'Swiper les offres', 'heart'],
      ['results', 'Mes offres', 'briefcase'],
      ['candidatures', 'Candidatures & Carte', 'map'],
      ['profile', 'Mon profil', 'building'],
      ['search', 'Recherche & Scan', 'search'],
      ['candidates', 'Candidats bruts', 'layers'],
      ['diagnostic', 'Diagnostic', 'layers'],
      ['connections', 'Connexions Google', 'external'],
      ['automation', 'Automatisation', 'clock'],
    ];
    if (isOwner) {
      list.push(['sites', 'Sites & Sources', 'globe']);
    }
    return list;
  }, [isOwner]);

  useEffect(() => {
    if (session && page === 'sites' && !isOwner) {
      setPage('dashboard');
    }
  }, [page, isOwner, session]);

  useEffect(() => {
    // Wait for authentication so OAuth callback fragments can be consumed first.
    if (!authReady || !session) return;
    const url = new URL(window.location.href);
    url.hash = page;
    window.history.replaceState(window.history.state, '', url);
  }, [page, authReady, session]);
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
          .eq('job_id', jobs[0].id).order('id', { ascending: false }).limit(250));
        setScanEvents((events || []).reverse());
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
    try { await operation(); if (success) setNotice(success); return true; }
    catch (operationError) { setError(operationError.message); return false; }
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
    const latest = unwrap(await supabase.from('hunter_profiles').select('config').eq('id', profileId).single());
    config.sources = { ...(config.sources || {}), sites: latest?.config?.sources?.sites || [] };
    unwrap(await supabase.from('hunter_profiles')
      .update({ name, config }).eq('id', profileId));
    await loadProfiles();
  }, 'Profil enregistré.');

  const saveCandidature = (data) => run(async () => {
    const now = new Date();
    const isUuid = (val) => typeof val === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
    const hasValidUuid = isUuid(data.id);
    const candId = hasValidUuid ? data.id : undefined;

    let rawOfferId = data.offer_id;
    if (!rawOfferId && !hasValidUuid && Number.isInteger(Number(data.id)) && Number(data.id) > 0) {
      rawOfferId = Number(data.id);
    }
    const offerId = Number.isInteger(Number(rawOfferId)) && Number(rawOfferId) > 0 ? Number(rawOfferId) : null;

    const payload = {
      ...data,
      offer_id: offerId,
      user_id: session.user.id,
      profile_id: profileId,
      updated_at: now.toISOString(),
    };

    if (candId) {
      payload.id = candId;
    } else {
      delete payload.id;
    }

    if (!candId) {
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

    const saved = unwrap(await supabase.from('hunter_candidatures').upsert(payload).select('*').single());

    setCandidatures((prev) => {
      const next = prev.some((c) => c.id === saved.id)
        ? prev.map((c) => (c.id === saved.id ? saved : c))
        : [saved, ...prev];
      localStorage.setItem(`sh_candidatures_${profileId}`, JSON.stringify(next));
      return next;
    });
  }, data.id && isUuid(data.id) ? 'Candidature modifiée.' : 'Nouvelle candidature enregistrée.');

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
        supabase.from('hunter_candidatures').upsert(updated).then(({ error }) => {
          if (error) setError(error.message);
        });
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
        supabase.from('hunter_candidatures').upsert(updated).then(({ error }) => {
          if (error) setError(error.message);
        });
        return updated;
      });
      localStorage.setItem(`sh_candidatures_${profileId}`, JSON.stringify(next));
      return next;
    });
    setNotice('Mémo Post-it épinglé.');
  };

  const deleteCandidature = (candId) => run(async () => {
    unwrap(await supabase.from('hunter_candidatures').delete().eq('id', candId));
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
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Erreur import Sheets HTTP ${res.status}`);
    const incoming = data.candidatures || [];
    const keyOf = (c) => `${String(c.company || '').trim().toLowerCase()}|${String(c.created_at || '').slice(0, 16)}|${String(c.location || '').trim().toLowerCase()}`;
    const existing = unwrap(await supabase.from('hunter_candidatures').select('*').eq('profile_id', profileId));
    const existingKeys = new Set(existing.map(keyOf));
    const toAdd = incoming.filter((c) => {
      const key = keyOf(c);
      if (existingKeys.has(key)) return false;
      existingKeys.add(key);
      return true;
    });
    if (toAdd.length) {
      unwrap(await supabase.from('hunter_candidatures').insert(toAdd.map((c) => ({
        ...c, user_id: session.user.id, profile_id: profileId,
      }))));
    }
    await loadCandidatures();
    setNotice(`${toAdd.length} candidature${toAdd.length > 1 ? 's' : ''} importée${toAdd.length > 1 ? 's' : ''} depuis « ${data.sourceTab} » (${incoming.length} trouvées).`);
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

  const visiblePendingOffers = useMemo(() => {
    const rejected = offers.filter((offer) => offer.review_decision === 'reject');
    const activeScan = scanJobs.find((job) => ['queued', 'running'].includes(job.status));
    const activeStart = activeScan?.created_at ? new Date(activeScan.created_at).getTime() : Infinity;
    return offers.filter((offer) => offer.review_decision === 'pending'
      && new Date(offer.discovered_at).getTime() < activeStart
      && !matchesRejectedOffer(offer, rejected));
  }, [offers, scanJobs]);
  const stats = useMemo(() => {
    const result = { pending: 0, keep: 0, unsure: 0, reject: 0 };
    offers.forEach((offer) => { if (offer.review_decision in result) result[offer.review_decision] += 1; });
    result.pending = visiblePendingOffers.length;
    return result;
  }, [offers, visiblePendingOffers]);
  const activeProfile = profiles.find((row) => row.id === profileId);
  const profile = useMemo(() => activeProfile
    ? { ...EMPTY_CONFIG, ...activeProfile.config, id: activeProfile.id, name: activeProfile.name }
    : null, [activeProfile]);
  const latestScan = scanJobs[0];
  const scan = { cloud: true, available: workerReady, running: ['queued', 'running'].includes(latestScan?.status) };
  const dashboardStats = { ...stats, ready: stats.keep };
  const latestCompleted = scanJobs.find((job) => job.status === 'completed' && job.summary?.metrics);
  const metrics = latestCompleted?.summary?.metrics;
  // Older cloud scans saved funnel totals but no source breakdown. Rebuild the
  // retained-offer counts from the offers persisted during that scan.
  const sourceYield = useMemo(() => {
    if (!latestCompleted) return {};
    if (metrics?.source_yield && Object.keys(metrics.source_yield).length) return metrics.source_yield;
    const started = Date.parse(latestCompleted.created_at);
    const finished = Date.parse(latestCompleted.finished_at);
    if (!Number.isFinite(started) || !Number.isFinite(finished)) return {};
    return offers.reduce((sources, offer) => {
      const discovered = Date.parse(offer.discovered_at);
      if (!Number.isFinite(discovered) || discovered < started || discovered > finished) return sources;
      let domain = String(offer.source || '').trim().toLowerCase();
      if (!domain) {
        try { domain = new URL(offer.url).hostname.toLowerCase(); } catch (_) { return sources; }
      }
      domain = domain.replace(/^www\./, '');
      sources[domain] ??= { retained: 0 };
      sources[domain].retained += 1;
      return sources;
    }, {});
  }, [latestCompleted, metrics, offers]);
  const diagnostic = metrics ? {
    input_candidates: metrics.funnel?.input_candidates || 0,
    expanded_candidates: metrics.funnel?.expanded_candidates || 0,
    stats: metrics.funnel || {},
    runtime: { ...metrics, source_yield: sourceYield },
    sourceYieldRetainedOnly: !metrics?.source_yield || !Object.keys(metrics.source_yield).length,
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
              {navItems.map(([id, label, icon]) => (
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
                <strong>{navItems.find(([id]) => id === page)?.[1] || 'Accueil'}</strong></div>
              <div className="sh-topbar-actions">
                {scan.running && (
                  <div className="sh-scan-status-pill active">
                    <span>Scan en cours</span>
                  </div>
                )}
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
                {page === 'swipe' && <TinderDeck offers={visiblePendingOffers}
                  stats={stats} busy={busy} onDecide={decide} onUndo={undo} onRequeue={requeue}
                  onGoToPage={goToPage} onTransferCandidature={transferOfferToCandidature} />}
                {page === 'results' && <ResultsView results={offers.filter((offer) => ['keep', 'unsure'].includes(offer.review_decision))}
                  profileId={profileId} busy={busy} onDecide={decide} onRequeue={requeue} onExport={exportOffersCsv}
                  onTransferCandidature={transferOfferToCandidature} candidatures={candidatures} />}
                {page === 'candidatures' && <ApplicationsAtlas
                  candidatures={candidatures}
                  profileId={profileId}
                  accessToken={session.access_token}
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
                {page === 'sites' && isOwner && <div className="sh-view">
                  <SiteConfigEditor profile={profile} accessToken={session.access_token}
                    onSaved={loadProfiles} busy={busy} />
                </div>}
                {page === 'candidates' && <RawCandidatesView profileId={profileId}
                  accessToken={session.access_token} scanJobs={scanJobs} />}
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
