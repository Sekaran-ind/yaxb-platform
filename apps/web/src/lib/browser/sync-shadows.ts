// The sync engine's shadows, cursors and conflicts (SYN-5), in IndexedDB "yaxb-sync" (memory when
// IndexedDB isn't there). Kept apart from the app's own stores: the engine's bookkeeping, never data
// the app reads.
import { createMemoryShadows, type Shadow, type ShadowStore, type SyncCollection, type SyncConflict } from "@sekaran-ind/yaxb-core/sync";

const DB = "yaxb-sync";
let opening: Promise<IDBDatabase | null> | null = null;
function open(): Promise<IDBDatabase | null> {
  return (opening ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("shadows");
        req.result.createObjectStore("cursors");
        req.result.createObjectStore("conflicts", { keyPath: "key" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  }));
}

function run<T>(d: IDBDatabase, store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve((req ? req.result : undefined) as T);
    tx.onerror = () => reject(tx.error);
  });
}

const key = (c: string, id: string) => `${c}/${id}`;

export async function browserShadows(): Promise<ShadowStore> {
  const d = typeof indexedDB === "undefined" ? null : await open();
  if (!d) return createMemoryShadows();
  return {
    get: async (c, id) => (await run<Shadow | undefined>(d, "shadows", "readonly", (s) => s.get(key(c, id)))) ?? null,
    put: (c, id, shadow) => run(d, "shadows", "readwrite", (s) => void s.put(shadow, key(c, id))),
    async dirty(c: SyncCollection) {
      const range = IDBKeyRange.bound(`${c}/`, `${c}/￿`);
      const [keys, values] = await Promise.all([
        run<IDBValidKey[]>(d, "shadows", "readonly", (s) => s.getAllKeys(range)),
        run<Shadow[]>(d, "shadows", "readonly", (s) => s.getAll(range)),
      ]);
      return keys.flatMap((k, i) => (values[i]?.dirty ? [{ id: String(k).slice(c.length + 1), shadow: values[i]! }] : []));
    },
    cursor: async (c) => (await run<string | undefined>(d, "cursors", "readonly", (s) => s.get(c))) ?? "",
    setCursor: (c, cursor) => run(d, "cursors", "readwrite", (s) => void s.put(cursor, c)),
    conflicts: async () => (await run<SyncConflict[]>(d, "conflicts", "readonly", (s) => s.getAll())) ?? [],
    addConflict: (x) => run(d, "conflicts", "readwrite", (s) => void s.put(x)),
    removeConflict: (k) => run(d, "conflicts", "readwrite", (s) => void s.delete(k)),
  };
}

/** Forget every shadow, cursor and conflict (a different box, or sync turned off and on again). */
export async function clearShadows() {
  const d = typeof indexedDB === "undefined" ? null : await open();
  if (!d) return;
  for (const s of ["shadows", "cursors", "conflicts"]) await run(d, s, "readwrite", (st) => void st.clear());
}
