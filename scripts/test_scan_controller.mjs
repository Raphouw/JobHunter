import assert from 'node:assert/strict';
import { ScanController } from '../web/src/scan/ScanController.js';
import { WorkerPool, powerBudget } from '../web/src/scan/WorkerPool.js';

globalThis.location = { origin: 'https://fixture.example' };
const getSession = async () => ({ access_token: 'fixture-token' });
class MemoryCheckpoints {
  async load() { return this.data; }
  async save(data) { this.data = structuredClone(data); this.saves = (this.saves || 0) + 1; }
  async remove() { this.data = null; }
}
const fixture = () => ({ id: 'job', profile_id: 'profile', status: 'queued', phase: 'analyze',
  created_at: new Date().toISOString(), checkpoint: { executor: 'browser', analyzed: 0 }, next_run_at: new Date().toISOString() });
function setup({ steps = 1, fail = false, held = false } = {}) {
  let job = fixture();
  let pool;
  const checkpoints = new MemoryCheckpoints();
  const controller = new ScanController({ userId: 'user', getSession, checkpoints,
    transport: async body => {
      if (body.action === 'start') job = fixture();
      if (body.action === 'pause') job = { ...job, checkpoint: { ...job.checkpoint, paused: true } };
      if (body.action === 'resume') job = { ...job, checkpoint: { ...job.checkpoint, paused: false } };
      if (body.action === 'cancel') job = { ...job, status: 'cancelled' };
      return { data: structuredClone(job) };
    },
    poolFactory: ({ onEvent }) => pool = {
      async execute(type) {
        if (type === 'init') return { ready: true };
        if (held) return await new Promise((resolve, reject) => { this.reject = reject; });
        if (fail) throw new Error('Backend indisponible');
        const analyzed = job.checkpoint.analyzed + 1;
        onEvent({ type: 'event', message: `Page ${analyzed}`, style: '' });
        job = { ...job, checkpoint: { ...job.checkpoint, analyzed }, status: analyzed >= steps ? 'completed' : 'queued' };
        return { claimed: true, job: structuredClone(job) };
      },
      session() {},
      terminate() { this.stopped = true; this.reject?.(new DOMException('Stopped', 'AbortError')); },
    },
  });
  controller.setPower('maximum');
  return { controller, checkpoints, pool: () => pool };
}

for (const cores of [1, 2, 4, 8, 32, 128]) {
  for (const power of ['eco', 'normal', 'fast', 'maximum']) {
    const budget = powerBudget(power, cores, 8);
    assert(budget >= 1 && budget <= 4);
    if (cores > 1) assert(budget < cores);
  }
}

{
  const { controller, checkpoints } = setup({ steps: 5000 });
  await controller.start('profile', 'Exhaustif 1h');
  const second = controller.start('profile', 'Rapide');
  await assert.rejects(second, /déjà actif/);
  await controller.running;
  assert.equal(controller.snapshot.status, 'completed');
  assert.equal(controller.snapshot.job.checkpoint.analyzed, 5000);
  assert.equal(controller.snapshot.logs.length, 100);
  assert.equal(checkpoints.data, null);
  assert(checkpoints.saves >= 5000);
  controller.dispose();
}
{
  const { controller, checkpoints, pool } = setup({ held: true });
  await controller.start('profile', 'Complet');
  await new Promise(resolve => setTimeout(resolve, 10));
  await controller.pause();
  assert.equal(controller.snapshot.status, 'paused');
  assert(pool().stopped);
  assert(checkpoints.data.job.checkpoint.paused);
  assert(!JSON.stringify(checkpoints.data).includes('fixture-token'));
  await controller.cancel();
  assert.equal(controller.snapshot.status, 'cancelled');
  assert.equal(checkpoints.data, null);
  controller.dispose();
}
{
  const { controller, checkpoints } = setup({ fail: true });
  await controller.start('profile', 'Rapide');
  await controller.running;
  assert.equal(controller.snapshot.status, 'recoverable');
  assert.equal(controller.snapshot.error, 'Backend indisponible');
  assert(checkpoints.data);
  controller.dispose();
}
{
  const { controller, checkpoints } = setup();
  checkpoints.data = { version: 1, userId: 'user', job: fixture(), metrics: {}, logs: [], power: 'eco' };
  await controller.recover();
  assert.equal(controller.snapshot.status, 'recoverable');
  assert.equal(controller.snapshot.power, 'eco');
  await controller.resume();
  await controller.running;
  assert.equal(controller.snapshot.status, 'completed');
  controller.dispose();
}
{
  const { controller, checkpoints } = setup();
  checkpoints.save = async () => { throw new Error('Stockage plein'); };
  await assert.rejects(controller.start('profile', 'Rapide'), /Stockage plein/);
  assert.equal(controller.snapshot.status, 'recoverable');
  assert.equal(controller.snapshot.job.id, 'job');
  assert.equal(controller.snapshot.error, 'Stockage plein');
  controller.dispose();
}
{
  let stopped = false;
  const pool = new WorkerPool({ factory: () => ({ postMessage() {}, terminate() { stopped = true; } }) });
  const task = pool.execute('init', {}, 1000);
  pool.terminate();
  await assert.rejects(task, { name: 'AbortError' });
  assert.equal(stopped, true);
  assert.equal(pool.active, 0);
  assert.equal(pool.worker, null);
}
console.log('PASS: 5000 tasks, bounded logs, single scan, pause, cancel, recovery, backend failure and Worker cleanup.');

