// Sync v2 (SYN-1..6): two devices and a box. Rows go both ways with versions; a delete is a
// tombstone; a write on a stale version goes on the conflict list for a person to decide.
import { describe, expect, it } from "vitest";
import { applyWrite, createMemoryShadows, createSyncEngine, decodeCursor, encodeCursor, type SyncCollection, type SyncRemote, type SyncRow } from "../src/sync/index.js";

/** A box in memory with the box's own rules (applyWrite, a change sequence). */
function memoryBox(): SyncRemote & { rows: Map<string, SyncRow & { seq: number }> } {
  const rows = new Map<string, SyncRow & { seq: number }>();
  let seq = 0;
  const k = (c: string, id: string) => `${c}/${id}`;
  return {
    rows,
    async changes(collection, since) {
      const from = decodeCursor(since);
      const list = [...rows.entries()].filter(([key, r]) => key.startsWith(`${collection}/`) && r.seq > from).map(([, r]) => r).sort((a, b) => a.seq - b.seq);
      return { rows: list.map(({ seq: _seq, ...r }) => r), cursor: encodeCursor(list.at(-1)?.seq ?? from), more: false };
    },
    async batch(collection, ops, policy = "reject-stale") {
      return ops.map((op) => {
        const cur = rows.get(k(collection, op.id)) ?? null;
        const r = applyWrite(cur, { id: op.id, baseVersion: op.baseVersion, data: op.data, deleted: op.op === "delete" }, policy);
        if (!r.ok) return { id: op.id, conflict: true as const, row: cur };
        if (r.row) rows.set(k(collection, op.id), { ...r.row, seq: ++seq });
        return { id: op.id, ok: true as const, row: r.row };
      });
    },
  };
}

/** A device: its own app store (a Map per collection) and an engine. */
function device(box: SyncRemote) {
  const app = new Map<string, unknown>();
  const adapter = (c: SyncCollection) => ({ apply: async (id: string, data: unknown | null) => void (data === null ? app.delete(`${c}/${id}`) : app.set(`${c}/${id}`, data)) });
  const engine = createSyncEngine({ remote: box, shadows: createMemoryShadows(), adapters: { schedule: adapter("schedule"), notebooks: adapter("notebooks") } });
  const write = async (c: SyncCollection, id: string, data: unknown | null) => {
    if (data === null) app.delete(`${c}/${id}`);
    else app.set(`${c}/${id}`, data);
    await engine.track(c, id, data);
  };
  return { app, engine, write };
}

describe("sync v2", () => {
  it("carries rows between devices through the box, with versions", async () => {
    const box = memoryBox();
    const a = device(box);
    const b = device(box);
    await a.write("schedule", "mum", { title: "Mum's birthday" });
    expect(await a.engine.sync()).toEqual({ pushed: 1, pulled: 0, conflicts: 0 });
    expect(await b.engine.sync()).toEqual({ pushed: 0, pulled: 1, conflicts: 0 });
    expect(b.app.get("schedule/mum")).toEqual({ title: "Mum's birthday" });
    await b.write("schedule", "mum", { title: "Mum's birthday", date: "2027-03-03" });
    await b.engine.sync();
    await a.engine.sync();
    expect(a.app.get("schedule/mum")).toEqual({ title: "Mum's birthday", date: "2027-03-03" });
    expect(box.rows.get("schedule/mum")?.version).toBe(2);
    // Nothing new: nothing moves.
    expect(await a.engine.sync()).toEqual({ pushed: 0, pulled: 0, conflicts: 0 });
  });

  it("carries a delete as a tombstone", async () => {
    const box = memoryBox();
    const a = device(box);
    const b = device(box);
    await a.write("notebooks", "home", { title: "Home" });
    await a.engine.sync();
    await b.engine.sync();
    await b.write("notebooks", "home", null);
    await b.engine.sync();
    expect(box.rows.get("notebooks/home")).toMatchObject({ deleted: true, version: 2, data: null });
    await a.engine.sync();
    expect(a.app.has("notebooks/home")).toBe(false);
  });

  it("puts a clash on the conflict list, and a person keeps this device's copy or the box's", async () => {
    const box = memoryBox();
    const a = device(box);
    const b = device(box);
    await a.write("schedule", "dentist", { title: "Dentist", time: "16:00" });
    await a.engine.sync();
    await b.engine.sync();
    // Both change it while apart; a reaches the box first.
    await a.write("schedule", "dentist", { title: "Dentist", time: "17:00" });
    await b.write("schedule", "dentist", { title: "Dentist", time: "09:30" });
    await a.engine.sync();
    expect((await b.engine.sync()).conflicts).toBe(1);
    const [c] = await b.engine.conflicts();
    expect(c).toMatchObject({ collection: "schedule", id: "dentist", mine: { time: "09:30" }, theirs: { version: 2, data: { time: "17:00" } } });
    // b's own copy stays put until someone decides; a later sync doesn't overwrite it.
    await b.engine.sync();
    expect(b.app.get("schedule/dentist")).toEqual({ title: "Dentist", time: "09:30" });
    // Keep this device's: it goes over the box's, and a sees it.
    await b.engine.resolve(c!.key, "mine");
    expect(await b.engine.conflicts()).toEqual([]);
    expect(box.rows.get("schedule/dentist")).toMatchObject({ version: 3, data: { time: "09:30" } });
    await a.engine.sync();
    expect(a.app.get("schedule/dentist")).toEqual({ title: "Dentist", time: "09:30" });

    // Again, and this time keep the box's.
    await a.write("schedule", "dentist", { title: "Dentist", time: "11:00" });
    await b.write("schedule", "dentist", { title: "Dentist", time: "12:00" });
    await a.engine.sync();
    await b.engine.sync();
    const [c2] = await b.engine.conflicts();
    await b.engine.resolve(c2!.key, "theirs");
    expect(b.app.get("schedule/dentist")).toEqual({ title: "Dentist", time: "11:00" });
    expect(await b.engine.sync()).toEqual({ pushed: 0, pulled: 0, conflicts: 0 });
  });

  it("keeps changes when the box can't be reached, and sends them later", async () => {
    const box = memoryBox();
    let down = true;
    const flaky: SyncRemote = {
      changes: (c, s) => (down ? Promise.reject(new Error("offline")) : box.changes(c, s)),
      batch: (c, o, p) => (down ? Promise.reject(new Error("offline")) : box.batch(c, o, p)),
    };
    const a = device(flaky);
    await a.write("schedule", "bills", { title: "Pay the bills" });
    await expect(a.engine.sync()).rejects.toThrow("offline");
    down = false;
    expect((await a.engine.sync()).pushed).toBe(1);
    expect(box.rows.get("schedule/bills")?.data).toEqual({ title: "Pay the bills" });
  });

  it("cursors are opaque and survive garbage", () => {
    expect(decodeCursor(encodeCursor(1234))).toBe(1234);
    expect(decodeCursor("nonsense")).toBe(0);
    expect(decodeCursor(undefined)).toBe(0);
  });
});
