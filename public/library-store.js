// This library is device-local. It is never presented as shared GitHub storage.
window.voiceLibraryStore = (() => {
  function database() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('voice-local-library', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('takes', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function operation(mode, callback) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('takes', mode);
      const request = callback(tx.objectStore('takes'));
      tx.oncomplete = () => { db.close(); resolve(request.result); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error || Error('Browser storage is unavailable.')); };
    });
  }
  return {
    save: take => operation('readwrite', store => store.put(take)),
    all: () => operation('readonly', store => store.getAll()),
    remove: id => operation('readwrite', store => store.delete(id)),
  };
})();
