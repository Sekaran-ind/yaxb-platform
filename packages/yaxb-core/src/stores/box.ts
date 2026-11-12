// A client for yaxb-box (apps/box): the kiosk's storage on the local network, a Raspberry Pi with
// SQLite and Litestream. DOM-free (fetch only), so the browser (Storage: "Box"), the CLI and a
// local server all use the same client.
import type { Kv, KvItem } from "./kv.js";
import type { ThreadState, ThreadStore } from "./index.js";

export type BoxRecord<T> = { id: string; parent: string | null; data: T; updatedAt: string };

export class BoxError extends Error {
  override name = "BoxError";
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type BoxClient = ReturnType<typeof createBoxClient>;

export function createBoxClient({ url, token, fetch: fetchImpl = globalThis.fetch.bind(globalThis), timeoutMs = 10_000 }: { url: string; token: string; fetch?: typeof fetch; timeoutMs?: number }) {
  const base = url.replace(/\/+$/, "");
  if (!/^https?:\/\/[^/]+$/.test(base)) throw new BoxError("The box URL should look like https://192.168.1.14:47870", 0);

  async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T | null> {
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method: init.method ?? "GET",
        headers: { Authorization: `Bearer ${token}`, ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new BoxError(`Can't reach the box at ${base}. Is it on, and is its certificate trusted on this device? (${(e as Error).name})`, 0);
    }
    if (res.status === 404 && (init.method ?? "GET") === "GET") return null;
    if (res.status === 204) return null;
    const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!res.ok) throw new BoxError(body?.error ?? `The box answered HTTP ${res.status}.`, res.status);
    return body;
  }
  const enc = encodeURIComponent;

  return {
    url: base,
    health: async () => {
      const res = await fetchImpl(`${base}/health`, { signal: AbortSignal.timeout(timeoutMs) }).catch(() => null);
      if (!res?.ok) throw new BoxError(`Can't reach the box at ${base}.`, res?.status ?? 0);
      return (await res.json()) as { ok: boolean; name: string; version: string };
    },
    /** Checks the URL, the certificate and the token in one go. */
    async check() {
      await this.health();
      await call("/v1/notebooks?limit=1");
      return true;
    },
    list: async <T>(collection: "notebooks" | "threads") => ((await call<{ items: BoxRecord<T>[] }>(`/v1/${collection}`))?.items ?? []),
    threadsOf: async <T>(notebookId: string) => ((await call<{ items: BoxRecord<T>[] }>(`/v1/notebooks/${enc(notebookId)}/threads`))?.items ?? []),
    get: async <T>(collection: "notebooks" | "threads", id: string) => (await call<BoxRecord<T>>(`/v1/${collection}/${enc(id)}`))?.data ?? null,
    put: async (collection: "notebooks" | "threads", id: string, data: object) => void (await call(`/v1/${collection}/${enc(id)}`, { method: "PUT", body: data })),
    delete: async (collection: "notebooks" | "threads", id: string) => void (await call(`/v1/${collection}/${enc(id)}`, { method: "DELETE" })),
    /** The box as a Kv, for KvStore (Deep Agents' StoreBackend). */
    kv(): Kv {
      return {
        get: async (ns, key) => await call<KvItem>(`/v1/kv/${enc(ns)}/${enc(key)}`),
        put: async (ns, key, value) => void (await call(`/v1/kv/${enc(ns)}/${enc(key)}`, value === null ? { method: "DELETE" } : { method: "PUT", body: { value } })),
        search: async (prefix, { limit, offset }) => (await call<{ items: KvItem[] }>(`/v1/kv?prefix=${enc(prefix)}&limit=${Math.min(limit, 500)}&offset=${offset}`))?.items ?? [],
        namespaces: async ({ limit, offset }) => (await call<{ items: string[][] }>(`/v1/kv-namespaces?limit=${Math.min(limit, 500)}&offset=${offset}`))?.items ?? [],
      };
    },
  };
}

async function hashId(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...bytes.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Conversations on the box (CLI, local server). Thread ids are hashed: they contain ":" and the session namespace. */
export function createBoxThreadStore(client: BoxClient, { notebookId = "cli" }: { notebookId?: string } = {}): ThreadStore {
  return {
    async get(threadId) {
      const r = await client.get<{ state: ThreadState }>("threads", await hashId(threadId));
      return r?.state ?? null;
    },
    async put(threadId, state) {
      await client.put("threads", await hashId(threadId), { notebookId, title: "", updatedAt: new Date().toISOString(), turns: [], state });
    },
    async delete(threadId) {
      await client.delete("threads", await hashId(threadId));
    },
  };
}
