// Attendance (ATT-1..6): a business's roster (departments, shifts, employees) kept as service data on
// its box (SYN), check-ins with a PIN or a QR at the front desk, each an event with an outcome (in,
// out, late), and weekly or monthly reports over those events. There is nothing to import: the
// roster is kept here from the start (ATT-5 dropped, 2026-11-20). Rebuilt on Anjal, not ported: the
// kiosk's front desk is Restricted Mode; the events are services' events (MET).
export type Department = { id: string; name: string };
/** A shift: when it starts and ends (HH:MM), the minutes allowed before "late", and its weekdays (0 = Sunday). */
export type Shift = { id: string; name: string; start: string; end: string; grace: number; days: number[] };
/** An employee: a PIN kept only as a hash, and a QR token printed on their card. Never an ID number. */
export type Employee = { id: string; name: string; department: string | null; shift: string | null; pin_hash: string | null; qr: string; active: boolean };
/** A site for the optional location check (ATT-6): only "inside site X" is ever kept. */
export type Site = { id: string; name: string; lat: number; lng: number; radius_m: number };
export type Roster = { version: 1; departments: Department[]; shifts: Shift[]; employees: Employee[]; sites: Site[]; updated_at: string };
export const emptyRoster = (): Roster => ({ version: 1, departments: [], shifts: [], employees: [], sites: [], updated_at: new Date(0).toISOString() });

export type CheckKind = "in" | "out";
/** What a check-in records (an event's outcome): attendance.in, attendance.late, attendance.out. */
export type CheckOutcome = "attendance.in" | "attendance.late" | "attendance.out";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const enc = new TextEncoder();
async function sha256(text: string) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
/** A PIN's hash for this employee (salted with their id, so equal PINs differ). */
export const hashPin = (employeeId: string, pin: string) => sha256(`yaxb-attendance:${employeeId}:${pin}`);
export const PIN = /^\d{4,6}$/;
export const newQr = () => [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, "0")).join("");

export class AttendanceError extends Error {}

/** What's wrong with a roster ([] when nothing). */
export function rosterProblems(r: Roster): string[] {
  const p: string[] = [];
  const ids = (xs: { id: string }[], what: string) => {
    const seen = new Set<string>();
    for (const x of xs) {
      if (!x.id) p.push(`A ${what} has no id.`);
      if (seen.has(x.id)) p.push(`Two ${what}s have the id ${x.id}.`);
      seen.add(x.id);
    }
  };
  ids(r.departments, "department");
  ids(r.shifts, "shift");
  ids(r.employees, "employee");
  for (const s of r.shifts) {
    if (!HHMM.test(s.start) || !HHMM.test(s.end)) p.push(`The shift ${s.name} needs a start and an end, like 09:00.`);
    if (!Number.isInteger(s.grace) || s.grace < 0 || s.grace > 240) p.push(`The shift ${s.name}'s grace is 0 to 240 minutes.`);
  }
  for (const e of r.employees) {
    if (!e.name.trim()) p.push("An employee has no name.");
    if (e.department && !r.departments.some((d) => d.id === e.department)) p.push(`${e.name}'s department isn't in the roster.`);
    if (e.shift && !r.shifts.some((s) => s.id === e.shift)) p.push(`${e.name}'s shift isn't in the roster.`);
  }
  return p;
}

/** Who is checking in: by PIN (compared with each active employee's hash) or by their QR token. */
export async function whoChecks(r: Roster, input: { pin?: string; qr?: string }): Promise<Employee | null> {
  const qr = input.qr?.trim();
  if (qr) return r.employees.find((e) => e.active && e.qr === qr) ?? null;
  if (!input.pin || !PIN.test(input.pin)) return null;
  for (const e of r.employees) if (e.active && e.pin_hash && e.pin_hash === (await hashPin(e.id, input.pin))) return e;
  return null;
}

