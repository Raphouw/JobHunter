import { vectorIcons, vectorMarkup, legacyGlyphs } from '../Common/vectorIcons';

const markup = Object.fromEntries(Object.keys(vectorIcons).map(name => [name, vectorMarkup(name)]));
markup.flagFR = '<svg class="jh-vector-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20" aria-hidden="true"><path fill="#002654" d="M0 0h10v20H0z"/><path fill="#fff" d="M10 0h10v20H10z"/><path fill="#ed2939" d="M20 0h10v20H20z"/></svg>';

// The iframe uses the same local Font Awesome SVGs as the React interface.
// Old documents are upgraded at render time; no remote font or script is needed.
export const cvVectorBridge = `<script>
window.CVIcons = (() => {
  const icons = ${JSON.stringify(markup)};
  const legacy = ${JSON.stringify({...legacyGlyphs, '🇫🇷':'flagFR'})};
  const keys = Object.keys(legacy).sort((a,b) => b.length-a.length);
  const pattern = new RegExp('(' + keys.join('|') + ')', 'gu');
  const labels = {mail:'Email',phone:'Téléphone',pin:'Adresse',briefcase:'Expérience professionnelle',laptop:'Informatique',globe:'Site web',cake:'Date de naissance',car:'Permis de conduire',flagFR:'Nationalité française',language:'Langues',stopwatch:'Disponibilité',link:'Lien',graduate:'Formation',trophy:'Récompense',home:'Domicile',bike:'Cyclisme',mobile:'Téléphone mobile'};
  const label = name => labels[legacy[name] || name] || name;
  const markup = name => icons[legacy[name] || name] || '';
  function upgrade(root) {
    for(const button of root.querySelectorAll?.('[data-emoji]') || []) {
      button.setAttribute('aria-label', label(button.dataset.emoji));
      button.title = label(button.dataset.emoji);
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while(walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement?.closest('script,style,svg,textarea')) continue;
      pattern.lastIndex = 0;
      if(pattern.test(node.data)) nodes.push(node);
    }
    for(const node of nodes) {
      if(node.parentElement.closest('option')) {
        node.data = node.data.replace(pattern, '').trim();
        continue;
      }
      const fragment = document.createDocumentFragment();
      for(const part of node.data.split(pattern)) {
        if(legacy[part]) {
          const span = document.createElement('span');
          span.className = 'jh-vector-wrap';
          span.contentEditable = 'false';
          span.innerHTML = markup(part);
          fragment.appendChild(span);
        } else fragment.appendChild(document.createTextNode(part));
      }
      const contact = node.parentElement.closest('.contact-item');
      node.replaceWith(fragment);
      if(contact) contact.classList.toggle('has-emoji', !!contact.querySelector('.c-icon svg'));
    }
  }
  document.addEventListener('DOMContentLoaded', () => {
    upgrade(document.body);
    const observer = new MutationObserver(records => {
      const roots = new Set();
      for(const record of records) {
        if(record.type === 'characterData') roots.add(record.target.parentElement);
        else for(const node of record.addedNodes) if(node.nodeType === 1 || node.nodeType === 3) roots.add(node.nodeType === 3 ? node.parentElement : node);
      }
      for(const root of roots) if(root?.isConnected) upgrade(root);
    });
    observer.observe(document.body, {subtree:true,childList:true,characterData:true});
  });
  return {markup,upgrade,label};
})();
</script>`;
