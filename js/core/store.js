export const idb = {
    DB_NAME: 'LedgerDB',
    DB_VERSION: 1,
    STORE_NAME: 'cache',

    async getDb() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
            request.onupgradeneeded = event => {
                event.target.result.createObjectStore(this.STORE_NAME);
            };
        });
    },
    async get(key) {
        const db = await this.getDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_NAME, 'readonly');
            const store = tx.objectStore(this.STORE_NAME);
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },
    async set(key, value) {
        if (!value) return; // Prevent saving undefined
        const db = await this.getDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_NAME, 'readwrite');
            const store = tx.objectStore(this.STORE_NAME);
            const request = store.put(value, key);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
};
