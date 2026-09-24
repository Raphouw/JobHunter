import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Common/Icons';

export function ProfileSwitcher({ profiles, activeId, onSelect, onCreate, onDelete, busy }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const root = useRef(null);
  const active = profiles.find((profile) => profile.id === activeId);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => { if (!root.current?.contains(event.target)) setOpen(false); };
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const submit = (event) => {
    event.preventDefault();
    if (!name.trim()) return;
    onCreate(name.trim());
    setName('');
    setOpen(false);
  };

  return <div className="cloud-profile-switcher" ref={root}>
    <button type="button" className="cloud-profile-trigger" aria-label="Choisir un profil"
      aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((value) => !value)}>
      <span className="brand-avatar xs">{(active?.name || '?').slice(0, 1).toUpperCase()}</span>
      <span className="cloud-profile-trigger-text"><small>Profil actif</small><strong>{active?.name || 'Créer un profil'}</strong></span>
      <span className="cloud-profile-chevron">⌄</span>
    </button>
    {open && <div className="cloud-profile-menu" role="dialog" aria-label="Profils de recherche">
      <div className="cloud-profile-menu-heading">MES PROFILS <span>{profiles.length}</span></div>
      <div className="cloud-profile-menu-list">
        {profiles.map((profile) => <div className={`cloud-profile-entry ${profile.id === activeId ? 'active' : ''}`} key={profile.id}>
          <button type="button" aria-pressed={profile.id === activeId}
            onClick={() => { onSelect(profile.id); setOpen(false); }}>
            <span className="brand-avatar xs">{profile.name.slice(0, 1).toUpperCase()}</span>
            <span className="cloud-profile-entry-name"><strong>{profile.name}</strong><small>{profile.id === activeId ? 'Profil actif' : 'Afficher ce profil'}</small></span>
            {profile.id === activeId && <span className="cloud-profile-check">✓</span>}
          </button>
          <button type="button" className="cloud-profile-remove" title={`Supprimer ${profile.name}`}
            aria-label={`Supprimer le profil ${profile.name}`} disabled={busy}
            onClick={() => { onDelete(profile); setOpen(false); }}>×</button>
        </div>)}
      </div>
      <form className="cloud-profile-create" onSubmit={submit}>
        <label htmlFor="cloud-menu-profile-name">Nouveau profil</label>
        <div><input id="cloud-menu-profile-name" placeholder="Nom du profil" value={name}
          onChange={(event) => setName(event.target.value)} maxLength={120} required />
          <button type="submit" aria-label="Ajouter le profil" disabled={busy || !name.trim()}><Icon name="arrow" size={16} /></button></div>
      </form>
    </div>}
  </div>;
}

export function DeleteProfileDialog({ profile, count, busy, onCancel, onConfirm }) {
  const [confirmation, setConfirmation] = useState('');
  const field = useRef(null);
  useEffect(() => {
    if (!profile) return;
    setConfirmation('');
    field.current?.focus();
  }, [profile?.id]);
  useEffect(() => {
    if (!profile) return undefined;
    const onKey = (event) => { if (event.key === 'Escape' && !busy) onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [profile, busy, onCancel]);
  if (!profile) return null;
  const ready = confirmation.trim() === profile.name;
  return <div className="sh-modal-backdrop cloud-delete-backdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !busy) onCancel();
  }}>
    <section className="cloud-delete-dialog" role="alertdialog" aria-modal="true"
      aria-labelledby="cloud-delete-title" aria-describedby="cloud-delete-description">
      <div className="cloud-delete-icon">!</div>
      <h2 id="cloud-delete-title">Supprimer « {profile.name} » ?</h2>
      <p id="cloud-delete-description">Cette action supprime définitivement ce profil, ses critères, {count === null ? 'toutes ses offres' : `${count} offre${count > 1 ? 's' : ''}`} et son historique de scans.</p>
      <label htmlFor="cloud-delete-confirm">Saisis <strong>{profile.name}</strong> pour confirmer</label>
      <input ref={field} id="cloud-delete-confirm" value={confirmation} autoComplete="off"
        onChange={(event) => setConfirmation(event.target.value)} />
      <div className="cloud-delete-actions">
        <button type="button" className="sh-btn-secondary" onClick={onCancel} disabled={busy}>Annuler</button>
        <button type="button" className="cloud-delete-button" onClick={onConfirm} disabled={!ready || busy}>
          {busy ? 'Suppression…' : 'Supprimer définitivement'}</button>
      </div>
    </section>
  </div>;
}
