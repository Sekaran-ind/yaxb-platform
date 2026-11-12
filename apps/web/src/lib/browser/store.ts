// Where the kiosk keeps notebooks and conversations in the browser, chosen in Settings → Storage:
//   indexeddb  IndexedDB: survives a reload and a restart (the default)
//   session    memory only: gone when the page closes (a shared, public kiosk)
//   box        a yaxb-box on the local network (Raspberry Pi: SQLite + Litestream)
//   server     conversations on the server (D1); notebooks still in IndexedDB
// Nothing here is sent anywhere except with a chat turn, as that turn's context.
import type { Notebook, NotebookSource } from "@sekaran-ind/yaxb-core/notebook";
import { createBoxClient, type BoxClient } from "@sekaran-ind/yaxb-core/stores/box";
import type { ThreadState } from "@sekaran-ind/yaxb-core/stores";
import type { StorageId } from "@sekaran-ind/yaxb-core/settings";
import type { ChatTurn } from "@/lib/types";

export type NotebookRecord = Notebook & { createdAt: string; updatedAt: string };
export type ThreadRecord = {
  id: string;
  notebookId: string;
  title: string;
  updatedAt: string;
  /** What the Transcript shows. */
  turns: ChatTurn[];
  /** What the agent continues from (browser storage); null when the server keeps it. */
  state: ThreadState | null;
};

export interface KioskStore {
  readonly kind: StorageId;
  listNotebooks(): Promise<NotebookRecord[]>;
  getNotebook(id: string): Promise<NotebookRecord | null>;
  putNotebook(n: NotebookRecord): Promise<void>;
  deleteNotebook(id: string): Promise<void>;
  listThreads(notebookId: string): Promise<ThreadRecord[]>;
  getThread(id: string): Promise<ThreadRecord | null>;
  putThread(t: ThreadRecord): Promise<void>;
  deleteThread(id: string): Promise<void>;
  /** Remove everything this store holds. */
  clear(): Promise<void>;
}

const DB_NAME = "yaxb-kiosk";
const DB_VERSION = 1;

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;
function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("notebooks")) db.createObjectStore("notebooks", { keyPath: "id" });
      if (!db.objectStoreNames.contains("threads")) db.createObjectStore("threads", { keyPath: "id" }).createIndex("byNotebook", "notebookId");
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => {
      dbPromise = null;
      reject(open.error);
    };
  });
  return dbPromise;
}

async function tx<T>(store: "notebooks" | "threads", mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return request(fn(db.transaction(store, mode).objectStore(store)));
}

const byUpdated = <T extends { updatedAt: string }>(list: T[]) => [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

function indexedDbStore(kind: StorageId): KioskStore {
  return {
    kind,
    listNotebooks: async () => byUpdated(await tx<NotebookRecord[]>("notebooks", "readonly", (s) => s.getAll())),
    getNotebook: async (id) => (await tx<NotebookRecord | undefined>("notebooks", "readonly", (s) => s.get(id))) ?? null,
    putNotebook: async (n) => void (await tx("notebooks", "readwrite", (s) => s.put(n))),
    async deleteNotebook(id) {
      for (const t of await this.listThreads(id)) await this.deleteThread(t.id);
      await tx("notebooks", "readwrite", (s) => s.delete(id));
    },
    listThreads: async (notebookId) =>
      byUpdated(await tx<ThreadRecord[]>("threads", "readonly", (s) => s.index("byNotebook").getAll(IDBKeyRange.only(notebookId)))),
    getThread: async (id) => (await tx<ThreadRecord | undefined>("threads", "readonly", (s) => s.get(id))) ?? null,
    putThread: async (t) => void (await tx("threads", "readwrite", (s) => s.put(t))),
    deleteThread: async (id) => void (await tx("threads", "readwrite", (s) => s.delete(id))),
    async clear() {
      await tx("threads", "readwrite", (s) => s.clear());
      await tx("notebooks", "readwrite", (s) => s.clear());
    },
  };
}

// Session storage lives as long as the page: module-level maps, so switching screens keeps it.
const sessionNotebooks = new Map<string, NotebookRecord>();
const sessionThreads = new Map<string, ThreadRecord>();

function memoryStore(): KioskStore {
  const clone = <T,>(v: T): T => structuredClone(v);
  return {
    kind: "session",
    listNotebooks: async () => byUpdated([...sessionNotebooks.values()].map(clone)),
    getNotebook: async (id) => (sessionNotebooks.has(id) ? clone(sessionNotebooks.get(id)!) : null),
    putNotebook: async (n) => void sessionNotebooks.set(n.id, clone(n)),
    deleteNotebook: async (id) => {
      sessionNotebooks.delete(id);
      for (const [k, t] of sessionThreads) if (t.notebookId === id) sessionThreads.delete(k);
    },
    listThreads: async (notebookId) => byUpdated([...sessionThreads.values()].filter((t) => t.notebookId === notebookId).map(clone)),
    getThread: async (id) => (sessionThreads.has(id) ? clone(sessionThreads.get(id)!) : null),
    putThread: async (t) => void sessionThreads.set(t.id, clone(t)),
    deleteThread: async (id) => void sessionThreads.delete(id),
    clear: async () => {
      sessionNotebooks.clear();
      sessionThreads.clear();
    },
  };
}

function boxStore(client: BoxClient): KioskStore {
  return {
    kind: "box",
    listNotebooks: async () => byUpdated((await client.list<NotebookRecord>("notebooks")).map((r) => r.data)),
    getNotebook: (id) => client.get<NotebookRecord>("notebooks", id),
    putNotebook: (n) => client.put("notebooks", n.id, n),
    deleteNotebook: (id) => client.delete("notebooks", id),
    listThreads: async (notebookId) => byUpdated((await client.threadsOf<ThreadRecord>(notebookId)).map((r) => r.data)),
    getThread: (id) => client.get<ThreadRecord>("threads", id),
    putThread: (t) => client.put("threads", t.id, t),
    deleteThread: (id) => client.delete("threads", id),
    async clear() {
      for (const n of await this.listNotebooks()) await this.deleteNotebook(n.id);
    },
  };
}

export type BoxConnection = { url: string; token: string };

/**
 * The store for a storage setting. Box needs a connection (Settings -> Storage). Falls back to
 * session memory when IndexedDB isn't available (some private windows).
 */
export function storeFor(kind: StorageId, box?: BoxConnection | null): KioskStore {
  if (kind === "box") {
    if (!box?.url || !box.token) throw new Error("Connect a yaxb-box in Settings → Storage first.");
    return boxStore(createBoxClient(box));
  }
  if (kind === "session" || typeof indexedDB === "undefined") return memoryStore();
  return indexedDbStore(kind);
}

export const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);
export const nowIso = () => new Date().toISOString();

export function newNotebook(title = "My notebook"): NotebookRecord {
  const at = nowIso();
  return { id: newId(), title, sources: [], memory: "", createdAt: at, updatedAt: at };
}

export function withSource(n: NotebookRecord, source: Omit<NotebookSource, "id" | "addedAt"> & Partial<Pick<NotebookSource, "id">>): NotebookRecord {
  const s: NotebookSource = { id: source.id ?? newId(), title: source.title, mime: source.mime, text: source.text, addedAt: nowIso() };
  return { ...n, sources: [...n.sources, s], updatedAt: nowIso() };
}

/** The notebook as the agent receives it (without the browser-only timestamps). */
export const notebookForAgent = ({ id, title, sources, memory }: NotebookRecord): Notebook => ({ id, title, sources, memory });
