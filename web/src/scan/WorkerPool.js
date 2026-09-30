export function powerBudget(mode = 'normal', hardware = 2, memory = 4) {
  const cores = Math.max(1, Number(hardware) || 2);
  const available = Math.max(1, cores - Math.max(1, Math.ceil(cores * .25)));
  const fractions = { eco: .15, normal: .35, fast: .55, maximum: .75 };
  const ceiling = Math.min(4, Math.max(1, Math.floor((Number(memory) || 4) / 2)));
  return Math.min(ceiling, available, Math.max(1, Math.floor(cores * (fractions[mode] || .35))));
}

// Lazily created: a sequential mutable scanner has one task in flight and
// consequently one runtime. Capacity must never imply N unnecessary WASM VMs.
export class WorkerPool {
  constructor({ capacity = 1, factory, onEvent = () => {} } = {}) {
    this.capacity = capacity;
    this.factory = factory || (() => new Worker(new URL('./scan.worker.js', import.meta.url), { type: 'module' }));
    this.onEvent = onEvent;
    this.worker = null;
    this.pending = null;
    this.sequence = 0;
  }
  execute(type, payload = {}, timeout = type === 'init' ? 30000 : 240000) {
    if (this.pending) return Promise.reject(new Error('File Worker occupée'));
    if (!this.worker) {
      console.info('[ScanWorker] creating worker');
      try { this.worker = this.factory(); }
      catch (error) { console.error('[ScanWorker] creation failed', error); return Promise.reject(error); }
      console.info('[ScanWorker] worker created');
      this.worker.onmessage = ({ data }) => {
        if (!data || typeof data !== 'object') {
          this.fail(new Error('Message Worker invalide')); return;
        }
        if (data.type === 'initialization') console.info(`[ScanWorker] ${data.stage}`);
        if (data.type) { this.onEvent(data); return; }
        if (data.id !== this.pending?.id) return;
        const task = this.pending;
        clearTimeout(task.timer);
        this.pending = null;
        if (data.error || (task.type === 'init' && data.result?.ready !== true)) {
          const error = new Error(data.error || 'Le Worker n’a pas confirmé READY');
          console.error('[ScanWorker] task failed', error);
          this.terminate(error);
          task.reject(error);
        } else task.resolve(data.result);
      };
      this.worker.onerror = event => this.fail(new Error(event.message || 'Impossible de charger le script Worker'));
      this.worker.onmessageerror = () => this.fail(new Error('Impossible de décoder un message du Worker'));
    }
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => this.fail(new Error(type === 'init'
        ? 'Initialisation du moteur navigateur interrompue : READY non reçu après 30 secondes. Vous pouvez réessayer.'
        : 'Délai Worker dépassé')), timeout);
      this.pending = { id, type, resolve, reject, timer };
      try { this.worker.postMessage({ id, type, ...payload }); }
      catch (error) { this.fail(error); }
    });
  }
  fail(error) { console.error('[ScanWorker] failed', error); this.terminate(error); }
  session(accessToken) { this.worker?.postMessage({ type: 'session', accessToken }); }
  terminate(error = new DOMException('Tâche interrompue', 'AbortError')) {
    const task = this.pending;
    this.pending = null;
    if (task) { clearTimeout(task.timer); task.reject(error); }
    if (this.worker) {
      this.worker.onmessage = this.worker.onerror = this.worker.onmessageerror = null;
      this.worker.terminate();
    }
    this.worker = null;
  }
  get active() { return this.pending ? 1 : 0; }
}
