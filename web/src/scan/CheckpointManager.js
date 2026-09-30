export class CheckpointManager {
  constructor(indexedDB = globalThis.indexedDB) { this.indexedDB = indexedDB; }
  async transaction(mode, operation) {
    if (!this.indexedDB) throw new Error('IndexedDB indisponible; reprise locale impossible');
    const database = await new Promise((resolve, reject) => {
      const request = this.indexedDB.open('jobhunter-browser-scans', 1);
      let expired = false;
      const timer = setTimeout(() => { expired = true; reject(new Error('Ouverture du checkpoint bloquée après 5 secondes. Fermez les autres onglets et réessayez.')); }, 5000);
      request.onupgradeneeded = () => request.result.createObjectStore('checkpoints', { keyPath: 'userId' });
      request.onsuccess = () => { clearTimeout(timer); if (expired) request.result.close(); else resolve(request.result); };
      request.onerror = () => { clearTimeout(timer); reject(request.error); };
      request.onblocked = () => { clearTimeout(timer); expired = true; reject(new Error('Checkpoint bloqué par un autre onglet. Fermez-le et réessayez.')); };
    });
    try {
      return await new Promise((resolve, reject) => {
        const tx = database.transaction('checkpoints', mode);
        const timer = setTimeout(() => { tx.abort(); reject(new Error('Enregistrement du checkpoint interrompu après 10 secondes.')); }, 10000);
        const request = operation(tx.objectStore('checkpoints'));
        tx.oncomplete = () => { clearTimeout(timer); resolve(request.result); };
        tx.onerror = tx.onabort = () => { clearTimeout(timer); reject(tx.error || new Error('Checkpoint non enregistré')); };
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
