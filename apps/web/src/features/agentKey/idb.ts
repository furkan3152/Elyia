/**
 * A few promise helpers over IndexedDB (the factory is injected so node
 * tests can run against an in-memory shim). Every call is guarded by the
 * caller: a browser that blocks site data simply has no vault.
 */

export function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

export function openDatabase(factory: IDBFactory, name: string, version: number, upgrade: (db: IDBDatabase) => void): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(name, version);
    } catch (error) {
      reject(error instanceof Error ? error : new Error("IndexedDB is unavailable"));
      return;
    }
    request.onupgradeneeded = () => upgrade(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB could not open"));
    request.onblocked = () => reject(new Error("IndexedDB is blocked by another tab"));
  });
}

/** Runs `work` in one transaction and resolves with its result once the transaction completes. */
export function inTransaction<T>(db: IDBDatabase, stores: string | string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(stores, mode);
    } catch (error) {
      reject(error instanceof Error ? error : new Error("IndexedDB transaction failed"));
      return;
    }
    let result: T;
    let settled = false;
    tx.oncomplete = () => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    tx.onerror = () => {
      if (!settled) {
        settled = true;
        reject(tx.error ?? new Error("IndexedDB transaction failed"));
      }
    };
    tx.onabort = () => {
      if (!settled) {
        settled = true;
        reject(tx.error ?? new Error("IndexedDB transaction aborted"));
      }
    };
    work(tx).then(
      (value) => {
        result = value;
      },
      (error: unknown) => {
        if (!settled) {
          settled = true;
          try {
            tx.abort();
          } catch {
            // Already finished.
          }
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      },
    );
  });
}
