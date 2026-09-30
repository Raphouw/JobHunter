// The mutable Python engine owns one durable lease. Nothing runs on the UI thread.
let runtime;
let config;
let busy = false;
let leaseToken = null;
function stage(name) {
  console.log(`[BrowserScan:${config?.initializationId || 'standalone'}] [ScanWorker] ${name}`);
  self.postMessage({ type: 'initialization', stage: name });
}
self.postMessage({ type: 'initialization', stage: 'worker script loaded' });
async function asset(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Asset indisponible : HTTP ${response.status} (${url})`);
  return response;
}

function transport(serialized) {
  const body = JSON.parse(serialized);
  const request = new XMLHttpRequest();
  request.open('POST', `${config.origin}/api/scan_browser`, false);
  request.timeout = 60000;
  request.setRequestHeader('Authorization', `Bearer ${config.accessToken}`);
  request.setRequestHeader('Content-Type', 'application/json');
  const payload = JSON.stringify({ ...body, job_id: config.jobId });
  const started = performance.now();
  request.send(payload);
  let result;
  try { result = JSON.parse(request.responseText); }
  catch { throw new Error('Réponse backend illisible'); }
  self.postMessage({ type: 'transport', action: body.action,
    requests: 1, bytes: new TextEncoder().encode(payload + request.responseText).length,
    serverCpuMs: result.metrics?.server_cpu_ms || 0, wallMs: performance.now() - started,
    pages: body.action === 'fetch' ? 1 : 0,
    error: request.status >= 400 ? result.error || `HTTP ${request.status}` :
      result.data?.meta?.http_status >= 400 ? `Source HTTP ${result.data.meta.http_status}` : '' });
  config.transportMetrics = config.transportMetrics || { backendRequests: 0, transferredBytes: 0, serverCpuMs: 0 };
  config.transportMetrics.backendRequests++;
  config.transportMetrics.transferredBytes += new TextEncoder().encode(payload + request.responseText).length;
  config.transportMetrics.serverCpuMs += result.metrics?.server_cpu_ms || 0;
  if (request.status >= 400) throw new Error(result.error || `HTTP ${request.status}`);
  if (body.action === 'rpc' && body.name === 'hunter_claim_scan_job' && result.data?.[0]) {
    leaseToken = result.data[0].lease_token;
  }
  return JSON.stringify(result.data);
}

async function init(input) {
  config = input;
  stage('loading runtime');
  // No secrets sent to this CDN: assets are public packages only. Tokens are
  // passed exclusively to the same-origin transport above.
  const indexURL = 'https://cdn.jsdelivr.net/pyodide/v0.29.3/full/';
  stage('loading pyodide');
  const { loadPyodide } = await import(/* @vite-ignore */ `${indexURL}pyodide.mjs`);
  runtime = await loadPyodide({ indexURL, stdout: () => {}, stderr: message => console.error(`[BrowserScan:${config.initializationId || 'standalone'}] [ScanWorker] Python stderr`, message) });
  stage('pyodide loaded');
  stage('loading packages');
  await runtime.loadPackage(['micropip', 'beautifulsoup4', 'pyyaml', 'requests', 'rich', 'lxml', 'regex', 'sqlite3']);
  await runtime.runPythonAsync(`import micropip
await micropip.install(['python-dotenv==1.2.1', 'lxml_html_clean==0.4.3', 'trafilatura==2.0.0'])`);
  stage('packages loaded');
  const baseURL = new URL(import.meta.env.BASE_URL, config.origin);
  const runtimeURL = new URL('scan-runtime/', baseURL);
  stage('loading Python files');
  const manifestResponse = await asset(new URL('manifest.json', runtimeURL));
  if (!manifestResponse.headers.get('content-type')?.includes('application/json')) {
    throw new Error('Le manifest du moteur ne renvoie pas du JSON. Vérifiez les assets, le routage et l’accès au Preview.');
  }
  const manifest = await manifestResponse.json();
  if (!Array.isArray(manifest.files)) throw new Error('Manifest du moteur invalide');
  runtime.FS.mkdirTree('/app');
  // Bounded asset downloads rather than Promise.all over the entire manifest.
  for (let i = 0; i < manifest.files.length; i += 4) {
    await Promise.all(manifest.files.slice(i, i + 4).map(async name => {
      if (!/^[a-zA-Z0-9_./-]+$/.test(name) || name.includes('..')) throw new Error('Manifest invalide');
      const response = await asset(new URL(name, runtimeURL));
      const data = new Uint8Array(await response.arrayBuffer());
      const target = `/app/${name}`;
      runtime.FS.mkdirTree(target.slice(0, target.lastIndexOf('/')));
      runtime.FS.writeFile(target, data);
    }));
  }
  runtime.registerJsModule('browser_bridge_js', {
    transport,
    metrics: () => JSON.stringify(config.transportMetrics || {}),
    event: (message, style) => self.postMessage({ type: 'event', message, style }),
  });
  runtime.globals.set('browser_backends_json', JSON.stringify(input.searchBackends || ['duckduckgo', 'yahoo']));
  await runtime.runPythonAsync(`import os, sys, types, json
sys.path.insert(0, '/app')
sys.path.insert(0, '/app/vendor/rapidfuzz-3.14.6.zip')
os.environ['RAPIDFUZZ_IMPLEMENTATION'] = 'python'
ddgs = types.ModuleType('ddgs')
class ServerSearchOnly:
    def __init__(self, *args, **kwargs): raise RuntimeError('Recherche exclusivement serveur')
ddgs.DDGS = ServerSearchOnly
sys.modules['ddgs'] = ddgs
from browser_bridge_js import transport, event
from cloud import browser_runtime
browser_runtime.install(transport, event)
browser_runtime.engine.configured_search_backends = lambda: (json.loads(browser_backends_json), [], [], False)`);
  stage('engine initialized');
  stage('READY');
}

self.onmessage = async ({ data }) => {
  if (data.type === 'session') {
    if (config) config.accessToken = data.accessToken;
    return;
  }
  if (busy) {
    self.postMessage({ id: data.id, error: 'Une tâche est déjà active' });
    return;
  }
  busy = true;
  try {
    if (data.type === 'init') await init(data.config);
    else if (data.type === 'step') {
      runtime.globals.set('browser_job_id', config.jobId);
      runtime.globals.set('browser_power', data.power || 'normal');
      const result = await runtime.runPythonAsync('browser_runtime.step(browser_job_id, browser_power)');
      self.postMessage({ id: data.id, result: JSON.parse(result) });
      return;
    } else throw new Error('Commande Worker invalide');
    self.postMessage({ id: data.id, result: { ready: true } });
  } catch (error) {
    console.error(`[BrowserScan:${config?.initializationId || 'standalone'}] [ScanWorker] initialization/task failed`, error);
    self.postMessage({ id: data.id, error: String(error.message || error).slice(-1200) });
  } finally {
    busy = false;
  }
};
