import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '../Common/Icons';
import { LiveActivityTicker } from './LiveActivityTicker';
import { ColoredTerminal } from '../Common/ColoredTerminal';
import { ResetProfileModal } from '../Profile/ResetProfileModal';
import { PackEditorModal } from './PackEditorModal';

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

export function SearchView({
  state = {},
  profile = {},
  mode,
  setMode,
  onSaveProfile,
  onRunScan,
  onResetProfile,
  onSavePacks,
  busy = false,
}) {
  const [form, setForm] = useState(profile);
  const [autoScroll, setAutoScroll] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [showResetModal, setShowResetModal] = useState(false);
  const [editingPack, setEditingPack] = useState(null); // { id, data, isNew }
  const logTerminalRef = useRef(null);

  useEffect(() => {
    setForm(profile);
  }, [profile]);

  const scan = state.scan || {};
  const modes = state.modes || ['Rapide', 'Complet', 'Maximum', 'Exhaustif 1h'];
  const packs = state.packs || {};
  const system = scan.system || {};

  // 1-second client timer
  useEffect(() => {
    if (!scan.running) {
      if (scan.elapsed_seconds) setElapsed(scan.elapsed_seconds);
      return;
    }

    const startEpoch = scan.started ? new Date(scan.started).getTime() : Date.now();
    const tick = () => {
      const diffSec = Math.max(0, Math.floor((Date.now() - startEpoch) / 1000));
      setElapsed(diffSec);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [scan.running, scan.started, scan.elapsed_seconds]);

  // Auto-scroll logs
  useEffect(() => {
    if (autoScroll && logTerminalRef.current) {
      logTerminalRef.current.scrollTop = logTerminalRef.current.scrollHeight;
    }
  }, [scan.lines, autoScroll]);

  // Expected duration & progress calculation
  const expectedSec = MODE_DESCRIPTIONS[mode]?.seconds || 600;
  const progressPercent = scan.running
    ? (scan.percent !== undefined && scan.percent !== null
        ? Math.max(6, Math.min(99, scan.percent))
        : Math.min(96, Math.max(8, Math.round((elapsed / expectedSec) * 100))))
    : scan.exit_code === 0
    ? 100
    : 0;

  const etaRemainingSec = scan.eta_seconds !== undefined && scan.eta_seconds !== null
    ? scan.eta_seconds
    : Math.max(0, expectedSec - elapsed);

  const isScanForCurrentProfile = !scan.running || !scan.profile || scan.profile === (form.id || profile.id);

  const patchSources = (key, value) => {
    setForm((prev) => ({
      ...prev,
      sources: { ...(prev.sources || {}), [key]: value },
    }));
  };

  const patchSearch = (key, value) => {
    setForm((prev) => ({
      ...prev,
      search: { ...(prev.search || {}), [key]: value },
    }));
  };

  const linesToString = (arr) => (Array.isArray(arr) ? arr.join('\n') : String(arr || ''));
  const stringToLines = (str) =>
    String(str || '')
      .split(/\n|,/)
      .map((s) => s.trim())
      .filter(Boolean);

  const activePacks = form.sources?.packs || [];

  const togglePack = (packId) => {
    const next = activePacks.includes(packId)
      ? activePacks.filter((x) => x !== packId)
      : [...activePacks, packId];
    patchSources('packs', next);
  };

  // Download full log file
  const handleDownloadLog = async () => {
    try {
      const res = await fetch(`/api/scan-log?profile=${encodeURIComponent(form.id || profile.id || '')}`);
      const data = await res.json();
      const blob = new Blob([data.log || scan.lines.join('\n')], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = data.file || `scan_${form.id || 'log'}.log`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (_) {
      // Fallback: download lines in memory
      const blob = new Blob([scan.lines.join('\n')], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `scan_${Date.now()}.log`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="sh-view search-view">
      <div className="sh-view-header">
        <div>
          <span className="sh-eyebrow">MOTEUR DE RECHERCHE</span>
          <h1>Exploration & Télémétrie en direct</h1>
          <p>
            Lance l'exploration des plateformes carrières avec suivi de progression, estimation du temps
            restant et surveillance système.
          </p>
        </div>
      </div>

      {/* Mode Selection Grid */}
      <section className="sh-search-section">
        <div className="sh-section-header">
          <div>
            <h2>1. Choisis la puissance du scan</h2>
            <p>Sélectionne la durée et le nombre de sources interrogées.</p>
          </div>
        </div>

        <div className="sh-mode-grid">
          {modes.map((m) => {
            const meta = MODE_DESCRIPTIONS[m] || { label: m, desc: '', badge: '' };
            const isSelected = mode === m;

            return (
              <button
                key={m}
                type="button"
                className={`sh-mode-card ${isSelected ? 'selected' : ''}`}
                onClick={() => setMode(m)}
              >
                <div className="sh-mode-top">
                  <strong>{meta.label}</strong>
                  {meta.badge && <span className="sh-mode-badge">{meta.badge}</span>}
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
            className={`sh-btn-launch ${scan.running ? 'running' : ''}`}
            onClick={onRunScan}
            disabled={busy || scan.running}
          >
            {scan.running ? (
              <>
                <span className="sh-spinner" />
                <span>Scan en cours d'exécution...</span>
              </>
            ) : (
              <>
                <Icon name="play" size={18} />
                <span>Lancer le scan ({mode})</span>
              </>
            )}
          </button>

          <button
            type="button"
            className="sh-btn-reset-data"
            onClick={() => setShowResetModal(true)}
            disabled={busy || scan.running}
            title="Effacer les fiches et l'historique de scan pour repartir de zéro"
          >
            <Icon name="trash" size={16} />
            <span>Réinitialiser les données de scan</span>
          </button>

          {scan.started && (
            <span className="sh-scan-meta">
              Démarré à {new Date(scan.started).toLocaleTimeString('fr-FR')}
            </span>
          )}
        </div>
      </section>

      {/* ACTIVE SCAN PROGRESS & SYSTEM TELEMETRY (LOT 5) */}
      {(scan.running || scan.lines?.length > 0) && (
        <section className="sh-search-section sh-telemetry-section">
          {scan.running && !isScanForCurrentProfile && (
            <div className="sh-other-scan-alert">
              <Icon name="alert" size={20} />
              <div>
                <strong>Scan en cours sur un autre profil ({scan.profile_name || scan.profile})</strong>
                <p>Le moteur exécute actuellement l'exploration pour ce profil. Le journal et le ticker ci-dessous affichent son activité en direct.</p>
              </div>
            </div>
          )}

          <div className="sh-telemetry-header">
            <div>
              <h2>Suivi du scan</h2>
              <span className="sh-scan-phase-pill">
                <i className={scan.running ? 'pulse' : ''} />
                {scan.phase || (scan.running ? 'En cours' : 'Terminé')}
              </span>
            </div>
            {scan.lines?.length > 0 && (
              <button
                className="sh-btn-download-log"
                onClick={handleDownloadLog}
                title="Télécharger l'intégralité du fichier journal depuis le disque"
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
                <span className="sh-timer-label">TEMPS ÉCOULÉ (1s)</span>
                <strong className="sh-timer-val">{formatDuration(elapsed)}</strong>
              </div>

              {scan.running && (
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
                className={`sh-main-progress-bar ${scan.running ? 'animated' : ''}`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {/* System Hardware Gauges (RAM PC, Process RAM, CPU) */}
          <div className="sh-hardware-gauges-grid">
            <div className="sh-hw-card">
              <div className="sh-hw-top">
                <Icon name="sliders" size={17} />
                <span>RAM Machine</span>
              </div>
              <strong>{system.ram_used_pct || 0}%</strong>
              <small>
                {system.ram_used_gb || 0} Go / {system.ram_total_gb || 0} Go
              </small>
              <div className="sh-hw-bar">
                <div
                  className="sh-hw-bar-fill"
                  style={{ width: `${Math.min(100, system.ram_used_pct || 0)}%` }}
                />
              </div>
            </div>

            <div className="sh-hw-card">
              <div className="sh-hw-top">
                <Icon name="spark" size={17} />
                <span>Processus Job Hunter</span>
              </div>
              <strong>{system.process_ram_mb || 0} Mo</strong>
              <small>Mémoire vive allouée au moteur</small>
              <div className="sh-hw-bar">
                <div
                  className="sh-hw-bar-fill green"
                  style={{ width: `${Math.min(100, ((system.process_ram_mb || 0) / 1024) * 100)}%` }}
                />
              </div>
            </div>

            <div className="sh-hw-card">
              <div className="sh-hw-top">
                <Icon name="clock" size={17} />
                <span>Charge Processeur</span>
              </div>
              <strong>{system.cpu_pct || 0}%</strong>
              <small>Activité processeur du PC</small>
              <div className="sh-hw-bar">
                <div
                  className="sh-hw-bar-fill purple"
                  style={{ width: `${Math.min(100, system.cpu_pct || 0)}%` }}
                />
              </div>
            </div>
          </div>

          {/* Gemini-Style Live Activity Ticker (Placed directly above the live console) */}
          <LiveActivityTicker scan={scan} mode={mode} />

          {/* Live Colorized Terminal */}
          <ColoredTerminal
            lines={scan.lines || []}
            retainedLines={scan.retained_lines || []}
            removedLines={scan.removed_lines || []}
            errorLines={scan.error_lines || []}
            autoScroll={autoScroll}
            setAutoScroll={setAutoScroll}
            terminalRef={logTerminalRef}
            onDownloadLog={handleDownloadLog}
          />
        </section>
      )}

      {/* Sources & Custom Queries Editor */}
      <section className="sh-search-section">
        <div className="sh-section-header">
          <div>
            <h2>2. Packs régionaux & requêtes personnalisées</h2>
            <p>Ajoute des sites carrière ciblés ou active les packs géographiques.</p>
          </div>
        </div>

        {/* Source packs */}
        <div className="sh-packs-container">
          <div className="sh-packs-top-bar">
            <label className="sh-sub-label">Packs de sources régionales :</label>
            <button
              type="button"
              className="sh-btn-create-pack"
              onClick={() =>
                setEditingPack({
                  id: '',
                  data: { label: '', domains: [], fixed_urls: [] },
                  isNew: true,
                })
              }
              title="Créer un nouveau pack personnalisé de sources"
            >
              <Icon name="plus" size={13} />
              <span>Créer un pack</span>
            </button>
          </div>

          {Object.keys(packs).length > 0 && (
            <div className="sh-packs-grid">
              {Object.entries(packs).map(([id, pack]) => {
                const checked = activePacks.includes(id);
                return (
                  <div key={id} className={`sh-pack-card-wrap ${checked ? 'active' : ''}`}>
                    <button
                      type="button"
                      className="sh-pack-left"
                      onClick={() => togglePack(id)}
                      title={checked ? 'Désactiver ce pack' : 'Activer ce pack'}
                    >
                      <span className={`sh-pack-check ${checked ? 'on' : ''}`}>
                        {checked ? '✓' : ''}
                      </span>
                      <div className="sh-pack-info">
                        <strong>{pack.label || id}</strong>
                        <small>{(pack.domains || []).length} domaines</small>
                      </div>
                    </button>
                    <button
                      type="button"
                      className="sh-pack-edit-btn"
                      onClick={() => setEditingPack({ id, data: pack, isNew: false })}
                      title="Modifier les domaines et pages carrières de ce pack"
                    >
                      <Icon name="sliders" size={13} />
                      <span>Éditer</span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Custom URLs & Queries inputs */}
        <div className="sh-form-grid">
          <div className="sh-field">
            <label>Domaines d’entreprises à crawler (un par ligne)</label>
            <textarea
              rows={4}
              placeholder="ex: careers.roche.com&#10;jobs.nestle.com"
              value={linesToString(form.sources?.custom_domains)}
              onChange={(e) => patchSources('custom_domains', stringToLines(e.target.value))}
            />
          </div>

          <div className="sh-field">
            <label>Pages carrières spécifiques (URLs complètes)</label>
            <textarea
              rows={4}
              placeholder="ex: https://company.com/fr/careers/internships"
              value={linesToString(form.sources?.custom_urls)}
              onChange={(e) => patchSources('custom_urls', stringToLines(e.target.value))}
            />
          </div>

          <div className="sh-field">
            <label>Requêtes manuelles moteur web</label>
            <textarea
              rows={4}
              placeholder="ex: stage ingénieur embarqué Suisse&#10;robotics internship Lausanne"
              value={linesToString(form.search?.queries)}
              onChange={(e) => patchSearch('queries', stringToLines(e.target.value))}
            />
          </div>

          <div className="sh-field">
            <label>Requêtes complémentaires ciblées</label>
            <textarea
              rows={4}
              placeholder="ex: internship biomedical sensors geneva"
              value={linesToString(form.sources?.custom_queries)}
              onChange={(e) => patchSources('custom_queries', stringToLines(e.target.value))}
            />
          </div>
        </div>

        <div className="sh-form-save-bar">
          <button
            className="sh-btn-primary"
            onClick={() => onSaveProfile(form)}
            disabled={busy}
          >
            <Icon name="check" size={17} />
            <span>Enregistrer les sources & requêtes</span>
          </button>
        </div>
      </section>

      {showResetModal && (
        <ResetProfileModal
          profileName={profile.name || form.name || 'Actif'}
          busy={busy}
          onClose={() => setShowResetModal(false)}
          onConfirm={async (m) => {
            if (onResetProfile) await onResetProfile(m);
            setShowResetModal(false);
          }}
        />
      )}

      {editingPack && (
        <PackEditorModal
          packId={editingPack.id}
          packData={editingPack.data}
          isNew={editingPack.isNew}
          busy={busy}
          onClose={() => setEditingPack(null)}
          onSave={async (packId, packData) => {
            if (onSavePacks) {
              const updatedPacks = { ...packs, [packId]: packData };
              await onSavePacks(updatedPacks);
            }
            setEditingPack(null);
          }}
        />
      )}
    </div>
  );
}
