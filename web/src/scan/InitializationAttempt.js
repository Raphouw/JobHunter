export const BROWSER_SCAN_BUILD = 'click-watchdog-v3';
export const traceInitialization = (id, message) => console.log(`[BrowserScan:${id}] ${message}`);

// Created synchronously at the user action, before locks/session/storage/backend.
// Its deadline never depends on a React render or a change of phase.
export class InitializationAttempt {
  constructor(id, timeout, onFailure, stage) {
    this.id = id; this.timeout = timeout; this.onFailure = onFailure; this.stage = stage;
    this.abort = new AbortController(); this.deadline = Date.now() + timeout;
    this.readyPromise = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    this.failure = new Promise((_, reject) => { this.rejectFailure = reject; });
    this.readyPromise.catch(() => {}); this.failure.catch(() => {});
    const expire = () => {
      if (this.ready || this.failed) return;
      const error = new Error(`Démarrage interrompu après ${Math.round(timeout / 1000)} secondes — ${stage()}. Vous pouvez réessayer.`);
      error.name = 'InitializationTimeoutError';
      this.fail(error);
    };
    this.expire = expire;
    this.timer = setTimeout(expire, timeout);
    this.watchdog = setInterval(() => { if (Date.now() >= this.deadline) expire(); }, 250);
    traceInitialization(id, 'initialization timeout armed');
  }
  check() {
    // Also enforce wall time if timers were delayed by background throttling.
    if (!this.ready && Date.now() >= this.deadline) this.expire();
    this.abort.signal.throwIfAborted();
  }
  run(operation) { return Promise.race([Promise.resolve().then(operation), this.failure]); }
  clear() { clearTimeout(this.timer); clearInterval(this.watchdog); }
  markReady() { this.check(); this.ready = true; this.clear(); this.resolveReady(); }
  fail(error) {
    if (this.failed) return;
    this.failed = true; this.clear(); this.abort.abort(error);
    this.onFailure(error);
    this.rejectReady(error); this.rejectFailure(error);
  }
  cancel() {
    this.failed = true; this.clear();
    const error = new DOMException('Initialisation interrompue', 'AbortError');
    this.abort.abort(error); this.rejectReady(error); this.rejectFailure(error);
  }
}
