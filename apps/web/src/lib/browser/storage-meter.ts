// How much this device keeps, and asking the browser to keep it (STO-1, STO-2). Sizes are measured
// on this device and never sent anywhere. Each category is one place the kiosk stores things: an
// IndexedDB database, Cache Storage (the on-device models), or this site's local storage.

export type StorageCategory = { id: string; label: string; detail: string; bytes: number };
export type StorageReport = {
  /** What the browser says this site uses, and may use (null where it won't say). */
  used: number | null;
  quota: number | null;
  /** Whether the browser has promised not to clear this site's data under pressure. */
  persisted: boolean | null;
  categories: StorageCategory[];
};

/** The kiosk's IndexedDB databases, as people know them. */
const DATABASES: Record<string, { label: string; detail: string }> = {
  "yaxb-kiosk": { label: "Notebooks and conversations", detail: "Sources, memory and conversations kept in this browser" },
  "yaxb-cases": { label: "Requests", detail: "Requests worked on at this device, and their deliveries" },
  "yaxb-sync": { label: "Sync data", detail: "What was last synced with the box, to send only changes" },
  "yaxb-team": { label: "Team chat", detail: "Messages with team members, kept on this device only" },
  "yaxb-accounts": { label: "Profiles", detail: "Profiles on this device, sealed with their passphrases" },
  "yaxb-schedule": { label: "Scheduler", detail: "To-dos, birthdays and events" },
};

const encoder = new TextEncoder();
/** About how many bytes a stored value takes: its JSON, plus the size of any files in it. */
function sizeOf(value: unknown): number {
  let files = 0;
  const json = JSON.stringify(value, (_k, v: unknown) => {
    if (v instanceof Blob) {
      files += v.size;
      return null;
    }
    if (v instanceof ArrayBuffer) {
      files += v.byteLength;
      return null;
    }
    if (ArrayBuffer.isView(v)) {
      files += v.byteLength;
      return null;
    }
    return v;
  });
  return (json ? encoder.encode(json).length : 0) + files;
}

/** The size of one existing database: every record of every store, read with a cursor. */
function databaseSize(name: string): Promise<number> {
  return new Promise((resolve) => {
    const req = indexedDB.open(name);
    // Opening a database that isn't there would create it: callers only ask for listed ones.
    req.onupgradeneeded = () => req.transaction?.abort();
    req.onerror = () => resolve(0);
    req.onsuccess = () => {
      const db = req.result;
      const stores = [...db.objectStoreNames];
      if (!stores.length) {
        db.close();
        return resolve(0);
      }
      let total = 0;
      const tx = db.transaction(stores, "readonly");
      for (const s of stores) {
        const cursor = tx.objectStore(s).openCursor();
        cursor.onsuccess = () => {
          const c = cursor.result;
          if (!c) return;
          total += sizeOf(c.value);
          c.continue();
        };
      }
      tx.oncomplete = () => {
        db.close();
        resolve(total);
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        resolve(total);
      };
    };
  });
}

/** The on-device models (Transformers.js keeps them in Cache Storage). */
async function cacheSize(): Promise<number> {
  if (typeof caches === "undefined") return 0;
  let total = 0;
  for (const name of await caches.keys()) {
    const cache = await caches.open(name);
    for (const req of await cache.keys()) {
      const res = await cache.match(req);
      if (!res) continue;
      const length = Number(res.headers.get("content-length"));
      total += Number.isFinite(length) && length > 0 ? length : (await res.blob()).size;
    }
  }
  return total;
}

/** This site's local storage: settings, the catalogue choice, queued feedback. */
function localSize(): number {
  try {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      total += (k.length + (localStorage.getItem(k)?.length ?? 0)) * 2;
    }
    return total;
  } catch {
    return 0;
  }
}

/** Measure what this device keeps for the kiosk, largest first (STO-1). */
export async function measureStorage(): Promise<StorageReport> {
  const estimate = await navigator.storage?.estimate?.().catch(() => null);
  const persisted = (await navigator.storage?.persisted?.().catch(() => null)) ?? null;
  const existing = new Set((await indexedDB.databases?.().catch(() => []))?.map((d) => d.name ?? "") ?? []);
  const known = Object.keys(DATABASES).filter((n) => existing.has(n));
  const [models, ...dbs] = await Promise.all([cacheSize().catch(() => 0), ...known.map((n) => databaseSize(n))]);
  const categories: StorageCategory[] = [
    { id: "models", label: "On-device models", detail: "Speech, search and translation models, so they work offline", bytes: models },
    ...known.map((n, i) => ({ id: n, ...DATABASES[n]!, bytes: dbs[i]! })),
    { id: "settings", label: "Settings and queues", detail: "Preferences, and feedback waiting to be sent", bytes: localSize() },
  ].filter((c) => c.bytes > 0);
  categories.sort((a, b) => b.bytes - a.bytes);
  return { used: estimate?.usage ?? null, quota: estimate?.quota ?? null, persisted, categories };
}

/** Ask the browser to keep this site's data under storage pressure (STO-2). True when it agreed. */
export async function askPersistence(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

/** In words: 0 B, 12 KB, 3.4 MB, 1.2 GB. */
export function bytesText(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[u]}`;
}
