import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

import { Icon } from './components/Common/Icons';
import { TinderDeck } from './components/Swiper/TinderDeck';
import { DashboardView } from './components/Dashboard/DashboardView';
import { ResultsView } from './components/Results/ResultsView';
import { SearchView } from './components/Search/SearchView';
import { ProfileView } from './components/Profile/ProfileView';
import { ConnectionsView } from './components/Connections/ConnectionsView';
import { AutomationView } from './components/Automation/AutomationView';
import { DiagnosticView } from './components/Diagnostic/DiagnosticView';
import { ApplicationsAtlas } from './design-lab/ApplicationsAtlas';

const CloudApp = React.lazy(() => import('./cloud/CloudApp'));
const SwiperDesignLab = React.lazy(() => import('./design-lab/SwiperDesignLab'));
const cloudEnabled = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
const designLabEnabled = window.location.pathname.replace(/\/$/, '') === '/design-lab/swiper';
const atlasLabEnabled = window.location.pathname.replace(/\/$/, '') === '/design-lab/applications-map-v2';

const NAV_ITEMS = [
  { id: 'dashboard', icon: 'spark', label: 'Vue d’ensemble' },
  { id: 'swipe', icon: 'heart', label: 'Swiper les offres' },
  { id: 'results', icon: 'briefcase', label: 'Mes offres' },
  { id: 'candidatures', icon: 'map', label: 'Candidatures & Carte' },
  { id: 'profile', icon: 'building', label: 'Mon profil' },
  { id: 'search', icon: 'search', label: 'Recherche & Scan' },
  { id: 'diagnostic', icon: 'layers', label: 'Diagnostic' },
  { id: 'connections', icon: 'external', label: 'Connexions Google' },
  { id: 'automation', icon: 'clock', label: 'Automatisation' },
];

async function api(endpoint, body) {
  const options =
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        };
  const res = await fetch('/api/' + endpoint, options);
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error || 'Une erreur est survenue');
  }
  return data;
}

function getInitials(name = '') {
  const parts = String(name).trim().split(/\s+/).slice(0, 2);
  if (!parts[0]) return 'SH';
  return parts.map((p) => p[0]).join('').toUpperCase();
}

