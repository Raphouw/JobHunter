import React from 'react';
import './country-multi-select.css';

const countries = [
  ['France', 'France', ['fr']],
  ['Switzerland', 'Suisse', ['ch', 'suisse', 'schweiz', 'svizzera']],
  ['Belgium', 'Belgique', ['be', 'belgique', 'belgie']],
  ['Germany', 'Allemagne', ['de', 'allemagne', 'deutschland']],
  ['Luxembourg', 'Luxembourg', ['lu']],
  ['Italy', 'Italie', ['it', 'italie', 'italia']],
  ['Spain', 'Espagne', ['es', 'espagne', 'espana']],
  ['Austria', 'Autriche', ['at', 'autriche', 'osterreich']],
  ['Netherlands', 'Pays-Bas', ['nl', 'pays-bas', 'nederland']],
  ['United Kingdom', 'Royaume-Uni', ['uk', 'royaume-uni', 'england', 'great britain']],
  ['United States', 'États-Unis', ['us', 'usa', 'etats-unis', 'united states of america']],
  ['Canada', 'Canada', ['ca']],
];
const fold = (value) => String(value).trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const canonical = (value) => countries.find(([name, , aliases]) => [fold(name), ...aliases].includes(fold(value)))?.[0] || String(value).trim();

export function CountryMultiSelect({ value, onChange, disabled = false }) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  const selected = [...new Set(raw.map(canonical).filter(Boolean))];
  // Preserve countries in existing profiles even when they are outside the standard list.
  const options = [...countries, ...selected.filter((name) => !countries.some(([key]) => key === name)).map((name) => [name, name, []])];
  const label = selected.map((name) => options.find(([key]) => key === name)?.[1] || name).join(', ');
  return (
    <details className="sh-country-select">
      <summary aria-label={`Pays de recherche : ${label || 'aucun pays sélectionné'}`} aria-describedby="profile-countries-help">{label || 'Sélectionner un ou plusieurs pays'}<span aria-hidden="true">▾</span></summary>
      <div className="sh-country-select-menu" role="group" aria-label="Pays de recherche">
        {options.map(([name, display]) => (
          <label key={name}>
            <input type="checkbox" checked={selected.includes(name)} disabled={disabled}
              onChange={(event) => onChange(event.target.checked ? [...selected, name] : selected.filter((item) => item !== name))} />
            <span>{display}</span>
          </label>
        ))}
      </div>
    </details>
  );
}
