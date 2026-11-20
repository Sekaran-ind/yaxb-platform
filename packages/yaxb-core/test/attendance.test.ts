// Attendance (ATT-1..6): check-ins by PIN or QR with an outcome, reports, CSV in and out.
import { describe, expect, it } from "vitest";
import { checkOutcome, hashPin, insideSite, newQr, reportCsv, rosterCsv, rosterProblems, rosterReport, whoChecks, type Roster } from "../src/attendance/index.js";

async function roster(): Promise<Roster> {
  const r: Roster = {
    version: 1,
    departments: [{ id: "d-sales", name: "Sales" }, { id: "d-stores", name: "Stores" }],
    shifts: [{ id: "s-morning", name: "Morning", start: "09:00", end: "18:00", grace: 10, days: [1, 2, 3, 4, 5, 6] }],
    employees: [
      { id: "e-1", name: "Meena Raj", department: "d-sales", shift: "s-morning", pin_hash: null, qr: newQr(), active: true },
      { id: "e-2", name: "Ravi, Kumar", department: "d-stores", shift: "s-morning", pin_hash: null, qr: newQr(), active: true },
      { id: "e-3", name: "Sita", department: "d-sales", shift: null, pin_hash: null, qr: newQr(), active: false },
    ],
    sites: [],
    updated_at: "2026-11-20T00:00:00Z",
  };
  r.employees[0]!.pin_hash = await hashPin("e-1", "4321");
  return r;
}

describe("attendance", () => {
  it("checks a roster and exports it without PINs or cards", async () => {
    const r = await roster();
    expect(rosterProblems(r)).toEqual([]);
    expect(rosterProblems({ ...r, employees: [...r.employees, { ...r.employees[0]!, id: "e-9", shift: "nope" }] }).join()).toMatch(/shift isn't in the roster/);
    const csv = rosterCsv(r);
    expect(csv).toContain('"Ravi, Kumar",Stores,Morning,yes');
    expect(csv).not.toContain(r.employees[0]!.pin_hash!);
    // An inactive employee can't check in.
    expect(await whoChecks(r, { qr: r.employees[2]!.qr })).toBeNull();
  });

  it("checks in by PIN or QR, late after the shift's start and grace", async () => {
    const r = await roster();
    const meena = await whoChecks(r, { pin: "4321" });
    expect(meena?.name).toBe("Meena Raj");
    expect(await whoChecks(r, { pin: "0000" })).toBeNull();
    const ravi = r.employees.find((e) => e.name === "Ravi, Kumar")!;
    expect((await whoChecks(r, { qr: ravi.qr }))?.id).toBe(ravi.id);
    // 09:05 and 09:25 India time on a Monday (UTC 03:35 and 03:55); grace 10 minutes.
    expect(checkOutcome(r, meena!, "in", new Date("2026-11-23T03:35:00Z"))).toBe("attendance.in");
    expect(checkOutcome(r, meena!, "in", new Date("2026-11-23T03:55:00Z"))).toBe("attendance.late");
    expect(checkOutcome(r, meena!, "out", new Date("2026-11-23T12:40:00Z"))).toBe("attendance.out");
    // Sunday isn't a working day of the imported shift.
    expect(checkOutcome(r, meena!, "in", new Date("2026-11-22T05:00:00Z"))).toBe("attendance.in");
  });

  it("reports a week from the events, and exports it", async () => {
    const r = await roster();
    const meena = r.employees.find((e) => e.name === "Meena Raj")!;
    const events = [
      { at: "2026-11-23T03:55:00Z", employee: meena.id, outcome: "attendance.late" as const },
      { at: "2026-11-23T12:40:00Z", employee: meena.id, outcome: "attendance.out" as const },
      { at: "2026-11-24T03:30:00Z", employee: meena.id, outcome: "attendance.in" as const },
    ];
    const rep = rosterReport(r, events, "2026-11-23", "2026-11-29");
    expect(rep.days).toHaveLength(7);
    const row = rep.rows.find((x) => x.name === "Meena Raj")!;
    expect(row.cells["2026-11-23"]).toEqual({ first_in: "09:25", last_out: "18:10", late: true });
    expect(row).toMatchObject({ present: 2, late: 1 });
    const csv = reportCsv(rep);
    expect(csv.split("\r\n")[0]).toContain("2026-11-23");
    expect(csv).toContain("late 09:25-18:10");
  });

  it("guards CSV against formulas", async () => {
    const r = await roster();
    r.employees[0]!.name = "=HYPERLINK(1)";
    expect(rosterCsv(r)).toContain(`"'=HYPERLINK(1)"`);
  });

  it("checks a location against a site, keeping only inside or not", () => {
    const site = { id: "s1", name: "Shop", lat: 13.0827, lng: 80.2707, radius_m: 150 };
    expect(insideSite(site, 13.0832, 80.2711)).toBe(true);
    expect(insideSite(site, 13.1, 80.3)).toBe(false);
  });
});
