import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Common/Icons';
import { TinderDeck } from '../components/Swiper/TinderDeck';
import { ProfileView } from '../components/Profile/ProfileView';
import { DashboardView } from '../components/Dashboard/DashboardView';
import { ResultsView } from '../components/Results/ResultsView';
import { DiagnosticView } from '../components/Diagnostic/DiagnosticView';
import { CloudSearchView, CloudConnectionsView, CloudAutomationView } from './CloudFeatureViews';
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

export function CloudApp() {
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [profiles, setProfiles] = useState([]);
  const [profileId, setProfileId] = useState('');
  const [offers, setOffers] = useState([]);
  const [scanJobs, setScanJobs] = useState([]);
  const [page, setPage] = useState('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [newName, setNewName] = useState('');
  const [lastDecision, setLastDecision] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data, error: authError }) => {
      if (authError) setError(authError.message);
      setSession(data?.session || null);
      setAuthReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        setProfiles([]); setOffers([]); setProfileId('');
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

  const loadData = useCallback(async () => {
    if (!profileId) { setOffers([]); setScanJobs([]); return; }
    try {
      const [offerRows, jobRows] = await Promise.all([
        supabase.from('hunter_offers').select('*').eq('profile_id', profileId)
          .order('score', { ascending: false }).limit(1000),
        supabase.from('hunter_scan_jobs')
          .select('id,mode,status,phase,progress_percent,attempt_count,cancel_requested,created_at,finished_at,summary,error_message')
          .eq('profile_id', profileId)
          .order('created_at', { ascending: false }).limit(10),
      ]);
      setOffers(unwrap(offerRows) || []);
      setScanJobs(unwrap(jobRows) || []);
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [profileId]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (page !== 'search' || !profileId) return undefined;
    const timer = window.setInterval(loadData, 15000);
    return () => window.clearInterval(timer);
  }, [loadData, page, profileId]);

  const run = async (operation, success) => {
    setBusy(true); setError('');
    try { await operation(); if (success) setNotice(success); }
    catch (operationError) { setError(operationError.message); }
    finally { setBusy(false); }
  };

  const createProfile = (event) => {
    event.preventDefault();
    if (!newName.trim()) return;
    run(async () => {
      unwrap(await supabase.from('hunter_profiles').insert({
        user_id: session.user.id, name: newName.trim(), config: EMPTY_CONFIG,
      }));
      setNewName('');
      await loadProfiles();
    }, 'Profil créé.');
  };

  const saveProfile = (form) => run(async () => {
    const { id, name, ...config } = form;
    unwrap(await supabase.from('hunter_profiles')
      .update({ name, config }).eq('id', profileId));
    await loadProfiles();
  }, 'Profil enregistré.');

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
  const scan = { cloud: true, available: false, running: ['queued', 'running'].includes(latestScan?.status) };
  const dashboardStats = { ...stats, ready: stats.keep };
  const latestCompleted = scanJobs.find((job) => job.status === 'completed' && job.summary?.metrics);
  const metrics = latestCompleted?.summary?.metrics;
  const diagnostic = metrics ? {
    input_candidates: metrics.funnel?.input_candidates || 0,
    expanded_candidates: metrics.funnel?.expanded_candidates || 0,
    stats: metrics.funnel || {},
    runtime: metrics,
  } : {};
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
                  <span className="sh-scan-dot" /><span>{scan.running ? 'Scan en cours' : 'Scans web en préparation'}</span>
                </div>
                <label className="sh-profile-dropdown" title="Changer de profil actif">
                  <div className="brand-avatar xs">{(profile?.name || '?').slice(0, 1).toUpperCase()}</div>
                  <select aria-label="Profil actif" value={profileId} onChange={(event) => setProfileId(event.target.value)}>
                    {profiles.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                  </select>
                </label>
                <button className="sh-btn-secondary" onClick={() => supabase.auth.signOut()}>Déconnexion</button>
              </div>
            </header>
            <main className="sh-content">
              {!profile ? <section className="sh-view">
                <h1>Créer mon premier profil</h1>
                <p>Chaque profil et ses offres seront visibles uniquement depuis ton compte.</p>
                <form className="cloud-create-form" onSubmit={createProfile}>
                  <input aria-label="Nom du profil" placeholder="Nom du profil" required maxLength={120}
                    value={newName} onChange={(event) => setNewName(event.target.value)} />
                  <button className="sh-btn-primary" disabled={busy}>Créer</button>
                </form>
              </section> : <>
                {page === 'dashboard' && <DashboardView profile={profile} stats={dashboardStats}
                  scan={scan} featuredOffer={offers[0]} onGoToPage={goToPage} />}
                {page === 'swipe' && <TinderDeck offers={offers.filter((offer) => offer.review_decision === 'pending')}
                  stats={stats} busy={busy} onDecide={decide} onUndo={undo} onRequeue={requeue}
                  onGoToPage={goToPage} />}
                {page === 'results' && <ResultsView results={offers.filter((offer) => ['keep', 'unsure'].includes(offer.review_decision))}
                  profileId={profileId} busy={busy} onDecide={decide} onRequeue={requeue} onExport={exportOffersCsv} />}
                {page === 'profile' && <div className="sh-view"><ProfileView profile={profile} onSave={saveProfile} busy={busy} />
                  <section className="sh-form-section"><div className="sh-section-header"><div>
                    <h2>Mes profils de recherche</h2><p>Chaque profil possède ses critères et ses offres.</p>
                  </div></div>
                    <form className="cloud-create-form" onSubmit={createProfile}>
                      <input aria-label="Nouveau profil" placeholder="Ajouter un autre profil" required maxLength={120}
                        value={newName} onChange={(event) => setNewName(event.target.value)} />
                      <button className="sh-btn-secondary" disabled={busy}>Ajouter</button>
                    </form>
                  </section>
                </div>}
                {page === 'search' && <CloudSearchView scanJobs={scanJobs} onRefresh={loadData} busy={busy} />}
                {page === 'diagnostic' && <DiagnosticView diagnostic={diagnostic} scan={scan} />}
                {page === 'connections' && <CloudConnectionsView />}
                {page === 'automation' && <CloudAutomationView />}
              </>}
            </main>
          </div>
        </div>
      )}
    </>
  );
}

export default CloudApp;
