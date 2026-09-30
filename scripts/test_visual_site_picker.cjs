// Browser regression for text hit testing and ambiguous sibling selectors.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const runtimeRequire = createRequire(path.join(process.env.CODEX_NODE_MODULES, '_test.cjs'));
const { chromium } = runtimeRequire('playwright');

(async () => {
  const source = fs.readFileSync(path.join(__dirname, '../web/src/cloud/VisualSitePicker.jsx'), 'utf8');
  const helpers = source.slice(source.indexOf('function cleanClass'), source.indexOf('const frameStyle'));
  const styles = source.match(/const frameStyle = `([\s\S]*?)`;/)[1];
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<style>
      article { position:relative; width:600px; padding:30px; }
      h2 { pointer-events:none; }
      a.overlay { position:absolute; inset:0; z-index:5; }
      a.overlay::after { content:''; position:absolute; inset:0; }
    </style><article class="job"><h2>Commercial H/F</h2><div>Aprolis</div>
      <a class="overlay" href="https://example.org/offer">Voir l’offre</a>
      <section><span>Premier</span><span>Salaire</span></section>
      <section><span>Autre</span><span>Expérience</span></section>
    </article><style>${styles}</style>`);
    const result = await page.evaluate((helpers) => {
      const api = new Function(`${helpers}; return { targetAtPoint, selectorFor };`)();
      const doc = document;
      const title = doc.querySelector('h2');
      const rect = title.getBoundingClientRect();
      const event = { clientX: rect.left + 30, clientY: rect.top + rect.height / 2, target: doc.querySelector('a') };
      const target = api.targetAtPoint(doc, event);
      const root = doc.querySelector('article');
      const selected = root.querySelectorAll('section')[1].children[1];
      const selector = api.selectorFor(selected, root);
      return { target: target.tagName, text: target.textContent, selector,
        matches: root.querySelectorAll(selector).length, matchedText: root.querySelector(selector)?.textContent };
    }, helpers);
    assert.equal(result.target, 'H2');
    assert.equal(result.text, 'Commercial H/F');
    assert.equal(result.matches, 1);
    assert.equal(result.matchedText, 'Expérience');
    console.log('PASS: overlapping link selects the title; ambiguous selector resolves the exact field.');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
