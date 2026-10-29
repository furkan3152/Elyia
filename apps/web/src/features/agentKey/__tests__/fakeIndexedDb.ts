/**
 * A small in-memory IndexedDB for node tests: open with upgrade, object
 * stores with out-of-line keys, get / put / delete / getAll, and
 * transactions that complete once no request is pending (like the real
 * thing, requests made in a request's success microtasks keep the
 * transaction alive). Values are stored with structuredClone, so CryptoKey
 * objects survive exactly as they would in a browser.
 */

type Handler = ((this: unknown, event: unknown) => void) | null;

class FakeRequest<T = unknown> {
  result: T | undefined = undefined;
  error: Error | null = null;
  onsuccess: Handler = null;
  onerror: Handler = null;
  readyState: "pending" | "done" = "pending";
  succeed(value: T) {
    this.result = value;
    this.readyState = "done";
    this.onsuccess?.call(this, { target: this });
  }
  fail(error: Error) {
    this.error = error;
    this.readyState = "done";
    this.onerror?.call(this, { target: this });
  }
}

class FakeOpenRequest extends FakeRequest<FakeDatabase> {
  onupgradeneeded: Handler = null;
  onblocked: Handler = null;
}

class FakeStoreNames {
  constructor(private readonly names: () => string[]) {}
  contains(name: string): boolean {
    return this.names().includes(name);
  }
  get length(): number {
    return this.names().length;
  }
}

class FakeObjectStore {
  constructor(
    private readonly data: Map<string, unknown>,
    private readonly tx: FakeTransaction,
  ) {}
  private request<T>(work: () => T): FakeRequest<T> {
    const request = new FakeRequest<T>();
    this.tx.track(request, work);
    return request;
  }
  get(key: string) {
    return this.request(() => (this.data.has(key) ? structuredClone(this.data.get(key)) : undefined));
  }
  getAll() {
    return this.request(() => [...this.data.values()].map((value) => structuredClone(value)));
  }
  put(value: unknown, key: string) {
    this.tx.assertWritable();
    return this.request(() => {
      this.data.set(key, structuredClone(value));
      return key;
    });
  }
  delete(key: string) {
    this.tx.assertWritable();
    return this.request(() => {
      this.data.delete(key);
      return undefined;
    });
  }
}

class FakeTransaction {
  oncomplete: Handler = null;
  onerror: Handler = null;
  onabort: Handler = null;
  error: Error | null = null;
  private pending = 0;
  private finished = false;
  private aborted = false;

  constructor(
    private readonly db: FakeDatabase,
    private readonly stores: string[],
    readonly mode: "readonly" | "readwrite",
  ) {
    // A transaction with no requests at all completes on its own.
    setTimeout(() => this.maybeComplete(), 0);
  }

  objectStore(name: string): FakeObjectStore {
    if (!this.stores.includes(name)) throw new Error(`Store ${name} is not in this transaction`);
    const data = this.db.store(name);
    return new FakeObjectStore(data, this);
  }

  assertWritable() {
    if (this.mode !== "readwrite") throw new Error("ReadOnlyError");
    if (this.finished) throw new Error("TransactionInactiveError");
  }

  track<T>(request: FakeRequest<T>, work: () => T) {
    if (this.finished) throw new Error("TransactionInactiveError");
    this.pending += 1;
    setTimeout(() => {
      this.pending -= 1;
      if (this.aborted) return;
      try {
        request.succeed(work());
      } catch (error) {
        request.fail(error instanceof Error ? error : new Error(String(error)));
      }
      setTimeout(() => this.maybeComplete(), 0);
    }, 0);
  }

  abort() {
    if (this.finished) return;
    this.aborted = true;
    this.finished = true;
    this.onabort?.call(this, {});
  }

  private maybeComplete() {
    if (this.finished || this.pending > 0) return;
    this.finished = true;
    this.oncomplete?.call(this, {});
  }
}

class FakeDatabase {
  private readonly stores = new Map<string, Map<string, unknown>>();
  readonly objectStoreNames = new FakeStoreNames(() => [...this.stores.keys()]);
  constructor(
    readonly name: string,
    public version: number,
  ) {}
  createObjectStore(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new Map());
  }
  store(name: string): Map<string, unknown> {
    const store = this.stores.get(name);
    if (!store) throw new Error(`NotFoundError: ${name}`);
    return store;
  }
  transaction(stores: string | string[], mode: "readonly" | "readwrite" = "readonly") {
    const list = Array.isArray(stores) ? stores : [stores];
    for (const name of list) this.store(name);
    return new FakeTransaction(this, list, mode);
  }
  close() {}
  /** Test helper: raw stored values. */
  dump(name: string): unknown[] {
    return [...this.store(name).values()];
  }
}

export class FakeIndexedDb {
  readonly databases = new Map<string, FakeDatabase>();

  open(name: string, version = 1): FakeOpenRequest {
    const request = new FakeOpenRequest();
    setTimeout(() => {
      let db = this.databases.get(name);
      const upgrading = !db || db.version < version;
      if (!db) {
        db = new FakeDatabase(name, version);
        this.databases.set(name, db);
      }
      request.result = db;
      if (upgrading) {
        db.version = version;
        request.onupgradeneeded?.call(request, { target: request });
      }
      request.succeed(db);
    }, 0);
    return request;
  }

  /** As an IDBFactory for the code under test. */
  asFactory(): IDBFactory {
    return this as unknown as IDBFactory;
  }
}
