import { WorkerPool, powerBudget } from './WorkerPool.js';
import { CheckpointManager } from './CheckpointManager.js';
import { InitializationAttempt, BROWSER_SCAN_BUILD, traceInitialization } from './InitializationAttempt.js';

const terminal = job => ['completed', 'cancelled', 'failed'].includes(job?.status);
const blankMetrics = () => ({ backendRequests: 0, transferredBytes: 0, serverCpuMs: 0,
  pagesFetched: 0, errors: 0, retries: 0, peakJsHeapBytes: null });

export class ScanController {
  constructor({ userId, getSession, transport, checkpoints, poolFactory, initializationTimeout = 30000, onSettled = () => {} }) {
    this.userId = userId;
    this.getSession = getSession;
    this.transport = transport;
    this.checkpoints = checkpoints || new CheckpointManager();
    this.poolFactory = poolFactory || (options => new WorkerPool(options));
    this.onSettled = onSettled;
    this.initializationTimeout = initializationTimeout;
    this.listeners = new Set();
    this.snapshot = { userId, status: 'idle', initializationState: 'idle', job: null,
      metrics: blankMetrics(), power: 'normal', logs: [], error: '', build: BROWSER_SCAN_BUILD };
    this.initializationSequence = 0;
    this.generation = 0;
    this.writes = Promise.resolve();
    this.lockRelease = null;
    this.pendingControl = false;
  }
  subscribe = listener => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getSnapshot = () => this.snapshot;
  reserveInitializationId = () => `init#${++this.initializationSequence}`;
  beginInitialization(id = this.reserveInitializationId()) {
    this.pendingControl = true;
    const attempt = new InitializationAttempt(id, this.initializationTimeout, error => {
      if (this.attempt !== attempt) return;
      console.error(`[BrowserScan:${id}] failed`, error);
      this.pool?.terminate(error);
      this.pendingControl = false;
      this.publish({ status: 'recoverable', workers: 0, error: error.message,
        initializationState: error.name === 'InitializationTimeoutError' ? 'timeout' : 'error',
        metrics: { ...this.snapshot.metrics, errors: this.snapshot.metrics.errors + 1 } });
      // UI/retry must never await whichever operation is blocked.
      this.releaseLock().catch(() => {});
      if (this.snapshot.job) this.save().catch(() => {});
    }, () => this.snapshot.initializationStage || 'préparation');
    this.attempt = attempt;
    this.publish({ status: 'starting', initializationState: 'starting', initializationId: id,
      initializationStartedAt: Date.now(), initializationStage: 'Préparation du scan…', phaseLabel: 'Préparation du scan…', error: '' });
    return attempt;
  }
  initializationStage(attempt, state, message) {
    attempt.check();
    if (this.attempt !== attempt) throw new DOMException('Tentative remplacée', 'AbortError');
    traceInitialization(attempt.id, message);
    this.publish({ initializationState: state, initializationStage: message, phaseLabel: message });
  }
  publish(patch = {}) {
    const heap = globalThis.performance?.memory?.usedJSHeapSize;
    this.snapshot = { ...this.snapshot, ...patch, timestamp: Date.now() };
    if (heap) this.snapshot.metrics = { ...this.snapshot.metrics,
      peakJsHeapBytes: Math.max(heap, this.snapshot.metrics.peakJsHeapBytes || 0) };
    for (const listener of this.listeners) listener();
  }
  async api(body, signal) {
    const { access_token: accessToken } = await this.getSession();
    signal?.throwIfAborted();
    const response = await this.transport({ ...body, job_id: body.job_id || this.snapshot.job?.id }, accessToken, signal);
    signal?.throwIfAborted();
    this.publish({ metrics: { ...this.snapshot.metrics,
      backendRequests: this.snapshot.metrics.backendRequests + 1,
      serverCpuMs: this.snapshot.metrics.serverCpuMs + (response.metrics?.server_cpu_ms || 0) } });
    return response.data;
  }
  save() {
    const data = this.snapshot;
    this.writes = this.writes.catch(() => {}).then(() => this.checkpoints.save(data));
    return this.writes;
  }
  async recover() {
    const saved = await this.checkpoints.load(this.userId);
    if (!saved || saved.version !== 1 || saved.userId !== this.userId || !saved.job) return;
    const job = await this.api({ action: 'state', job_id: saved.job.id });
    if (terminal(job)) { await this.checkpoints.remove(this.userId); return; }
    if (this.snapshot.status === 'idle') this.publish({ ...saved, job, status: 'recoverable', error: '' });
  }
  async acquireLock(signal) {
    if (this.lockRelease || !globalThis.navigator?.locks) return;
    await new Promise((resolve, reject) => {
      this.lockDone = navigator.locks.request(`jobhunter-scan:${this.userId}`, { ifAvailable: true }, async lock => {
        if (signal?.aborted) { reject(signal.reason); return; }
        if (!lock) { reject(new Error('Un autre onglet pilote déjà ce scan')); return; }
        const held = new Promise(release => { this.lockRelease = release; });
        resolve();
        await held;
      }).catch(reject);
    });
  }
  releaseLock() {
    const done = this.lockDone;
    this.lockRelease?.(); this.lockRelease = null; this.lockDone = null;
    return done || Promise.resolve();
  }
  async start(profileId, mode, initializationId) {
    if ((!['idle', 'completed', 'cancelled'].includes(this.snapshot.status) &&
        !(this.snapshot.status === 'recoverable' && !this.snapshot.job)) || this.pendingControl) {
      throw new Error('Un scan est déjà actif ou récupérable');
    }
    this.pendingRequest = { profileId, mode };
    this.publish({ job: null, request: this.pendingRequest, metrics: blankMetrics(), logs: [] });
    const attempt = this.beginInitialization(initializationId);
    traceInitialization(attempt.id, 'controller start');
    try {
      await attempt.run(async () => {
        this.initializationStage(attempt, 'starting', 'Réservation du scan…');
        await this.acquireLock(attempt.abort.signal);
        this.initializationStage(attempt, 'starting', 'Vérification du checkpoint local…');
        await this.checkpoints.load(this.userId);
        this.initializationStage(attempt, 'starting', 'Création du job — session et backend…');
        const job = await this.api({ action: 'start', profile_id: profileId, mode }, attempt.abort.signal);
        attempt.check();
        this.publish({ job });
        this.initializationStage(attempt, 'starting', 'Sauvegarde du checkpoint…');
        await this.save();
        attempt.check();
        this.launch(attempt);
        await attempt.readyPromise;
      });
    } catch (error) {
      attempt.fail(error);
      throw error;
    }
    finally { this.pendingControl = false; }
  }
  setPower(power) {
    if (!['eco', 'normal', 'fast', 'maximum'].includes(power)) return;
    this.publish({ power });
    if (this.snapshot.job && !terminal(this.snapshot.job)) this.save().catch(error => this.publish({ error: error.message }));
  }
  launch(attempt = this.beginInitialization()) {
    const generation = ++this.generation;
    this.abort = attempt.abort;
    this.initializationStage(attempt, 'starting', 'initializing WorkerPool');
    const capacity = powerBudget(this.snapshot.power, navigator.hardwareConcurrency, navigator.deviceMemory);
    this.pool = this.poolFactory({ capacity, initializationId: attempt.id, onEvent: event => {
      if (generation !== this.generation || attempt.failed) return;
      if (event.type === 'transport') {
        const m = this.snapshot.metrics;
        this.publish({ metrics: { ...m, backendRequests: m.backendRequests + event.requests,
          transferredBytes: m.transferredBytes + event.bytes,
          serverCpuMs: m.serverCpuMs + event.serverCpuMs,
          pagesFetched: m.pagesFetched + event.pages,
          errors: m.errors + Number(Boolean(event.error)) } });
      } else if (event.type === 'event') {
        this.publish({ phaseLabel: event.message,
          logs: [...this.snapshot.logs.slice(-99), { message: event.message, created_at: new Date().toISOString() }] });
      } else if (event.type === 'initialization') {
        if (attempt.ready) return;
        const states = { 'worker created': 'worker_created', 'worker script loaded': 'worker_created',
          'loading runtime': 'runtime_loading', 'loading pyodide': 'pyodide_loading',
          'pyodide loaded': 'python_loading', 'loading packages': 'python_loading',
          'packages loaded': 'python_loading', 'loading Python files': 'python_loading', 'engine initialized': 'python_loading' };
        this.initializationStage(attempt, states[event.stage] || 'python_loading', `[ScanWorker] ${event.stage}`);
      }
    } });
    const run = async () => {
      const signal = this.abort.signal;
      const pool = this.pool;
      const initialize = async () => {
        this.initializationStage(attempt, 'starting', 'Vérification de la session…');
        const session = await this.getSession();
        if (signal.aborted || generation !== this.generation) return;
        this.initializationStage(attempt, 'starting', 'Chargement du scan…');
        const job = await this.api({ action: 'state' }, signal);
        if (signal.aborted || generation !== this.generation) return;
        this.initializationStage(attempt, 'starting', 'creating Worker');
        const result = await pool.execute('init', { config: { origin: location.origin, initializationId: attempt.id,
          accessToken: session.access_token, jobId: job.id, searchBackends: job.search_backends } }, Math.max(1, attempt.deadline - Date.now()));
        if (result?.ready !== true) throw new Error('Le Worker n’a pas confirmé READY');
      };
      await initialize();
      if (generation !== this.generation) return;
      attempt.markReady();
      this.pendingControl = false;
      traceInitialization(attempt.id, '[ScanController] READY');
      this.publish({ status: 'running', workers: 1, initializationState: 'ready', initializationStage: 'READY', phaseLabel: 'Moteur prêt' });
      while (generation === this.generation) {
        const session = await this.getSession();
        if (generation !== this.generation) return;
        this.pool.session(session.access_token);
        this.publish({ workers: 1 });
        const { job, claimed } = await this.pool.execute('step', { power: this.snapshot.power });
        if (generation !== this.generation) return;
        if (!job) throw new Error('Scan introuvable');
        this.publish({ job, workers: 0 });
        await this.save();
        if (terminal(job)) {
          this.publish({ status: job.status, workers: 0 });
          this.pool.terminate();
          await this.writes;
          await this.checkpoints.remove(this.userId);
          await this.releaseLock();
          this.onSettled(job);
          return;
        }
        const due = Math.max(Date.parse(job.next_run_at || '') || 0, Date.parse(job.lease_until || '') || 0);
        const pace = { eco: 1500, normal: 250, fast: 50, maximum: 0 }[this.snapshot.power];
        await this.delay(claimed ? Math.max(pace, due - Date.now()) : Math.max(1000, due - Date.now()), this.abort.signal);
      }
    };
    this.running = attempt.run(run).catch(error => {
      if (generation !== this.generation) return;
      attempt.fail(error);
    });
  }
  delay(ms, signal) {
    return new Promise((resolve, reject) => {
      const stop = () => { clearTimeout(timer); reject(new DOMException('Interrompu', 'AbortError')); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, Math.min(Math.max(ms, 0), 300000));
      signal.addEventListener('abort', stop, { once: true });
      if (signal.aborted) stop();
    });
  }
  stopLocal() {
    ++this.generation;
    this.abort?.abort();
    this.attempt?.cancel();
    this.pool?.terminate();
    this.publish({ workers: 0 });
  }
  async control(action) {
    if (!this.snapshot.job || this.pendingControl) return;
    this.pendingControl = true;
    try {
      await this.acquireLock();
      this.stopLocal();
      const job = await this.api({ action });
      this.publish({ job, status: action === 'cancel' ? 'cancelled' : action === 'pause' ? 'paused' : 'starting', error: '' });
      if (action === 'cancel') {
        await this.writes.catch(() => {});
        await this.checkpoints.remove(this.userId);
        await this.releaseLock();
        this.onSettled(job);
      } else {
        await this.save();
        if (action === 'resume') this.launch();
      }
    } catch (error) {
      this.publish({ status: 'recoverable', error: error.message });
      await this.save().catch(() => {});
      await this.releaseLock();
      throw error;
    } finally { this.pendingControl = false; }
  }
  pause = () => this.control('pause');
  resume = async () => {
    if (this.pendingControl) return;
    if (!this.snapshot.job && this.pendingRequest) return this.start(this.pendingRequest.profileId, this.pendingRequest.mode);
    if (!this.snapshot.job) return;
    this.stopLocal();
    const attempt = this.beginInitialization();
    try {
      await attempt.run(async () => {
        this.initializationStage(attempt, 'starting', 'Reprise — verrou et backend…');
        await this.acquireLock(attempt.abort.signal);
        attempt.check();
        const job = await this.api({ action: 'resume' }, attempt.abort.signal);
        attempt.check(); this.publish({ job });
        await this.save(); attempt.check();
        this.launch(attempt);
        await attempt.readyPromise;
      });
    } catch (error) { attempt.fail(error); throw error; }
    finally { if (this.attempt === attempt) this.pendingControl = false; }
  };
  cancel = () => {
    if (!this.snapshot.job) {
      this.stopLocal(); this.pendingControl = false;
      this.publish({ status: 'cancelled', initializationState: 'idle', error: '' });
      return this.releaseLock();
    }
    this.pendingControl = false;
    return this.control('cancel');
  };
  dispose() { this.stopLocal(); this.listeners.clear(); return this.releaseLock(); }
}

export async function browserTransport(body, accessToken, signal) {
  const timeout = AbortSignal.timeout(60000);
  const response = await fetch('/api/scan_browser', { method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