function App() {
  const [profiles, setProfiles] = useState([]);
  const [profileId, setProfileId] = useState('');
  const [state, setState] = useState(null);
  const [page, setPage] = useState(() => {
    if (atlasLabEnabled) return 'candidatures';
    const hash = window.location.hash.slice(1);
    return NAV_ITEMS.some((n) => n.id === hash) ? hash : 'dashboard';
  });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scanMode, setScanMode] = useState('Complet');

  const flash = (msg) => {
    setNotice(msg);
  };

  // Auto-dismiss notices and errors
  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(''), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!error) return undefined;
    const timer = window.setTimeout(() => setError(''), 6000);
    return () => window.clearTimeout(timer);
  }, [error]);

  const [candidatures, setCandidatures] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('sh_local_candidatures') || '[]');
    } catch {
      return [];
    }
  });
  const [prefillCandidature, setPrefillCandidature] = useState(null);

  const saveCandidature = (data) => {
    const now = new Date();
    const candId = data.id || `cand_${Date.now()}`;
    const payload = {
      ...data,
      id: candId,
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
    setCandidatures((prev) => {
      const next = prev.some((c) => c.id === candId)
        ? prev.map((c) => (c.id === candId ? { ...c, ...payload } : c))
        : [payload, ...prev];
      localStorage.setItem('sh_local_candidatures', JSON.stringify(next));
      return next;
    });
    flash(data.id ? 'Candidature modifiée.' : 'Nouvelle candidature enregistrée.');
  };

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
        const updatedHistory = [
          ...prevHistory,
          { date: `${day}/${month}/${year} ${hours}:${minutes}`, status: newStatus, text: autoNote },
        ];
        return {
          ...c,
          status: newStatus,
          status_history: updatedHistory,
          updated_at: now.toISOString(),
        };
      });
      localStorage.setItem('sh_local_candidatures', JSON.stringify(next));
      return next;
    });
    flash(`Statut mis à jour : ${newStatus}`);
  };

  const addCandidatureNote = (candId, note) => {
    setCandidatures((prev) => {
      const next = prev.map((c) => {
        if (c.id !== candId) return c;
        return {
          ...c,
          notes: [...(c.notes || []), note],
          updated_at: new Date().toISOString(),
        };
      });
      localStorage.setItem('sh_local_candidatures', JSON.stringify(next));
      return next;
    });
    flash('Mémo Post-it épinglé.');
  };

  const deleteCandidature = (candId) => {
    setCandidatures((prev) => {
      const next = prev.filter((c) => c.id !== candId);
      localStorage.setItem('sh_local_candidatures', JSON.stringify(next));
      return next;
    });
    flash('Candidature supprimée.');
  };

  const handleTransferCandidature = (offer) => {
    setPrefillCandidature(offer);
    setPage('candidatures');
  };

  // Fetch full state for active profile
  const refresh = useCallback(
    async (id = profileId) => {
      if (!id) return;
      try {
        const data = await api(`state?profile=${encodeURIComponent(id)}`);
        setState(data);
      } catch (err) {
        setError(err.message);
      }
    },
    [profileId]
  );

  // Initial load: profiles list
  useEffect(() => {
    if (atlasLabEnabled) return;
    api('profiles')
      .then((items) => {
        setProfiles(items);
        const urlParam = new URLSearchParams(window.location.search).get('profile');
        const initial = items.find((x) => x.id === urlParam)?.id || items[0]?.id || '';
        setProfileId(initial);
      })
      .catch((e) => setError(e.message));
  }, []);

  // When profileId changes, refresh state
  useEffect(() => {
    if (profileId) refresh(profileId);
  }, [profileId, refresh]);

  // Sync hash with current page
  useEffect(() => {
    window.location.hash = page;
    setMobileMenuOpen(false);
  }, [page]);

  // Polling when scan is running
  useEffect(() => {
    if (!state?.scan?.running) return;
    const interval = setInterval(() => {
      refresh().catch(() => {});
    }, 2200);
    return () => clearInterval(interval);
  }, [state?.scan?.running, refresh]);

  // Switch profile handler
  const handleSelectProfile = (id) => {
    setProfileId(id);
    setState(null);
    const url = new URL(window.location);
    url.searchParams.set('profile', id);
    window.history.replaceState(null, '', url);
  };

  // Swiper Decision
  const handleDecide = async (offer, decision) => {
    setBusy(true);
    setError('');
    try {
      await api('review', {
        profile: profileId,
        offer_id: offer.id,
        decision,
      });
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Undo Decision
  const handleUndo = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api('undo', { profile: profileId });
      flash(res.message || 'Dernière décision annulée.');
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Re-queue offers back to pending
  const handleRequeue = async (payload) => {
    setBusy(true);
    setError('');
    try {
      const res = await api('requeue', { profile: profileId, ...payload });
      flash(res.message || 'Offres remises dans la file.');
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Save Profile YAML
  const handleSaveProfile = async (formData) => {
    setBusy(true);
    setError('');
    try {
      await api('profile', { profile: profileId, data: formData });
      flash('Profil enregistré avec succès.');
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Reset Profile Data (SQLite offers & history, keeping YAML criteria safe)
  const handleResetProfile = async (mode = 'all') => {
    setBusy(true);
    setError('');
    try {
      const res = await api('reset-profile', { profile: profileId, mode });
      flash(res.message || 'Données et historique réinitialisés avec succès.');
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Run Scan
  const handleRunScan = async () => {
    setBusy(true);
    setError('');
    try {
      await api('scan', { profile: profileId, mode: scanMode });
      flash(`Scan ${scanMode} démarré en tâche de fond.`);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Execute Command (google sync, check, etc.)
  const handleCommand = async (command) => {
    setBusy(true);
    setError('');
    try {
      const res = await api('command', { profile: profileId, command });
      flash(res.message || 'Commande exécutée avec succès.');
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Schedule Windows task
  const handleSchedule = async (scheduleData) => {
    setBusy(true);
    setError('');
    try {
      const res = await api('schedule', { profile: profileId, ...scheduleData });
      flash(res.message || 'Planification mise à jour.');
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Save Regional Packs
  const handleSavePacks = async (updatedPacks) => {
    setBusy(true);
    setError('');
    try {
      const res = await api('sources-packs', { packs: updatedPacks });
      flash(res.message || 'Packs de sources mis à jour avec succès.');
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const profile = state?.profile || {};
  const stats = state?.stats || {};
  const offers = state?.offers || [];
  const results = state?.results || [];
  const scan = state?.scan || {};

  return (
    <div className="sh-app">
      {/* Toast Notifications */}
      {error && (
        <div className="sh-toast error" role="alert">
          <Icon name="x" size={16} />
          <span>{error}</span>
          <button onClick={() => setError('')} aria-label="Fermer">
            ×
          </button>
        </div>
      )}
      {notice && (
        <div className="sh-toast success" role="status">
          <Icon name="check" size={16} />
          <span>{notice}</span>
          <button onClick={() => setNotice('')} aria-label="Fermer">
            ×
          </button>
        </div>
      )}

      {/* Sidebar Navigation */}
      <aside className={`sh-sidebar ${mobileMenuOpen ? 'open' : ''}`}>
        <div className="sh-sidebar-brand">
          <div className="sh-brand-badge">
            <Icon name="spark" size={22} />
          </div>
          <div className="sh-brand-text">
            <strong>
              stage<span>hunter</span>
            </strong>
            <small>Ton prochain match pro</small>
          </div>
        </div>

        <nav className="sh-sidebar-nav" aria-label="Menu principal">
          <span className="sh-nav-group-label">NAVIGATION</span>
          {NAV_ITEMS.map((item) => {
            const isActive = page === item.id;
            const isSwipe = item.id === 'swipe';
            const badgeCount = isSwipe ? stats.pending || 0 : 0;

            return (
              <button
                key={item.id}
                className={`sh-nav-item ${isActive ? 'active' : ''}`}
                onClick={() => setPage(item.id)}
              >
                <Icon name={item.icon} size={18} />
                <span>{item.label}</span>
                {badgeCount > 0 && <span className="sh-nav-badge">{badgeCount}</span>}
              </button>
            );
          })}
        </nav>

        {/* Sidebar Bottom Promo Card */}
        <div className="sh-sidebar-bottom">
          <div className="sh-promo-card">
            <div className="sh-promo-star">✦</div>
            <strong>Dating App Mode</strong>
            <p>Glisse, découvre et sauvegarde les offres adaptées à ton profil.</p>
            <button className="sh-promo-btn" onClick={() => setPage('swipe')}>
              <span>Ouvrir le Swiper</span>
              <Icon name="arrow" size={14} />
            </button>
          </div>
          <div className="sh-sidebar-footer">
            <span>STAGE HUNTER</span>
            <span className="sh-version-tag">V6.2.7</span>
          </div>
        </div>
      </aside>

      {/* Main App Container */}
      <div className="sh-main-wrapper">
        {/* Top Header Bar */}
        <header className="sh-topbar">
          <button
            className="sh-mobile-toggle"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Ouvrir le menu"
          >
            <Icon name="menu" size={22} />
          </button>

          <div className="sh-breadcrumbs">
            <span>Stage Hunter</span>
            <span className="sh-sep">/</span>
            <strong>{NAV_ITEMS.find((n) => n.id === page)?.label || 'Accueil'}</strong>
          </div>

          <div className="sh-topbar-actions">
            {/* Scan Activity Status */}
            {(() => {
              const isCurrent = !scan.profile || scan.profile === profileId;
              const pillClass = scan.running
                ? isCurrent
                  ? 'active'
                  : 'other-profile'
                : '';
              const pillText = scan.running
                ? isCurrent
                  ? 'Scan en cours'
                  : `Scan sur ${scan.profile_name || scan.profile}`
                : 'Moteur prêt';
              const pillTitle =
                scan.running && !isCurrent
                  ? `Scan en cours d'exécution sur le profil « ${scan.profile_name || scan.profile} »`
                  : '';

              return (
                <div className={`sh-scan-status-pill ${pillClass}`} title={pillTitle}>
                  <span className="sh-scan-dot" />
                  <span>{pillText}</span>
                </div>
              );
            })()}

            {/* Profile Dropdown */}
            <label className="sh-profile-dropdown" title="Changer de profil actif">
              <div className="brand-avatar xs">{getInitials(profile.name)}</div>
              <select
                value={profileId}
                onChange={(e) => handleSelectProfile(e.target.value)}
                aria-label="Profil actif"
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name || p.id}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>

        {/* Dynamic Page Content */}
        <main className="sh-content">
          {!state && page !== 'candidatures' ? (
            <div className="sh-loading-screen">
              <div className="sh-loading-spinner" />
              <p>Chargement de ton espace Stage Hunter...</p>
            </div>
          ) : (
            <>
              {page === 'dashboard' && (
                <DashboardView
                  profile={profile}
                  stats={stats}
                  scan={scan}
                  onGoToPage={(p) => setPage(p)}
                />
              )}

              {page === 'swipe' && (
                <TinderDeck
                  offers={offers}
                  stats={stats}
                  busy={busy}
                  onDecide={handleDecide}
                  onUndo={handleUndo}
                  onRequeue={handleRequeue}
                  onGoToPage={(p) => setPage(p)}
                  onTransferCandidature={handleTransferCandidature}
                />
              )}

              {page === 'results' && (
                <ResultsView
                  results={results}
                  profileId={profileId}
                  busy={busy}
                  onDecide={handleDecide}
                  onRequeue={handleRequeue}
                  onCommand={handleCommand}
                  onTransferCandidature={handleTransferCandidature}
                  candidatures={candidatures}
                />
              )}

              {page === 'candidatures' && (
                <ApplicationsAtlas
                  candidatures={candidatures}
                  profileId={profileId}
                  busy={busy}
                  onSaveCandidature={saveCandidature}
                  onUpdateStatus={updateCandidatureStatus}
                  onAddNote={addCandidatureNote}
                  onDeleteCandidature={deleteCandidature}
                  prefillFromOffer={prefillCandidature}
                  onClearPrefill={() => setPrefillCandidature(null)}
                />
              )}

              {page === 'profile' && (
                <ProfileView
                  profile={profile}
                  onSave={handleSaveProfile}
                  onResetProfile={handleResetProfile}
                  busy={busy}
                />
              )}

              {page === 'search' && (
                <SearchView
                  state={state}
                  profile={profile}
                  mode={scanMode}
                  setMode={setScanMode}
                  onSaveProfile={handleSaveProfile}
                  onRunScan={handleRunScan}
                  onResetProfile={handleResetProfile}
                  onSavePacks={handleSavePacks}
                  busy={busy}
                />
              )}

              {page === 'diagnostic' && (
                <DiagnosticView
                  diagnostic={state.diagnostic}
                  scan={scan}
                />
              )}

              {page === 'connections' && (
                <ConnectionsView
                  profile={profile}
                  onSave={handleSaveProfile}
                  onCommand={handleCommand}
                  busy={busy}
                />
              )}

              {page === 'automation' && (
                <AutomationView
                  onSchedule={handleSchedule}
                  busy={busy}
                />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, details) {
    console.error('Erreur interface Job Hunter', error, details);
  }

  render() {
    if (this.state.failed) {
      return <main className="cloud-login-shell" role="alert">
        <h1>La page n’a pas pu s’afficher</h1>
        <p>Recharge la page pour retrouver ton espace. Le scan en cours continue sur le serveur.</p>
        <button type="button" onClick={() => window.location.reload()}>Recharger</button>
      </main>;
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <AppErrorBoundary>
    {designLabEnabled
      ? <React.Suspense fallback={null}><SwiperDesignLab /></React.Suspense>
      : cloudEnabled
      ? <React.Suspense fallback={<div className="cloud-login-shell">Chargement…</div>}><CloudApp /></React.Suspense>
      : <App />}
  </AppErrorBoundary>
);