/** A check-in's outcome: late when it is after the shift's start plus its grace, on a working day. */
export function checkOutcome(r: Roster, e: Employee, kind: CheckKind, at: Date, timeZoneOffsetMinutes = 330): CheckOutcome {
  if (kind === "out") return "attendance.out";
  const shift = e.shift ? r.shifts.find((s) => s.id === e.shift) : null;
  if (!shift) return "attendance.in";
  const local = new Date(at.getTime() + timeZoneOffsetMinutes * 60_000);
  const nowMin = local.getUTCHours() * 60 + local.getUTCMinutes();
  if (shift.days.length && !shift.days.includes(local.getUTCDay())) return "attendance.in";
  return nowMin > minutes(shift.start) + shift.grace ? "attendance.late" : "attendance.in";
}

/** Whether a position is inside a site (ATT-6), by the haversine distance. Only the answer is kept. */
export function insideSite(site: Site, lat: number, lng: number): boolean {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat - site.lat);
  const dLng = toRad(lng - site.lng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(site.lat)) * Math.cos(toRad(lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a)) <= site.radius_m;
}

// ---- reports (ATT-3) --------------------------------------------------------------------------------

/** A check-in as an event carries: who (the employee's id in `actor`), when, and the outcome. */
export type CheckEvent = { at: string; employee: string; outcome: CheckOutcome };
export type DayCell = { first_in: string | null; last_out: string | null; late: boolean };
/** Each employee's days between two dates (YYYY-MM-DD, inclusive), in local time. */
export function rosterReport(r: Roster, events: readonly CheckEvent[], from: string, to: string, timeZoneOffsetMinutes = 330) {
  const days: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d = new Date(d.getTime() + 86400_000)) days.push(d.toISOString().slice(0, 10));
  const local = (iso: string) => new Date(new Date(iso).getTime() + timeZoneOffsetMinutes * 60_000).toISOString();
  const rows = r.employees.map((e) => {
    const cells: Record<string, DayCell> = {};
    for (const ev of events.filter((x) => x.employee === e.id)) {
      const l = local(ev.at);
      const day = l.slice(0, 10);
      if (!days.includes(day)) continue;
      const t = l.slice(11, 16);
      const c = (cells[day] ??= { first_in: null, last_out: null, late: false });
      if (ev.outcome === "attendance.out") c.last_out = !c.last_out || t > c.last_out ? t : c.last_out;
      else {
        if (!c.first_in || t < c.first_in) c.first_in = t;
        if (ev.outcome === "attendance.late") c.late = true;
      }
    }
    const present = Object.keys(cells).filter((d) => cells[d]!.first_in).length;
    const late = Object.values(cells).filter((c) => c.late).length;
    return { employee: e.id, name: e.name, department: r.departments.find((d) => d.id === e.department)?.name ?? "", cells, present, late };
  });
  return { days, rows };
}

// ---- CSV export (ATT-4) ------------------------------------------------------------------------------

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s;
};
export const toCsv = (rows: readonly (readonly unknown[])[]) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

/** A report as CSV: one row per employee, a column per day ("09:05-18:10", "late 09:20-18:00"). */
export function reportCsv(report: ReturnType<typeof rosterReport>) {
  const head = ["Employee", "Department", ...report.days, "Days present", "Days late"];
  const body = report.rows.map((r) => [r.name, r.department, ...report.days.map((d) => (r.cells[d] ? `${r.cells[d]!.late ? "late " : ""}${r.cells[d]!.first_in ?? ""}-${r.cells[d]!.last_out ?? ""}` : "")), r.present, r.late]);
  return toCsv([head, ...body]);
}
/** The roster as CSV (no PINs, no QR tokens). */
export function rosterCsv(r: Roster) {
  return toCsv([["Name", "Department", "Shift", "Active"], ...r.employees.map((e) => [e.name, r.departments.find((d) => d.id === e.department)?.name ?? "", r.shifts.find((s) => s.id === e.shift)?.name ?? "", e.active ? "yes" : "no"])]);
}
