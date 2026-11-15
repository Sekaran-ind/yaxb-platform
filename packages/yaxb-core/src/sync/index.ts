// Sync v2 with the box (SYN-1..6), after Cübo's protocol (clinux-core collections/protocol.js):
// a device keeps working offline and syncs with the business's box when it can.
//
// On the wire a row is { id, version, deleted, updatedAt, data }: `version` counts writes (1 when
// created) and a delete is a tombstone with a version, pulled like any change. The box (apps/box,
// /v2/collections/<name>) serves changes since an opaque cursor, takes writes with the version
// the device last saw (`baseVersion`, 0 for a new row) and refuses a stale one with 409 and its
// own copy ('reject-stale'), or always applies it ('last-write-wins').
//
// The engine keeps a shadow per row (the version last seen, whether this device changed it since,
// its last data) apart from the app's own stores, so a surface adds sync without changing them:
//   track(collection, id, data | null)   the app changed a row (null: deleted it)
//   sync()                               push what changed (a stale write → the conflict list),
//                                        then pull changes since the cursor into the app (adapters)
//   resolve(conflict, "mine" | "theirs") keep this device's copy (written over the box's) or the box's
import type { BoxClient } from "../stores/box.js";

export const PROTOCOL_VERSION = 2;
export const SYNC_COLLECTIONS = ["notebooks", "threads", "schedule", "service-data"] as const;
export type SyncCollection = (typeof SYNC_COLLECTIONS)[number];
export type ConflictPolicy = "reject-stale" | "last-write-wins";

export type SyncRow<T = unknown> = { id: string; version: number; deleted: boolean; updatedAt: string; data: T | null };
export type SyncOp = { op: "put" | "delete"; id: string; baseVersion: number; data?: unknown };
export type SyncResult = { id: string; ok: true; row: SyncRow | null } | { id: string; conflict: true; row: SyncRow | null };

/** An opaque cursor for a change sequence number, and back (0 for none or garbage). */
export const encodeCursor = (seq: number) => `c${Number(seq || 0).toString(36)}`;
export const decodeCursor = (cursor: string | null | undefined) => (/^c[0-9a-z]+$/.test(String(cursor ?? "")) ? parseInt(String(cursor).slice(1), 36) : 0);

/**
 * One write against the current row (null when there is none): { ok, row } with the next version,
 * or { conflict, row: current } when stale under reject-stale. The box implements the same rule.
 */
export function applyWrite(current: SyncRow | null, write: { id: string; baseVersion: number; data?: unknown; deleted?: boolean; at?: string }, policy: ConflictPolicy = "reject-stale"): { ok: true; row: SyncRow | null } | { ok: false; conflict: true; row: SyncRow | null } {
  const have = current?.version ?? 0;
  if (policy === "reject-stale" && Number(write.baseVersion || 0) !== have) return { ok: false, conflict: true, row: current };
  if (write.deleted && (!current || current.deleted)) return { ok: true, row: current };
  return { ok: true, row: { id: write.id, version: have + 1, deleted: Boolean(write.deleted), updatedAt: write.at ?? new Date().toISOString(), data: write.deleted ? null : (write.data ?? null) } };
}

/** What the engine needs from the box: changes since a cursor, and a batch of writes. */
export type SyncRemote = {
  changes(collection: SyncCollection, since: string): Promise<{ rows: SyncRow[]; cursor: string; more: boolean }>;
  batch(collection: SyncCollection, ops: SyncOp[], policy?: ConflictPolicy): Promise<SyncResult[]>;
};

/** The box client as a sync remote. */
export const boxRemote = (client: BoxClient): SyncRemote => ({
  changes: (collection, since) => client.changes(collection, since),
  batch: (collection, ops, policy) => client.batch(collection, ops, policy),
});

