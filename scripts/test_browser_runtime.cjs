const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const runtimeRequire = createRequire(path.join(process.env.CODEX_NODE_MODULES, '_test.cjs'));
const { chromium } = runtimeRequire('playwright');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    const startupLogs = [];
    const workerURLs = [];
    page.on('worker', worker => workerURLs.push(worker.url()));
    page.on('console', message => { if (/\[ScanWorker\]|\[ScanController\]/.test(message.text())) startupLogs.push(message.text()); });
    page.on('requestfailed', request => console.log('Request failed:', request.url(), request.failure()?.errorText));
    page.on('console', message => { if (message.type() === 'error') console.log('Browser:', message.text()); });
    const profileId = '22222222-2222-4222-8222-222222222222';
    const jobId = '11111111-1111-4111-8111-111111111111';
    const userId = '33333333-3333-4333-8333-333333333333';
    const config = { id: profileId, student: { min_weeks: 0 }, target: { job_titles: ['Embedded systems'] },
      location: { countries: ['Switzerland'], acceptable_language: ['en'] }, skills: { core: ['Python', 'Embedded'] },
      search: { minimum_score: 0 }, sources: {} };
    let job = { id: jobId, profile_id: profileId, user_id: userId, mode: 'Rapide', phase: 'analyze',
      status: 'queued', progress_percent: 45, created_at: new Date().toISOString(), summary: {},
      checkpoint: { executor: 'browser', discovery_complete: true, direct_candidates: 1, profile_config: config },
      next_run_at: new Date().toISOString(), lease_token: null, lease_until: null, cancel_requested: false };
    const candidate = { id: 1, status: 'pending', payload: { url: 'https://careers.example.org/job/1', title: 'Embedded Systems Internship', source: 'careers.example.org' }, decision: {} };
    const missing = { id: 2, status: 'pending', payload: { url: 'https://careers.example.org/job/gone', title: 'Removed Internship', source: 'careers.example.org' }, decision: {} };
    const candidates = [candidate, missing];
    job.checkpoint.direct_candidates = candidates.length;
    const offers = [];
    const networkActions = [];
    const description = 'We offer an internship in embedded systems, Python, robotics and electrical engineering. English is required. Duration 6 months. '.repeat(20);
    const posting = { '@context': 'https://schema.org', '@type': 'JobPosting', title: candidate.payload.title,
      employmentType: 'INTERN', hiringOrganization: { name: 'Example Robotics' }, description,
      jobLocation: { address: { addressLocality: 'Lausanne', addressCountry: 'CH' } } };
    await page.route('**/api/scan_browser', async route => {
      const body = route.request().postDataJSON();
      networkActions.push(body.action);
      let data;
      if (body.action === 'resume') { job = { ...job, checkpoint: { ...job.checkpoint, paused: false } }; data = job; }
      else if (body.action === 'mirror') data = [];
      else if (body.action === 'state') data = { ...job, search_backends: ['duckduckgo', 'yahoo'] };
      else if (body.action === 'rpc') {
        if (body.name === 'hunter_claim_scan_job') {
          job = { ...job, status: 'running', lease_token: 'fixture-lease', lease_until: new Date(Date.now() + 280000).toISOString() };
          data = [{ ...job }];
        } else if (body.name === 'hunter_apply_scan_decisions') {
          for (const row of body.args.p_rows) Object.assign(candidates.find(item => item.id === row.id), row);
          data = body.args.p_rows.length;
        } else if (body.name === 'hunter_release_scan_job') {
          job = { ...job, checkpoint: body.args.p_checkpoint, phase: body.args.p_phase,
            progress_percent: body.args.p_progress_percent, status: body.args.p_completed ? 'completed' : 'queued',
            lease_token: null, lease_until: null }; data = true;
        } else throw new Error('Unexpected RPC ' + body.name);
      } else if (body.action === 'fetch') {
        if (body.url.endsWith('/gone')) {
          data = { html: '', url: body.url, meta: { status: 'http_error', http_status: 404, bytes_read: 0 } };
        } else {
        data = { html: `<html><head><script type="application/ld+json">${JSON.stringify(posting)}</script></head><body><h1>${posting.title}</h1><article>${description}</article><button>Apply now</button></body></html>`,
          url: candidate.payload.url, meta: { status: 'ok', http_status: 200, bytes_read: 4000 } };
        }
      } else if (body.action === 'store') {
        const [table, query = ''] = body.path.split('?');
        const params = new URLSearchParams(query);
        if (body.method === 'POST') {
          if (table === 'hunter_offers') for (const offer of body.body) offers.push({ ...offer, id: offers.length + 1 });
          data = null;
        } else if (body.method === 'PATCH') {
          if (table === 'hunter_scan_jobs') Object.assign(job, body.body);
          if (table === 'hunter_offers') for (const offer of offers) Object.assign(offer, body.body);
          data = null;
        } else if (table === 'hunter_scan_jobs') data = params.get('status') === 'eq.completed' && job.status !== 'completed' ? [] : [{ ...job }];
        else if (table === 'hunter_profiles') data = [{ config }];
        else if (table === 'hunter_scan_candidates') {
          const filter = params.get('status');
          data = candidates.filter(item => !filter || filter.includes(item.status)).map(item => ({ ...item }));
        } else if (table === 'hunter_offers') data = offers.map(offer => ({ ...offer }));
        else data = [];
      } else throw new Error('Unexpected action ' + body.action);
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data, metrics: { server_cpu_ms: 1 } }) });
    });
    await page.route('http://127.0.0.1:5177/', route => route.fulfill({ contentType: 'text/html', body: '<title>Scan runtime test</title><p>Test du moteur navigateur</p>' }));
    await page.goto('http://127.0.0.1:5177/');
    const filename = fs.readdirSync(path.join(__dirname, '../web/dist-cloud/assets')).find(name => name.startsWith('scan.worker-'));
    const result = await page.evaluate(async ({ filename, jobId }) => {
      return await new Promise(resolve => {
        const worker = new Worker(`/assets/${filename}`, { type: 'module' });
        const timeout = setTimeout(() => { worker.terminate(); resolve({ error: 'Initialization timeout' }); }, 180000);
        let sequence = 1;
        worker.onmessage = event => {
          if (!event.data.id) return;
          if (event.data.error || sequence > 10) { clearTimeout(timeout); worker.terminate(); resolve(event.data); return; }
          if (event.data.result?.job?.status === 'completed') { clearTimeout(timeout); worker.terminate(); resolve(event.data); return; }
          worker.postMessage({ id: ++sequence, type: 'step', power: 'normal' });
        };
        worker.onerror = event => { clearTimeout(timeout); worker.terminate(); resolve({ error: event.message }); };
        worker.postMessage({ id: 1, type: 'init', config: { origin: location.origin, accessToken: 'fixture-not-a-secret', jobId, searchBackends: ['duckduckgo', 'yahoo'] } });
      });
    }, { filename, jobId });
    console.log(JSON.stringify({ status: result.result?.job?.status, newOffers: offers.length, backendCalls: networkActions.length, error: result.error }));
    assert.equal(result.result?.job?.status, 'completed', result.error);
    assert.equal(offers.length, 1);
    assert.equal(offers[0].company, 'Example Robotics');
    assert(offers[0].score > 0);
    if (process.env.CODEX_PYTHON) {
      const python = spawnSync(process.env.CODEX_PYTHON, ['-c', `import json, sys
import stage_hunter as e
data = json.load(sys.stdin)
html, url, p = data['html'], data['url'], data['profile']
s = e.extract_job_posting(html, url)
txt = e.job_relevant_text('', html, s)
title = s.get('title')
meta = e.detect_meta(title, txt, p, data['offer'].get('location',''))
score, confidence, reasons = e.score(title, txt, meta, 'offer', p, url, s.get('company'))
print(json.dumps({'score':score,'confidence':confidence,'reasons':'\\n'.join(reasons)}, ensure_ascii=False))`],
        { input: JSON.stringify({ html: `<html><head><script type="application/ld+json">${JSON.stringify(posting)}</script></head><body><h1>${posting.title}</h1><article>${description}</article><button>Apply now</button></body></html>`, url: candidate.payload.url, profile: config, offer: offers[0] }),
          cwd: path.join(__dirname, '..'), encoding: 'utf8' });
      assert.equal(python.status, 0, python.stderr);
      const expected = JSON.parse(python.stdout);
      assert.equal(offers[0].score, expected.score, 'Python server / Worker scoring parity');
      assert.equal(offers[0].confidence, expected.confidence, 'Python server / Worker confidence parity');
      assert.equal(offers[0].reasons, expected.reasons, 'Python server / Worker reasons parity');
      console.log('PASS: score, confidence and reasons match the existing server Python engine.');
    }
    assert.equal(networkActions.filter(action => action === 'fetch').length, 2);
    assert.notEqual(missing.status, 'pending');
    console.log('PASS: real Python/WASM parsing, scoring, persistence, checkpoint, source 404 isolation and finalization.');
    const checkpointSource = fs.readFileSync(path.join(__dirname, '../web/src/scan/CheckpointManager.js'), 'utf8');
    await page.route('**/checkpoint-test.js', route => route.fulfill({ contentType: 'application/javascript', body: checkpointSource }));
    await page.evaluate(async job => {
      const { CheckpointManager } = await import('/checkpoint-test.js');
      await new CheckpointManager().save({ userId: 'checkpoint-fixture', job, metrics: {}, power: 'eco', logs: [], accessToken: 'must-not-be-saved', html: '<huge html>' });
    }, job);
    await page.reload();
    const recovered = await page.evaluate(async () => {
      const { CheckpointManager } = await import('/checkpoint-test.js');
      const manager = new CheckpointManager();
      const own = await manager.load('checkpoint-fixture');
      const other = await manager.load('another-user');
      await manager.remove('checkpoint-fixture');
      return { own, other, removed: !(await manager.load('checkpoint-fixture')) };
    });
    assert.equal(recovered.own.job.id, jobId);
    assert.equal(recovered.own.power, 'eco');
    assert(!JSON.stringify(recovered).includes('must-not-be-saved'));
    assert(!JSON.stringify(recovered).includes('huge html'));
    assert.equal(recovered.other, undefined);
    assert(recovered.removed);
    console.log('PASS: real IndexedDB survives reload, isolates users, excludes token/HTML and removes checkpoint.');
    // Render the actual CloudApp with an isolated, fake authenticated session.
    job = { ...job, status: 'queued', checkpoint: { ...job.checkpoint, paused: true } };
    const expires = Math.floor(Date.now() / 1000) + 3600;
    const jwt = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: userId, exp: expires, role: 'authenticated' })).toString('base64url')}.fixture`;
    const user = { id: userId, email: 'fixture@example.org', app_metadata: {}, user_metadata: {} };
    await page.route('**/auth/v1/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(user) }));
    await page.route('**/rest/v1/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(route.request().url().includes('/hunter_profiles') ? [{ id: profileId, name: 'Profil test', config }] : []) }));
    let browserReady = true;
    await page.route('**/api/scan', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ready: false, browser_ready: browserReady }) }));
    await page.route('**/api/google**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ connected: false }) }));
    await page.evaluate(async ({ job, jwt, expires, user }) => {
      localStorage.setItem('sb-seacseklrbucmgxaykgc-auth-token', JSON.stringify({ access_token: jwt, refresh_token: 'fixture-refresh', expires_at: expires, expires_in: 3600, token_type: 'bearer', user }));
      const { CheckpointManager } = await import('/checkpoint-test.js');
      await new CheckpointManager().save({ userId: user.id, job, metrics: { backendRequests: 28, transferredBytes: 4000, serverCpuMs: 28, pagesFetched: 2, errors: 1 }, power: 'normal', logs: [] });
    }, { job, jwt, expires, user });
    await page.unroute('http://127.0.0.1:5177/');
    await page.goto('http://127.0.0.1:5177/');
    await page.getByRole('region', { name: 'Scan global' }).waitFor();
    await page.getByRole('button', { name: 'Mes offres', exact: true }).click();
    await page.getByRole('region', { name: 'Scan global' }).waitFor();
    await page.getByRole('button', { name: 'Vue d’ensemble', exact: true }).click();
    await page.getByRole('button', { name: 'Reprendre', exact: true }).waitFor();
    const errors = await page.locator('.sh-toast.error').allTextContents();
    assert.equal(errors.length, 0, errors.join('; '));
    fs.mkdirSync(path.join(__dirname, '../.test_temp'), { recursive: true });
    await page.screenshot({ path: path.join(__dirname, '../.test_temp/browser-scan-panel.png'), fullPage: true });
    console.log('PASS: real CloudApp keeps recoverable scan panel across offers/dashboard navigation.');
    await page.getByRole('button', { name: 'Recherche & Scan', exact: true }).click();
    await page.getByLabel('Exécuter le scan sur cet appareil').waitFor();
    assert.equal(await page.getByText('Worker Python en cours d’initialisation...', { exact: false }).count(), 0);
    const before = workerURLs.length;
    await page.getByRole('button', { name: 'Reprendre', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[aria-label="Scan global"]'), null, { timeout: 45000 });
    assert(workerURLs.length > before, 'ScanController must actually create its Worker');
    for (const stage of ['creating worker', 'worker created', 'loading runtime', 'loading pyodide', 'pyodide loaded', 'loading packages', 'loading Python files', 'engine initialized', 'READY']) {
      assert(startupLogs.some(line => line.includes(`[ScanWorker] ${stage}`)), `Missing startup stage ${stage}`);
    }
    assert(startupLogs.includes('[ScanController] READY'));
    assert.equal(await page.getByRole('alert').count(), 0);
    console.log('PASS: production CloudApp → ScanController → WorkerPool → real Worker → Pyodide → engine → READY.');
    browserReady = false;
    const idleWorkers = workerURLs.length;
    await page.reload();
    await page.getByText('Le moteur sélectionné n’est pas disponible.', { exact: false }).waitFor();
    assert.equal(workerURLs.length, idleWorkers, 'Opening Search must not silently start a Worker');
    assert.equal(await page.getByText('Worker Python en cours d’initialisation...', { exact: false }).count(), 0);
    console.log('PASS: unavailable readiness is explicit; idle Search never claims Python is initializing.');
    browserReady = true;
    job = { ...job, status: 'queued', checkpoint: { ...job.checkpoint, paused: true } };
    await page.evaluate(async ({ job, userId }) => {
      const { CheckpointManager } = await import('/checkpoint-test.js');
      await new CheckpointManager().save({ userId, job, metrics: {}, power: 'normal', logs: [] });
    }, { job, userId });
    await page.route('**/scan-runtime/manifest.json', route => route.fulfill({ contentType: 'text/html', body: '<html>Preview auth or SPA fallback</html>' }));
    await page.reload();
    await page.getByRole('button', { name: 'Reprendre', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Le manifest du moteur ne renvoie pas du JSON' }).waitFor({ timeout: 45000 });
    await page.getByRole('button', { name: 'Réessayer', exact: true }).waitFor();
    await page.unroute('**/scan-runtime/manifest.json');
    await page.getByRole('button', { name: 'Réessayer', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[aria-label="Scan global"]'), null, { timeout: 45000 });
    console.log('PASS: invalid Preview asset propagates to visible error and retry reaches READY/completion.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