for (const boundary of ['session', 'state', 'worker']) {
  let stopped = false;
  const controller = new ScanController({ userId: 'user', initializationTimeout: 25,
    getSession: () => boundary === 'session' ? new Promise(() => {}) : getSession(),
    transport: () => boundary === 'state' ? new Promise(() => {}) : Promise.resolve({ data: fixture() }),
    checkpoints: new MemoryCheckpoints(),
    poolFactory: () => ({ execute: () => new Promise(() => {}), terminate() { stopped = true; } }),
  });
  controller.publish({ job: fixture(), status: 'starting' });
  controller.launch();
  await controller.running;
  assert.equal(controller.snapshot.status, 'recoverable');
  assert.match(controller.snapshot.error, /Démarrage interrompu/);
  assert(stopped);
  controller.dispose();
}
for (const failure of ['error', 'messageerror', 'send', 'reply']) {
  let stopped = false;
  const worker = { postMessage() { if (failure === 'send') throw new Error('Clone impossible'); }, terminate() { stopped = true; } };
  const pool = new WorkerPool({ factory: () => worker });
  const task = pool.execute('init', {}, 100);
  if (failure === 'error') worker.onerror({ message: 'Worker HTTP 404' });
  if (failure === 'messageerror') worker.onmessageerror({});
  if (failure === 'reply') worker.onmessage({ data: { id: 1, error: 'Pyodide indisponible' } });
  await assert.rejects(task);
  assert(stopped);
  assert.equal(pool.active, 0);
  assert.equal(pool.worker, null);
}
{
  let stopped = false;
  const pool = new WorkerPool({ factory: () => ({ postMessage() {}, terminate() { stopped = true; } }) });
  await assert.rejects(pool.execute('init', {}, 25), /READY non reçu/);
  assert(stopped);
}
console.log('PASS: initialization deadline covers session, backend and Worker; error/messageerror/send/reply/timeout terminate and reject.');

for (const boundary of ['lock', 'checkpoint', 'session', 'start', 'save']) {
  let pools = 0;
  const checkpoints = new MemoryCheckpoints();
  if (boundary === 'checkpoint') checkpoints.load = () => new Promise(() => {});
  if (boundary === 'save') checkpoints.save = () => new Promise(() => {});
  const controller = new ScanController({ userId: 'user', initializationTimeout: 25, checkpoints,
    getSession: () => boundary === 'session' ? new Promise(() => {}) : getSession(),
    transport: body => boundary === 'start' && body.action === 'start' ? new Promise(() => {}) : Promise.resolve({ data: fixture() }),
    poolFactory: () => { pools++; throw new Error('Must not create pool before preparation finishes'); },
  });
  if (boundary === 'lock') controller.acquireLock = () => new Promise(() => {});
  await assert.rejects(controller.start('profile', 'Rapide'), { name: 'InitializationTimeoutError' });
  assert.equal(controller.snapshot.initializationState, 'timeout');
  assert.equal(controller.snapshot.status, 'recoverable');
  assert.equal(controller.pendingControl, false);
  assert.equal(pools, 0);
  assert(controller.attempt.abort.signal.aborted);
  controller.dispose();
}
console.log('PASS: fresh start deadline covers lock, checkpoint read, session, start API and checkpoint save BEFORE WorkerPool.');

// A lease owned elsewhere must refresh the UI, not sleep for 4m40s.
{
  const { controller } = setup();
  const waits = [];
  let steps = 0;
  controller.poolFactory = () => ({
    async execute(type) {
      if (type === 'init') return { ready: true };
      ++steps;
      return { claimed: steps > 1, job: { ...fixture(), status: steps > 1 ? 'completed' : 'running',
        progress_percent: steps > 1 ? 100 : 51, lease_until: new Date(Date.now() + 280000).toISOString() } };
    }, session() {}, terminate() {},
  });
  controller.delay = async ms => {
    waits.push(ms);
    assert.match(controller.snapshot.phaseLabel, /attente de réservation/);
    assert.equal(controller.snapshot.job.progress_percent, 51);
  };
  await controller.start('profile', 'Rapide');
  await controller.running;
  assert.deepEqual(waits, [5000]);
  assert.equal(controller.snapshot.status, 'completed');
  controller.dispose();
}
console.log('PASS: unavailable lease refreshes within 5 seconds and reports actual backend progress.');
