import React, { useState } from 'react';
import { Icon } from '../Common/Icons';

export function AutomationView({ onSchedule, busy = false }) {
  const [time, setTime] = useState('07:30');
  const [frequency, setFrequency] = useState('daily');

  return (
    <div className="sh-view automation-view">
      <div className="sh-view-header">
        <div>
          <span className="sh-eyebrow">AUTOMATISATION</span>
          <h1>Scans programmés en tâche de fond</h1>
          <p>
            Configure une tâche planifiée native sous Windows pour lancer automatiquement les scans
            sans intervention manuelle.
          </p>
        </div>
      </div>

      <section className="sh-form-section">
        <div className="sh-section-header">
          <div>
            <h2>Planification Windows</h2>
            <p>Choisis l’horaire quotidien ou hebdomadaire pour exécuter la recherche.</p>
          </div>
        </div>

        <div className="sh-form-grid">
          <div className="sh-field">
            <label>Heure d’exécution</label>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              required
            />
          </div>

          <div className="sh-field">
            <label>Fréquence</label>
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
            >
              <option value="daily">Tous les jours</option>
              <option value="weekdays">Du lundi au vendredi</option>
              <option value="weekly">Chaque lundi matin</option>
            </select>
          </div>
        </div>

        <div className="sh-form-save-bar">
          <button
            type="button"
            className="sh-btn-primary"
            onClick={() => onSchedule({ action: 'install', at: time, frequency })}
            disabled={busy}
          >
            <Icon name="clock" size={17} />
            <span>Activer la planification Windows</span>
          </button>

          <button
            type="button"
            className="sh-btn-secondary"
            onClick={() => onSchedule({ action: 'status' })}
            disabled={busy}
          >
            <Icon name="shield" size={16} />
            <span>Vérifier le statut</span>
          </button>

          <button
            type="button"
            className="sh-btn-danger"
            onClick={() => onSchedule({ action: 'remove' })}
            disabled={busy}
          >
            <Icon name="trash" size={16} />
            <span>Supprimer la tâche</span>
          </button>
        </div>
      </section>
    </div>
  );
}
