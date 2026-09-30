// End-to-end browser regression against the built UI and real temporary SQLite CV storage.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const runtimeRequire = createRequire(path.join(process.env.CODEX_NODE_MODULES, '_cv_test.cjs'));
const { chromium } = runtimeRequire('playwright');
const root = path.join(__dirname, '..');
const dist = path.join(root, process.env.CODEX_CV_DIST || 'web/dist-cv-check');
const testRoot = fs.mkdtempSync(path.join(root, '.test_temp/cv-browser-'));
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json' };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const json = (data, status = 200) => { res.writeHead(status, { 'Content-Type':'application/json' }); res.end(JSON.stringify(data)); };
  if (url.pathname === '/api/profiles') return json([{ id:'cvtest', name:'Test CV' }]);
  if (url.pathname === '/api/state') return json({ profile:{ name:'Test CV' }, stats:{}, scan:{} });
  if (url.pathname === '/api/cvs') {
    let body = ''; for await (const chunk of req) body += chunk;
    const data = body ? JSON.parse(body) : { profile:url.searchParams.get('profile'), action:'list' };
    const code = "import sys,json; from pathlib import Path; from cv_store import cv_request; d=json.load(sys.stdin); print(json.dumps(cv_request(Path(sys.argv[1]),d.get('action','list'),d)))";
    const result = spawnSync(process.env.CODEX_PYTHON, ['-X', 'utf8', '-c', code, path.join(testRoot, `${data.profile}.sqlite3`)],
      { cwd:root, input:JSON.stringify(data), encoding:'utf8' });
    if (result.status !== 0) console.log('API ERROR', result.stderr);
    return result.status === 0 ? json(JSON.parse(result.stdout)) : json({ error:result.stderr }, 400);
  }
  if (url.pathname.startsWith('/api/')) return json({});
  const file = path.join(dist, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!file.startsWith(dist) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type':mime[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel:'msedge', headless:true });
  try {
    const page = await browser.newPage({ acceptDownloads:true, viewport:{ width:1600, height:1000 } });
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); console.log('PAGE ERROR', error.stack); });
    page.on('dialog', dialog => { console.log('DIALOG', dialog.message()); dialog.dismiss(); });
    await page.goto(`http://127.0.0.1:${server.address().port}/#cvs`);
    await page.getByRole('heading', { name:'Mes CV', exact:true }).waitFor();
    await page.getByRole('textbox', { name:'Titre du nouveau CV' }).fill('CV React France');
    await page.getByRole('button', { name:'Créer un CV' }).click();
    const save = page.getByRole('button', { name:'Enregistrer', exact:true });
    await save.waitFor();
    await page.waitForFunction(() => !document.querySelector('.cv-document-bar .sh-btn-primary')?.disabled);
    const editor = page.frameLocator('iframe[title="Éditeur de CV"]');
    await editor.locator('#cv-name').fill('Camille Exemple');
    await editor.locator('#cv-title').fill('Développeuse React');
    await save.click();
    await page.getByText('CV enregistré en base.', { exact:true }).waitFor();
    await page.reload();
    await page.getByRole('button', { name:/CV React France/ }).click();
    await page.waitForFunction(() => !document.querySelector('.cv-document-bar .sh-btn-primary')?.disabled);
    assert.equal(await editor.locator('#cv-name').innerText(), 'Camille Exemple');
    assert.equal(await editor.locator('#cv-title').innerText(), 'Développeuse React');
    // Saving and reopening the same document must recreate the iframe correctly.
    await page.getByRole('button', { name:/CV React France/ }).click();
    await page.waitForFunction(() => !document.querySelector('.cv-document-bar .sh-btn-primary')?.disabled);
    await page.getByRole('button', { name:'Dupliquer', exact:true }).click();
    await page.getByRole('button', { name:/CV React France — copie/ }).waitFor();
    await page.waitForFunction(() => !document.querySelector('.cv-document-bar .sh-btn-primary')?.disabled);
    assert.equal(await editor.locator('#cv-name').innerText(), 'Camille Exemple');
    await page.getByRole('textbox', { name:'Titre du CV', exact:true }).fill('CV Suisse');
    await save.click();
    await page.getByText('CV enregistré en base.', { exact:true }).waitFor();
    const downloadPromise = page.waitForEvent('download', { timeout:45000 });
    await page.getByRole('button', { name:'Télécharger PDF' }).click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), 'CV Suisse.pdf');
    const pdfPath = path.join(testRoot, 'cv.pdf');
    await download.saveAs(pdfPath);
    const pdf = fs.readFileSync(pdfPath);
    assert.equal(pdf.subarray(0,4).toString(), '%PDF');
    assert.ok(pdf.length > 10000, 'PDF must contain the rendered CV');
    await page.screenshot({ path:path.join(testRoot,'cv-library.png'), fullPage:true });
    await editor.locator('#cv-name').fill('Brouillon récupéré');
    await page.getByRole('button', { name:/CV React France/ }).click();
    await page.getByRole('button', { name:/CV Suisse/ }).click();
    await page.waitForFunction(() => !document.querySelector('.cv-document-bar .sh-btn-primary')?.disabled);
    assert.equal(await editor.locator('#cv-name').innerText(), 'Brouillon récupéré');
    await save.click();
    await page.getByText('CV enregistré en base.', { exact:true }).waitFor();
    const editorFrame = await (await page.locator('iframe[title="Éditeur de CV"]').elementHandle()).contentFrame();
    const imported = await editorFrame.evaluate(() => JSON.parse(editorStorage.getItem('cv-data-v17')));
    imported.name = 'Ancien CV importé';
    await editor.locator('#file-load-input').setInputFiles({ name:'ancien-cv.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(imported)) });
    await editor.locator('#cv-name').filter({ hasText:'Ancien CV importé' }).waitFor();
    await save.click();
    await page.getByText('CV enregistré en base.', { exact:true }).waitFor();
    await page.getByRole('button', { name:'Supprimer', exact:true }).last().click();
    await page.getByRole('dialog').getByRole('button', { name:'Supprimer', exact:true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.cv-list-item').length === 1);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ result:'PASS', checks:'create, edit, SQLite save, reload, reopen, duplicate, rename, real PDF download, recover draft, JSON import, delete, no page errors', artifacts:testRoot }));
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode=1; });
