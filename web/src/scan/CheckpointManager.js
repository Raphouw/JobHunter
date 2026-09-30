export class CheckpointManager {
  constructor(indexedDB = globalThis.indexedDB) { this.indexedDB = indexedDB; }
  async transaction(mode, operation) {
    if (!this.indexedDB) throw new Error('IndexedDB indisponible; reprise locale impossible');
    const database = await new Promise((resolve, reject) => {
      const request = this.indexedDB.open('jobhunter-browser-scans', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('checkpoints', { keyPath: 'userId' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const tx = database.transaction('checkpoints', mode);
        const request = operation(tx.objectStore('checkpoints'));
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = tx.onabort = () => reject(tx.error || new Error('Checkpoint non enregistré'));
      });
    } finally { database.close(); }
  }
  load(userId) { return this.transaction('readonly', store => store.get(userId)); }
  save(snapshot) {
    // Explicit allowlist: never persist access tokens, HTML or Worker buffers.
    const { userId, job, metrics, power, logs } = snapshot;
    return this.transaction('readwrite', store => store.put({
      version: 1, userId, job, metrics, power, logs: (logs || []).slice(-100), timestamp: Date.now(),
    }));
  }
  remove(userId) { return this.transaction('readwrite', store => store.delete(userId)); }
}
