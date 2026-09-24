import React, { useEffect, useMemo, useState } from 'react';
import { Icon } from '../Common/Icons';
import { ResetProfileModal } from './ResetProfileModal';

export function ProfileView({ profile = {}, onSave, onResetProfile, busy = false }) {
  const [form, setForm] = useState(profile);
  const [testTitle, setTestTitle] = useState('');
  const [showResetModal, setShowResetModal] = useState(false);

  useEffect(() => {
    setForm(profile);
  }, [profile]);

  const patch = (section, key, value) => {
    setForm((prev) => ({
      ...prev,
      [section]: {
        ...(prev[section] || {}),
        [key]: value,
      },
    }));
  };

  const linesToString = (arr) => (Array.isArray(arr) ? arr.join('\n') : String(arr || ''));
  const stringToLines = (str) =>
    String(str || '')
      .split(/\n|,/)
      .map((s) => s.trim())
      .filter(Boolean);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(form);
  };

  // Red flag test simulation
  const strictFlags = useMemo(() => {
    const raw = form.target?.red_flags || form.search?.red_flags || [];
    return (Array.isArray(raw) ? raw : [raw]).map((s) => String(s).trim().toLowerCase()).filter(Boolean);
  }, [form.target?.red_flags, form.search?.red_flags]);

  const softFlags = useMemo(() => {
    const raw = form.target?.soft_red_flags || form.search?.soft_red_flags || [];
    return (Array.isArray(raw) ? raw : [raw]).map((s) => String(s).trim().toLowerCase()).filter(Boolean);
  }, [form.target?.soft_red_flags, form.search?.soft_red_flags]);

  const testVerdict = useMemo(() => {
    if (!testTitle.trim()) return null;
    const lower = ` ${testTitle.toLowerCase()} `;

    const strictMatches = strictFlags.filter((f) => lower.includes(` ${f} `) || lower.includes(` ${f}`) || lower.includes(`${f} `));
    if (strictMatches.length > 0) {
      return {
        status: 'reject',
        message: `Rejet immédiat : contient le mot interdit "${strictMatches[0]}"`,
      };
    }

    const softMatches = softFlags.filter((f) => lower.includes(` ${f} `) || lower.includes(` ${f}`) || lower.includes(`${f} `));
    if (softMatches.length > 0) {
      return {
        status: 'penalty',
        message: `Pénalité (-25 pts par mot) : contient "${softMatches.join(', ')}"`,
      };
    }

    return {
      status: 'ok',
      message: 'Titre validé : aucun mot red flag détecté.',
    };
  }, [testTitle, strictFlags, softFlags]);

  return (
    <div className="sh-view profile-view">
      <div className="sh-view-header">
        <div>
          <span className="sh-eyebrow">CONFIGURATION DU CANDIDAT</span>
          <h1>Mon profil de recherche & Règles</h1>
          <p>Ces critères guident la découverte, le filtrage et la notation de chaque offre.</p>
        </div>
      </div>

      <form className="sh-settings-form" onSubmit={handleSubmit}>
        {/* Section: Student Identity */}
        <section className="sh-form-section">
          <div className="sh-section-header">
            <div>
              <h2>Identité & Formation</h2>
              <p>Informations académiques et spécialisation pour personnaliser les résultats.</p>
            </div>
          </div>

          <div className="sh-form-grid">
            <div className="sh-field">
              <label>Nom du profil</label>
              <input
                type="text"
                value={form.name || ''}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>

            <div className="sh-field">
              <label>Nom de l'étudiant / candidat</label>
              <input
                type="text"
                value={form.student?.name || ''}
                onChange={(e) => patch('student', 'name', e.target.value)}
              />
            </div>

            <div className="sh-field">
              <label>École ou Université</label>
              <input
                type="text"
                value={form.student?.school || ''}
                onChange={(e) => patch('student', 'school', e.target.value)}
                placeholder="ex: Polytech Annecy"
              />
            </div>

            <div className="sh-field">
              <label>Spécialisation / Diplôme</label>
              <input
                type="text"
                value={form.student?.specialization || ''}
                onChange={(e) => patch('student', 'specialization', e.target.value)}
                placeholder="ex: Systèmes Numériques & Instrumentation"
              />
            </div>
          </div>
        </section>

        {/* Section: Target Criteria & Dates */}
        <section className="sh-form-section">
          <div className="sh-section-header">
            <div>
              <h2>Modalités de recherche & Dates</h2>
              <p>Type de contrat, durée minimale et calendrier de disponibilité.</p>
            </div>
          </div>

          <div className="sh-form-grid">
            <div className="sh-field">
              <label>Type de recherche principal</label>
              <select
                value={form.student?.stage_type || 'stage / internship'}
                onChange={(e) => patch('student', 'stage_type', e.target.value)}
              >
                <option value="stage / internship">Stage / Internship</option>
                <option value="alternance / apprentissage">Alternance / Apprentissage</option>
                <option value="emploi">Emploi (CDI / CDD / Premier job)</option>
                <option value="freelance / mission">Freelance / Mission</option>
              </select>
            </div>

            <div className="sh-field">
              <label>Durée minimale (semaines)</label>
              <input
                type="number"
                min="0"
                value={form.student?.min_weeks ?? 20}
                onChange={(e) => patch('student', 'min_weeks', Number(e.target.value))}
              />
            </div>

            <div className="sh-field">
              <label>Date de début souhaitée</label>
              <input
                type="date"
                value={form.student?.start_date || ''}
                onChange={(e) => patch('student', 'start_date', e.target.value)}
              />
            </div>

            <div className="sh-field">
              <label>Date de fin maximale</label>
              <input
                type="date"
                value={form.student?.end_date || ''}
                onChange={(e) => patch('student', 'end_date', e.target.value)}
              />
            </div>
          </div>
        </section>

        {/* Section: Positions & Sectors */}
        <section className="sh-form-section">
          <div className="sh-section-header">
            <div>
              <h2>Intitulés ciblés & Domaines</h2>
              <p>Décris les postes et univers d'activité qui t'intéressent (un par ligne).</p>
            </div>
          </div>

          <div className="sh-form-grid">
            <div className="sh-field">
              <label>Intitulés de poste recherchés</label>
              <textarea
                rows={5}
                value={linesToString(form.target?.job_titles)}
                onChange={(e) => patch('target', 'job_titles', stringToLines(e.target.value))}
                placeholder="ex: embedded systems intern&#10;stagiaire ingénieur robotique"
              />
            </div>

            <div className="sh-field">
              <label>Secteurs d’activité</label>
              <textarea
                rows={5}
                value={linesToString(form.target?.sectors)}
                onChange={(e) => patch('target', 'sectors', stringToLines(e.target.value))}
                placeholder="ex: embedded systems&#10;sensors and instrumentation&#10;robotics&#10;MedTech"
              />
            </div>

            <div className="sh-field">
              <label>Compétences clés (recherchées dans l’offre)</label>
              <textarea
                rows={5}
                value={linesToString(form.skills?.core)}
                onChange={(e) => patch('skills', 'core', stringToLines(e.target.value))}
                placeholder="ex: C, C++, Python&#10;capteurs, RTOS, PCB&#10;traitement du signal"
              />
            </div>

            <div className="sh-field">
              <label>Domaines d'expertise forts</label>
              <textarea
                rows={5}
                value={linesToString(form.skills?.strong_domains)}
                onChange={(e) => patch('skills', 'strong_domains', stringToLines(e.target.value))}
                placeholder="ex: instrumentation&#10;embedded systems&#10;robotique"
              />
            </div>
          </div>
        </section>

        {/* Section: MOTS RED FLAGS & PÉNALITÉS (LOT 7) */}
        <section className="sh-form-section sh-redflags-section">
          <div className="sh-section-header">
            <div>
              <h2>Mots « Red Flag » & Exclusions (Anti-Senior)</h2>
              <p>
                Évite les offres non adaptées (postes séniors, directeurs, ou exigences hors cible).
              </p>
            </div>
          </div>

          <div className="sh-form-grid">
            <div className="sh-field">
              <label>
                Mots strictement interdits (Rejet direct)
                <span className="sh-label-hint">Un par ligne — ex: SENIOR, DIRECTEUR, PH.D</span>
              </label>
              <textarea
                rows={4}
                value={linesToString(form.target?.red_flags || form.search?.red_flags)}
                onChange={(e) => patch('target', 'red_flags', stringToLines(e.target.value))}
                placeholder="senior&#10;lead&#10;head of&#10;director&#10;principal"
              />
            </div>

            <div className="sh-field">
              <label>
                Mots à pénaliser souplement (−25 points de score)
                <span className="sh-label-hint">Un par ligne — ex: CONFIRMÉ, EXPÉRIMENTÉ</span>
              </label>
              <textarea
                rows={4}
                value={linesToString(form.target?.soft_red_flags || form.search?.soft_red_flags)}
                onChange={(e) => patch('target', 'soft_red_flags', stringToLines(e.target.value))}
                placeholder="confirmé&#10;expérimenté&#10;5 ans&#10;cdi obligatoire"
              />
            </div>
          </div>

          {/* Interactive Red Flag Live Simulator */}
          <div className="sh-simulator-box">
            <div className="sh-simulator-header">
              <Icon name="spark" size={16} />
              <strong>Simulateur de détection de titre</strong>
              <span>Tape un exemple de titre pour tester tes règles en direct</span>
            </div>
            <div className="sh-simulator-input-row">
              <input
                type="text"
                placeholder="Tape un titre d'offre (ex: Senior Embedded Systems Engineer)..."
                value={testTitle}
                onChange={(e) => setTestTitle(e.target.value)}
              />
              {testVerdict && (
                <div className={`sh-verdict-pill ${testVerdict.status}`}>
                  <Icon
                    name={testVerdict.status === 'reject' ? 'x' : testVerdict.status === 'penalty' ? 'clock' : 'check'}
                    size={15}
                  />
                  <span>{testVerdict.message}</span>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Section: Locations & Languages */}
        <section className="sh-form-section">
          <div className="sh-section-header">
            <div>
              <h2>Géographie & Langues</h2>
              <p>Définis les pays, cantons ou villes de recherche ainsi que les langues acceptées.</p>
            </div>
          </div>

          <div className="sh-form-grid">
            <div className="sh-field">
              <label>Pays ciblés (séparés par virgules)</label>
              <input
                type="text"
                value={(form.location?.countries || []).join(', ')}
                onChange={(e) => patch('location', 'countries', stringToLines(e.target.value))}
                placeholder="Switzerland, France"
              />
            </div>

            <div className="sh-field">
              <label>
                Régions, cantons ou départements prioritaires
                <span className="sh-label-hint">S'adapte automatiquement selon les pays (Suisse, France, Belgique, etc.)</span>
              </label>
              <input
                type="text"
                value={(form.location?.priority_cantons || form.location?.priority_locations || []).join(', ')}
                onChange={(e) => {
                  const arr = stringToLines(e.target.value);
                  setForm((prev) => ({
                    ...prev,
                    location: {
                      ...(prev.location || {}),
                      priority_cantons: arr,
                      priority_locations: arr,
                    },
                  }));
                }}
                placeholder="ex: Auvergne-Rhône-Alpes, Île-de-France, GE, VD, 74, 69, Lyon, Paris, Zurich..."
              />
            </div>

            <div className="sh-field">
              <label>Langues acceptées</label>
              <input
                type="text"
                value={(form.location?.acceptable_language || []).join(', ')}
                onChange={(e) => patch('location', 'acceptable_language', stringToLines(e.target.value))}
                placeholder="fr, en"
              />
            </div>
          </div>
        </section>

        <div className="sh-form-save-bar">
          <button type="submit" className="sh-btn-primary" disabled={busy}>
            <Icon name="check" size={18} />
            <span>Enregistrer toutes les modifications</span>
          </button>
        </div>
      </form>

      {/* Section: Data Management & Reset */}
      {onResetProfile && <section className="sh-form-section sh-danger-zone-section">
        <div className="sh-section-header">
          <div>
            <h2>Gestion des données & Réinitialisation</h2>
            <p>
              Nettoie l'historique des scans ou remets à zéro les offres de ce profil sans perdre
              tes réglages.
            </p>
          </div>
        </div>

        <div className="sh-danger-zone-card">
          <div className="sh-danger-info">
            <strong>Réinitialiser les scans et les offres de ce profil</strong>
            <p>
              Efface toutes les fiches analysées et les décisions de swipe pour repartir d'une page
              blanche lors d'un nouveau scan. Tes compétences, école, intitulés et requêtes sont
              100% conservés.
            </p>
          </div>
          <button
            type="button"
            className="sh-btn-danger"
            onClick={() => setShowResetModal(true)}
            disabled={busy}
          >
            <Icon name="trash" size={16} />
            <span>Réinitialiser ce profil...</span>
          </button>
        </div>
      </section>}

      {showResetModal && (
        <ResetProfileModal
          profileName={profile.name || form.name}
          busy={busy}
          onClose={() => setShowResetModal(false)}
          onConfirm={async (mode) => {
            if (onResetProfile) await onResetProfile(mode);
            setShowResetModal(false);
          }}
        />
      )}
    </div>
  );
}
