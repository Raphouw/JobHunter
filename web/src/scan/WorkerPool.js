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
  execute(type, payload = {}, timeout = 240000) {
    if (this.pending) return Promise.reject(new Error('File Worker occupée'));
    if (!this.worker) {
      this.worker = this.factory();
      this.worker.onmessage = ({ data }) => {
        if (data.type) { this.onEvent(data); return; }
        if (data.id !== this.pending?.id) return;
        const task = this.pending;
        clearTimeout(task.timer);
        this.pending = null;
        data.error ? task.reject(new Error(data.error)) : task.resolve(data.result);
      };
      this.worker.onerror = event => this.terminate(new Error(event.message || 'Worker interrompu'));
    }
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => this.terminate(new Error('Délai Worker dépassé')), timeout);
      this.pending = { id, resolve, reject, timer };
      this.worker.postMessage({ id, type, ...payload });
    });
  }
  session(accessToken) { this.worker?.postMessage({ type: 'session', accessToken }); }
  terminate(error = new DOMException('Tâche interrompue', 'AbortError')) {
    const task = this.pending;
    this.pending = null;
    if (task) { clearTimeout(task.timer); task.reject(error); }
    this.worker?.terminate();
    this.worker = null;
  }
  get active() { return this.pending ? 1 : 0; }
}
