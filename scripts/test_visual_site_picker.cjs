// Browser regression for text hit testing and ambiguous sibling selectors.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
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
      const api = new Function(`const MAX_SELECTOR_LENGTH = 2048; ${helpers}; return { targetAtPoint, selectorFor };`)();
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

    const deepBranch = (text) => `<section>${'<div>'.repeat(15)}<span>${text}</span>${'</div>'.repeat(15)}</section>`;
    await page.setContent(`<article>${deepBranch('Premier')}${deepBranch('Deuxième')}</article>`);
    const deep = await page.evaluate((helpers) => {
      const api = new Function(`const MAX_SELECTOR_LENGTH = 2048; ${helpers}; return { selectorFor };`)();
      const root = document.querySelector('article');
      const target = root.querySelectorAll('span')[1];
      const selector = api.selectorFor(target, root);
      return { selector, correct: root.querySelector(selector) === target };
    }, helpers);
    assert.ok(deep.correct);
    assert.ok(deep.selector.length > 180 && deep.selector.length <= 2048);
    console.log('PASS: deep paths remain precise and within the server limit.');

    const utilities = fs.readFileSync(path.join(__dirname, '../web/src/cloud/site-selector-utils.js'), 'utf8').replace(/export /g, '');
    await page.setContent(`<style>#steps { display:flex; gap:8px; overflow:auto; width:600px; position:relative; box-sizing:border-box; }
      button { flex-shrink:0; width:100px; }</style><div id="steps">${Array.from({length:15}, (_, index) => `<button data-field="field${index}">Étape ${index}</button>`).join('')}</div>`);
    for (const index of [2, 8, 14]) {
      const scroll = await page.evaluate(({ utilities, index }) => {
        const api = new Function(`${utilities}; return { scrollSelectedStep };`)();
        const bar = document.querySelector('#steps');
        api.scrollSelectedStep(bar, `field${index}`, 'auto');
        const left = bar.getBoundingClientRect().left;
        const visible = [...bar.children].filter((child) => child.getBoundingClientRect().right > left + 1);
        return { third: visible[2].dataset.field, firstLeft: visible[0].getBoundingClientRect().left - left };
      }, { utilities, index });
      assert.equal(scroll.third, `field${index}`);
      assert.ok(Math.abs(scroll.firstLeft) <= 1);
    }
    console.log('PASS: selected step is third from the left, including the final step.');

    // Exercise the real React editor, including draft saves and optional fields.
    const vite = await import(pathToFileURL(fs.realpathSync(path.join(__dirname, '../web/node_modules/vite/dist/node/index.js'))).href);
    const fixtureDirectory = path.join(__dirname, '../web/.test_temp');
    fs.mkdirSync(fixtureDirectory, { recursive: true });
    const fixturePath = path.join(fixtureDirectory, 'site-picker.fixture.jsx');
    fs.writeFileSync(fixturePath, `import React from 'react'; import { createRoot } from 'react-dom/client';
        import { SiteConfigEditor } from '../src/cloud/SiteConfigEditor.jsx';
        createRoot(document.getElementById('app')).render(<SiteConfigEditor
          profile={{ id: '4fb77d84-373e-45a7-a205-0937d55981ac', location: {countries:['France']}, sources: {} }}
          accessToken="test" onSaved={async () => {}} />);`);
    const bundle = await vite.build({
      root: path.join(__dirname, '../web'), configFile: false, logLevel: 'error',
      build: { write: false, rollupOptions: { input: fixturePath, output: { format: 'iife', inlineDynamicImports: true } } },
    });
    await page.setContent('<div id="app"></div>');
    await page.addStyleTag({ content: fs.readFileSync(path.join(__dirname, '../web/src/style.css'), 'utf8') });
    const css = bundle.output.find((file) => file.fileName.endsWith('.css'));
    if (css) await page.addStyleTag({ content: String(css.source) });
    await page.evaluate(() => {
      window.requests = [];
      window.fetch = async (_, options) => {
        const body = JSON.parse(options.body);
        window.requests.push(body);
        let result = {};
        if (body.action === 'catalog') result = { recipes: [], references: [], is_admin: false };
        if (body.action === 'save') result = { site: { ...body.site, id: 'b363b84c-c8c0-4822-8433-b7d5892b7d7f' } };
        if (body.action === 'inspect') result = { url: 'https://example.org/jobs', html:
          '<article class="job" style="padding:20px"><h2 class="title">Commercial</h2><a href="https://example.org/1">Voir l’offre</a></article>' };
        return { ok: true, json: async () => result };
      };
    });
    await page.addScriptTag({ content: bundle.output.find((file) => file.fileName.endsWith('.js')).code });
    await page.getByPlaceholder('ex: JobUp Suisse, WTTJ, etc.').fill('Exemple');
    await page.getByPlaceholder('https://exemple.ch/jobs?q={keywords}&loc={location}').fill('https://example.org/jobs');
    await page.getByRole('button', { name: 'Enregistrer le brouillon' }).click();
    await page.waitForFunction(() => window.requests.some((request) => request.action === 'save'));
    const draft = await page.evaluate(() => window.requests.find((request) => request.action === 'save'));
    assert.equal(draft.site.selectors.card, '');
    assert.equal(draft.site.selectors.title, '');
    await page.locator('#site-selectors-card').fill('article.job');
    await page.locator('#site-selectors-title').fill('.title');
    await page.getByRole('button', { name: 'Ouvrir la page de listing et sélectionner' }).click();
    await page.locator('iframe').waitFor();
    await page.locator('[data-field="company"]').click();
    await page.locator('.sh-picker-field-actions').getByRole('button', { name: 'Absent sur cette page' }).click();
    await page.locator('[data-field="company"]').getByText('Absent', { exact: true }).waitFor();
    assert.equal(await page.locator('#site-selectors-company').inputValue(), '');
    await page.locator('#site-detail_selectors-location').fill('div[');
    await page.locator('#site-detail_selectors-contract').fill('a[');
    await page.getByRole('button', { name: 'Tester l’extraction réelle' }).click();
    assert.equal(await page.locator('#site-detail_selectors-location').getAttribute('aria-invalid'), 'true');
    assert.equal(await page.locator('#site-detail_selectors-contract').getAttribute('aria-invalid'), 'true');
    assert.equal(await page.evaluate(() => window.requests.filter((request) => request.action === 'preview').length), 0);
    await page.locator('#site-detail_selectors-location').locator('..').getByRole('button', { name: 'Absent sur cette page' }).click();
    assert.equal(await page.locator('#site-detail_selectors-location').getAttribute('aria-invalid'), 'false');
    await page.setViewportSize({ width: 390, height: 900 });
    await page.locator('[data-field="education"]').click();
    await page.waitForFunction(() => {
      const bar = document.querySelector('.sh-picker-stepper-bar');
      const active = bar.querySelector('[aria-current="step"]');
      const rect = active.getBoundingClientRect();
      const bounds = bar.getBoundingClientRect();
      return rect.left >= bounds.left && rect.right <= bounds.right;
    });
    console.log('PASS: real editor saves incomplete drafts, skips absent fields and shows all errors beside inputs.');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
