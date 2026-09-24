import React, { useState } from 'react';
import { Icon } from '../Common/Icons';

export function AddNoteModal({ candidature, onClose, onSave, busy = false }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!text.trim()) {
      setError('Veuillez saisir une note.');
      return;
    }
    setError('');

    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const timestamp = `[${day}/${month}/${year} ${hours}:${minutes}]`;

    const note = {
      id: `note_${Date.now()}`,
      date: `${day}/${month}/${year} ${hours}:${minutes}`,
      text: `${timestamp} ${text.trim()}`,
      created_at: now.toISOString(),
    };

    onSave(candidature.id, note);
  };

  return (
    <div className="sh-modal-backdrop" onClick={onClose}>
      <div className="sh-modal-card note-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sh-modal-header">
          <div className="sh-modal-title">
            <span className="sh-modal-icon">📝</span>
            <div>
              <h3>Ajouter un mémo Post-it</h3>
              <p>{candidature?.company || 'Candidature'}</p>
            </div>
          </div>
          <button className="sh-modal-close" onClick={onClose} aria-label="Fermer">
            <Icon name="x" size={18} />
          </button>
        </div>

        {error && <div className="sh-toast error modal-err">{error}</div>}

        <form onSubmit={handleSubmit} className="cand-form">
          <div className="cand-field">
            <label>Note / Retour reçu</label>
            <textarea
              rows="4"
              autoFocus
              required
              placeholder="ex: Appel RH passé ce matin, entretien technique prévu mardi prochain..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="postit-textarea"
            />
          </div>

          <div className="sh-modal-actions">
            <button type="button" className="sh-btn-secondary" onClick={onClose} disabled={busy}>
              Annuler
            </button>
            <button type="submit" className="sh-btn-primary" disabled={busy}>
              {busy ? 'Ajout…' : 'Épingler le mémo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AddNoteModal;