/** A row's shadow on this device: the box's version it last saw, and whether it changed here since. */
export type Shadow = { version: number; dirty: boolean; deleted: boolean; data: unknown; conflicted?: boolean };
/** A clash between this device and the box, for a person to decide (never decided for them). */
export type SyncConflict = { key: string; collection: SyncCollection; id: string; mine: unknown; theirs: SyncRow | null; at: string };

/** Where the engine keeps its shadows, cursors and conflicts (IndexedDB in the browser). */
export type ShadowStore = {
  get(collection: SyncCollection, id: string): Promise<Shadow | null>;
  put(collection: SyncCollection, id: string, shadow: Shadow): Promise<void>;
  dirty(collection: SyncCollection): Promise<{ id: string; shadow: Shadow }[]>;
  cursor(collection: SyncCollection): Promise<string>;
  setCursor(collection: SyncCollection, cursor: string): Promise<void>;
  conflicts(): Promise<SyncConflict[]>;
  addConflict(c: SyncConflict): Promise<void>;
  removeConflict(key: string): Promise<void>;
};

/** How a pulled row reaches the app's own store (null data: delete it there). */
export type SyncAdapter = { apply(id: string, data: unknown | null): Promise<void> };

export type SyncSummary = { pushed: number; pulled: number; conflicts: number };
const conflictKey = (collection: string, id: string) => `${collection}/${id}`;

