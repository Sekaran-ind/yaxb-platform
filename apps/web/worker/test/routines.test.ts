// Routines on the server (RTN-1..5): an event sets one off once, the sweep runs a due schedule once
// and logs a missed one as skipped, and the summary reads the service's events on the server.
import { describe, expect, it } from "vitest";
import { sqliteD1 } from "../../../../packages/yaxb-core/test/sqlite-d1";
import { nextScheduled, ROUTINE_STARTERS, runsFromEvents } from "@sekaran-ind/yaxb-core/routines";
import { ADMIN_ACTOR_ID, type LibraryActor } from "@sekaran-ind/yaxb-core/library";
import type { ServiceEvent } from "@sekaran-ind/yaxb-core/metrics";
import { withEdition } from "../edition";
import { catalogue, serviceEvents } from "../kiosk";
import { fireEvents, routineStore, sweep, sweepTenant } from "../routines";

const admin: LibraryActor = { id: ADMIN_ACTOR_ID, name: "Administrator", roles: ["administrator"], admin: true };
const reviewer: LibraryActor = { id: "r1", name: "Revathi", roles: ["reviewer"], admin: false };
const env = () => ({ SESSION_SECRET: "x".repeat(40), DB: sqliteD1(), DB_FAMILY: sqliteD1(), DB_BUSINESS: sqliteD1(), DB_COMMUNITY: sqliteD1() }) as never;
const inBusiness = <T>(fn: () => Promise<T>) => withEdition("business", fn);

async function publish(e: never, yaml: string) {
  const lib = await catalogue(e);
  const { entry } = await lib.createEntry(admin, null, { yaml });
  await lib.submit(admin, entry.id);
  await lib.review(reviewer, entry.id, { decision: "accept" });
  return entry;
}
const attendanceEntry = async (e: never) => (await (await catalogue(e)).published([], { all: true })).services.find((s) => s.id === "attendance")!.entry_id;
const event = (service: string, outcome: string, at = new Date()): ServiceEvent => ({ id: crypto.randomUUID(), service, journey: "check-in", kind: "journey.outcome", step: null, role: null, run: crypto.randomUUID(), at: at.toISOString(), ms: null, ok: null, actor: "Meena", outcome });

describe("routines on the server", () => {
  it("an event sets a routine off once, and its message is a notice for the role", () =>
    inBusiness(async () => {
      const e = env();
      const routine = await publish(e, ROUTINE_STARTERS.find((s) => s.id === "late-alert")!.yaml);
      const service = await attendanceEntry(e);
      const late = event(service, "attendance.late");
      const runs = await fireEvents(e, [late, event(service, "attendance.in")]);
      expect(runs.map((r) => r.status)).toEqual(["done"]);
      // The same event again (a kiosk's retry) runs nothing.
      expect(await fireEvents(e, [late])).toEqual([]);
      const notices = await routineStore(e).notices("default", ["manager"]);
      expect(notices).toHaveLength(1);
      expect(notices[0]!.text).toMatch(/^A late check-in at \d\d:\d\d on \d{4}-\d\d-\d\d\.$/);
      expect(await routineStore(e).notices("default", ["reviewer"])).toEqual([]);
      // The run is in the routine's own log, as events.
      const log = runsFromEvents(await serviceEvents(e).list(routine.id));
      expect(log.map((r) => [r.trigger, r.status, r.steps.map((s) => s.step)])).toEqual([["event", "done", ["1-message"]]]);
    }));

  it("the sweep runs a due schedule once, summarising the service's events, and logs a missed one as skipped", () =>
    inBusiness(async () => {
      const e = env();
      const routine = await publish(e, ROUTINE_STARTERS.find((s) => s.id === "monday-summary")!.yaml);
      const service = await attendanceEntry(e);
      await (await catalogue(e)).setEntryStorage(admin, service, "server");
      const monday = nextScheduled({ every: "week", on: "mon", at: "09:00" }, new Date());
      await serviceEvents(e).add([event(service, "attendance.in", new Date(monday.getTime() - 86_400_000)), event(service, "attendance.late", new Date(monday.getTime() - 2 * 86_400_000))]);

      expect(await sweepTenant(e, new Date(monday.getTime() - 60_000))).toEqual([]);
      const soon = new Date(monday.getTime() + 5 * 60_000);
      expect((await sweepTenant(e, soon)).map((r) => r.status)).toEqual(["done"]);
      expect(await sweepTenant(e, soon)).toEqual([]);
      const [n] = await routineStore(e).notices("default", ["manager"]);
      expect(n!.text).toMatch(/the last 7 days/);
      expect(n!.text).toMatch(/attendance\.late 1|Late/i);

      // The Worker was down the next Monday until noon: that run is skipped, not run late.
      const missed = new Date(monday.getTime() + 7 * 86_400_000 + 3 * 3_600_000);
      expect((await sweepTenant(e, missed)).map((r) => r.status)).toEqual(["skipped"]);
      expect(await sweepTenant(e, missed)).toEqual([]);
      expect(runsFromEvents(await serviceEvents(e).list(routine.id)).map((r) => r.status)).toEqual(["skipped", "done"]);
    }));

  it("a paused business runs nothing, but the run is logged so it doesn't catch up later", () =>
    inBusiness(async () => {
      const e = env();
      await publish(e, ROUTINE_STARTERS.find((s) => s.id === "late-alert")!.yaml);
      await routineStore(e).putSettings("default", { paused: true, limits: { runsPerDay: 200, messagesPerDay: 100, connectorCallsPerDay: 200 } });
      const runs = await fireEvents(e, [event(await attendanceEntry(e), "attendance.late")]);
      expect(runs.map((r) => r.status)).toEqual(["paused"]);
      expect(await routineStore(e).notices("default", ["manager"])).toEqual([]);
    }));

  it("sweeps every edition with a published routine", async () => {
    const e = env();
    await inBusiness(() => publish(e, ROUTINE_STARTERS.find((s) => s.id === "monday-summary")!.yaml));
    const monday = nextScheduled({ every: "week", on: "mon", at: "09:00" }, new Date());
    // Attendance keeps no records on the server here, so the summary fails: the run is still one run.
    expect(await sweep(e, new Date(monday.getTime() + 60_000))).toBe(1);
    expect(await sweep(e, new Date(monday.getTime() + 120_000))).toBe(0);
  });
});
