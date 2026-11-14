import { describe, expect, it } from "vitest";
import { draftFromFills, occurrences, parseScheduleText, scheduleItemSchema, serviceDateProblems, upcoming, type ScheduleItem } from "../src/schedule/index.js";

// Friday 13 November 2026.
const TODAY = new Date(2026, 10, 13);
const item = (p: Partial<ScheduleItem>): ScheduleItem => ({
  id: p.id ?? "x",
  owner: null,
  kind: "event",
  title: "Thing",
  date: null,
  time: null,
  repeat: "none",
  done: false,
  person: null,
  notes: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...p,
});

describe("the Scheduler agent, on the device (SCH-5)", () => {
  it("reads birthdays and anniversaries, with whose they are, as yearly", () => {
    expect(parseScheduleText("Mum's birthday on 3 March", TODAY)).toEqual({ kind: "birthday", title: "Mum's birthday", date: "2027-03-03", time: null, repeat: "yearly", person: "Mum" });
    expect(parseScheduleText("Ravi's birthday is December 2", TODAY)).toMatchObject({ kind: "birthday", person: "Ravi", date: "2026-12-02" });
    expect(parseScheduleText("Our anniversary is June 12", TODAY)).toMatchObject({ kind: "anniversary", title: "Our anniversary", date: "2027-06-12", repeat: "yearly" });
  });

  it("reads to-dos and events with relative days and times", () => {
    expect(parseScheduleText("remind me to renew the passport next Friday at 10am", TODAY)).toEqual({ kind: "todo", title: "Renew the passport", date: "2026-11-20", time: "10:00", repeat: "none", person: null });
    expect(parseScheduleText("Dentist tomorrow at 4:30pm", TODAY)).toMatchObject({ kind: "event", title: "Dentist", date: "2026-11-14", time: "16:30" });
    expect(parseScheduleText("Book the hall in 2 weeks", TODAY)).toMatchObject({ kind: "todo", date: "2026-11-27" });
    expect(parseScheduleText("Team lunch 2026-12-05", TODAY)).toMatchObject({ kind: "event", date: "2026-12-05", title: "Team lunch" });
    expect(parseScheduleText("buy running shoes", TODAY)).toMatchObject({ kind: "todo", date: null, title: "Buy running shoes" });
  });

  it("lets the model's fills win where it found something, and keeps the rest", () => {
    const base = parseScheduleText("Asha's birthday", TODAY);
    expect(draftFromFills(base, [{ field: "date", value: "2027-01-09" }, { field: "kind", value: "nonsense" }, { field: "time", value: "25:00" }])).toMatchObject({ kind: "birthday", date: "2027-01-09", time: null, person: "Asha" });
  });
});

describe("the calendar (SCH-1..4)", () => {
  it("repeats birthdays every year (29 February on the 28th otherwise) and counts the years", () => {
    const items = [item({ id: "b", kind: "birthday", title: "Ravi's birthday", date: "2000-02-29", repeat: "yearly", person: "Ravi" }), item({ id: "w", title: "Yoga", date: "2026-11-02", repeat: "weekly" })];
    const occ = occurrences(items, "2027-02-01", "2027-03-01");
    expect(occ.filter((o) => o.id === "b")).toEqual([expect.objectContaining({ date: "2027-02-28", years: 27 })]);
    expect(occ.filter((o) => o.id === "w").map((o) => o.date)).toEqual(["2027-02-01", "2027-02-08", "2027-02-15", "2027-02-22", "2027-03-01"]);
  });

  it("shows the services' dates beside one's own, and what's overdue or undated", () => {
    const services = [{ entry: "e1", title: "Marathon", dates: [{ id: "race-day", title: "Race day", date: "2026-11-15", time: "06:00" }, { id: "later", title: "Results", date: "2027-01-10" }] }];
    const items = [item({ id: "t1", kind: "todo", title: "Pay the fee", date: "2026-11-10" }), item({ id: "t2", kind: "todo", title: "Buy shoes" }), item({ id: "e", title: "Expo", date: "2026-11-14" })];
    const u = upcoming(items, "2026-11-13", 7, services);
    expect(u.dated.map((o) => `${o.date} ${o.title}${o.service ? ` (${o.service.title})` : ""}`)).toEqual(["2026-11-14 Expo", "2026-11-15 Race day (Marathon)"]);
    expect(u.overdue.map((i) => i.title)).toEqual(["Pay the fee"]);
    expect(u.undated.map((i) => i.title)).toEqual(["Buy shoes"]);
  });

  it("checks entries and a service's dates", () => {
    expect(scheduleItemSchema.safeParse(item({ date: "13/11/2026" })).success).toBe(false);
    expect(serviceDateProblems([{ id: "race-day", title: "Race day", date: "2026-11-15" }])).toEqual([]);
    expect(serviceDateProblems([{ id: "race-day", title: "Race day", date: "15 Nov" }]).join()).toMatch(/YYYY-MM-DD/);
    expect(serviceDateProblems([{ id: "a", title: "A", date: "2026-01-01" }, { id: "a", title: "B", date: "2026-01-02" }]).join()).toMatch(/twice/);
    expect(serviceDateProblems("soon")).toHaveLength(1);
  });
});