export function createSyncEngine({ remote, shadows, adapters, now = () => new Date() }: { remote: SyncRemote; shadows: ShadowStore; adapters: Partial<Record<SyncCollection, SyncAdapter>>; now?: () => Date }) {
  const collections = SYNC_COLLECTIONS.filter((c) => adapters[c]);

  async function conflict(collection: SyncCollection, id: string, mine: unknown, theirs: SyncRow | null) {
    const shadow = await shadows.get(collection, id);
    if (shadow) await shadows.put(collection, id, { ...shadow, conflicted: true, dirty: false });
    await shadows.addConflict({ key: conflictKey(collection, id), collection, id, mine, theirs, at: now().toISOString() });
  }

  async function push(collection: SyncCollection): Promise<{ pushed: number; conflicts: number }> {
    const dirty = (await shadows.dirty(collection)).filter((d) => !d.shadow.conflicted);
    if (!dirty.length) return { pushed: 0, conflicts: 0 };
    const results = await remote.batch(
      collection,
      dirty.map(({ id, shadow }) => (shadow.deleted ? { op: "delete", id, baseVersion: shadow.version } : { op: "put", id, baseVersion: shadow.version, data: shadow.data })),
    );
    let pushed = 0;
    let clashes = 0;
    for (const r of results) {
      const mine = dirty.find((d) => d.id === r.id)!;
      if ("ok" in r) {
        pushed++;
        await shadows.put(collection, r.id, { version: r.row?.version ?? mine.shadow.version, dirty: false, deleted: mine.shadow.deleted, data: mine.shadow.data });
      } else {
        clashes++;
        await conflict(collection, r.id, mine.shadow.deleted ? null : mine.shadow.data, r.row);
      }
    }
    return { pushed, conflicts: clashes };
  }

  async function pull(collection: SyncCollection): Promise<{ pulled: number; conflicts: number }> {
    const adapter = adapters[collection]!;
    let cursor = await shadows.cursor(collection);
    let pulled = 0;
    let clashes = 0;
    for (let page = 0; page < 100; page++) {
      const { rows, cursor: next, more } = await remote.changes(collection, cursor);
      for (const row of rows) {
        const shadow = await shadows.get(collection, row.id);
        if (shadow && row.version <= shadow.version) continue; // already seen (or written) here
        if (shadow?.dirty || shadow?.conflicted) {
          // Changed here and on the box: a person decides.
          if (!shadow.conflicted) {
            clashes++;
            await conflict(collection, row.id, shadow.deleted ? null : shadow.data, row);
          }
          continue;
        }
        await adapter.apply(row.id, row.deleted ? null : row.data);
        await shadows.put(collection, row.id, { version: row.version, dirty: false, deleted: row.deleted, data: row.data });
        pulled++;
      }
      cursor = next;
      await shadows.setCursor(collection, cursor);
      if (!more) break;
    }
    return { pulled, conflicts: clashes };
  }

  return {
    collections,
    /** The app changed a row here (null: deleted it): it goes to the box at the next sync. */
    async track(collection: SyncCollection, id: string, data: unknown | null) {
      const shadow = await shadows.get(collection, id);
      // A row deleted here that the box never had: nothing to send.
      if (data === null && !shadow) return;
      await shadows.put(collection, id, { version: shadow?.version ?? 0, dirty: true, deleted: data === null, data: data === null ? (shadow?.data ?? null) : data, conflicted: shadow?.conflicted });
    },
    /** Push, then pull, every collection. A failure to reach the box throws (nothing is lost: rows stay dirty). */
    async sync(): Promise<SyncSummary> {
      const out: SyncSummary = { pushed: 0, pulled: 0, conflicts: 0 };
      for (const c of collections) {
        const a = await push(c);
        const b = await pull(c);
        out.pushed += a.pushed;
        out.pulled += b.pulled;
        out.conflicts += a.conflicts + b.conflicts;
      }
      return out;
    },
    conflicts: () => shadows.conflicts(),
    /** Settle a conflict: "mine" writes this device's copy over the box's; "theirs" takes the box's here. */
    async resolve(key: string, choice: "mine" | "theirs") {
      const c = (await shadows.conflicts()).find((x) => x.key === key);
      if (!c) return;
      const boxVersion = c.theirs?.version ?? 0;
      if (choice === "theirs") {
        await adapters[c.collection]!.apply(c.id, c.theirs && !c.theirs.deleted ? c.theirs.data : null);
        await shadows.put(c.collection, c.id, { version: boxVersion, dirty: false, deleted: Boolean(c.theirs?.deleted ?? true), data: c.theirs?.data ?? null });
      } else {
        const [r] = await remote.batch(c.collection, [c.mine === null ? { op: "delete", id: c.id, baseVersion: boxVersion } : { op: "put", id: c.id, baseVersion: boxVersion, data: c.mine }]);
        if (!r || !("ok" in r)) {
          // The box moved on again meanwhile: the conflict stays, with its newest copy.
          await shadows.addConflict({ ...c, theirs: r?.row ?? c.theirs, at: now().toISOString() });
          return;
        }
        await shadows.put(c.collection, c.id, { version: r.row?.version ?? boxVersion + 1, dirty: false, deleted: c.mine === null, data: c.mine });
      }
      await shadows.removeConflict(key);
    },
  };
}
export type SyncEngine = ReturnType<typeof createSyncEngine>;

/** Shadows in memory (tests, and the CLI). */
export function createMemoryShadows(): ShadowStore {
  const rows = new Map<string, Shadow>();
  const cursors = new Map<string, string>();
  const conflicts = new Map<string, SyncConflict>();
  const k = (c: string, id: string) => `${c}/${id}`;
  return {
    get: async (c, id) => (rows.has(k(c, id)) ? structuredClone(rows.get(k(c, id))!) : null),
    put: async (c, id, s) => void rows.set(k(c, id), structuredClone(s)),
    dirty: async (c) => [...rows].filter(([key, s]) => key.startsWith(`${c}/`) && s.dirty).map(([key, s]) => ({ id: key.slice(c.length + 1), shadow: structuredClone(s) })),
    cursor: async (c) => cursors.get(c) ?? "",
    setCursor: async (c, cursor) => void cursors.set(c, cursor),
    conflicts: async () => [...conflicts.values()].map((x) => structuredClone(x)),
    addConflict: async (x) => void conflicts.set(x.key, structuredClone(x)),
    removeConflict: async (key) => void conflicts.delete(key),
  };
}
