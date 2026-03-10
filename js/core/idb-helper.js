/**
 * idb-helper.js
 * A simple non-module helper for service workers to read from IndexedDB.
 */
const idbHelper = {
    DB_NAME: 'LedgerDB',
    DB_VERSION: 1,
    STORE_NAME: 'cache',

    async getDb() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
        });
    },

    async get(key) {
        try {
            const db = await this.getDb();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(this.STORE_NAME, 'readonly');
                const store = tx.objectStore(this.STORE_NAME);
                const request = store.get(key);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        } catch (e) {
            console.error("idbHelper.get failed:", e);
            return null;
        }
    }
};
