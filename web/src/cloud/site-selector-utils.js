export const MAX_SELECTOR_LENGTH = 2048;

export function selectorErrors(site, requireComplete = false) {
  const errors = {};
  const sections = ['selectors', 'detail_selectors', 'pagination'];
  sections.forEach((section) => {
    const values = section === 'pagination' ? { next_selector: site.pagination?.next_selector || '' } : site[section] || {};
    Object.entries(values).forEach(([key, value]) => {
      const path = `${section}.${key}`;
      if (requireComplete && section === 'selectors' && ['card', 'title'].includes(key) && !value?.trim()) {
        errors[path] = 'Sélectionne ce champ indispensable avant de tester ou publier.';
      } else if (typeof value !== 'string' || value.length > MAX_SELECTOR_LENGTH) {
        errors[path] = `Chemin trop long : maximum ${MAX_SELECTOR_LENGTH} caractères. Resélectionne cet élément.`;
      } else if (value && !['self', 'this', '.'].includes(value)) {
        if (/\x00|:has\(|:contains\(/.test(value)) errors[path] = 'Expression CSS non prise en charge.';
        else {
          try { document.createDocumentFragment().querySelector(value); }
          catch (_) { errors[path] = 'Syntaxe CSS invalide. Resélectionne cet élément ou efface le champ.'; }
        }
      }
    });
  });
  return errors;
}

export function scrollSelectedStep(bar, field, behavior = 'smooth') {
  const pills = [...bar.querySelectorAll('[data-field]')];
  bar.style.setProperty('--picker-step-max-width', `${Math.max(48, (bar.clientWidth - 28) / 3)}px`);
  const index = pills.findIndex((pill) => pill.dataset.field === field);
  if (index < 0) return;
  // Keep the two preceding steps fully visible, even near the end of the list.
  const start = Math.max(0, index - 2);
  const left = pills[start].offsetLeft - pills[0].offsetLeft;
  const trailingWidth = pills.slice(start).reduce((width, pill) => width + pill.getBoundingClientRect().width, 0)
    + Math.max(0, pills.length - start - 1) * (parseFloat(getComputedStyle(bar).gap) || 0);
  bar.style.paddingRight = `${Math.max(0, bar.clientWidth - trailingWidth)}px`;
  bar.scrollTo({ left, behavior });
}
