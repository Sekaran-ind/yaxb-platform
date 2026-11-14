// The Scheduler (SCH-1..8): a calendar for each person and for the services. A person keeps their
// to-dos, the birthdays and anniversaries of their friends and family, and their own events (on
// their device, with their profile). A service has its own dates (a marathon's registration closing
// day, bib collection day and race day), written in the service (`dates:`), which the kiosks that
// offer it show. The Scheduler agent turns "Mum's birthday on 3 March" into an entry to confirm: on
// the device with `parseScheduleText`, or with the AI model filling `scheduleFields()`.
import { z } from "zod";
import type { Field } from "../journeys/index.js";

export const SCHEDULE_KINDS = ["todo", "birthday", "anniversary", "event"] as const;
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];
export const REPEATS = ["none", "weekly", "monthly", "yearly"] as const;
export type Repeat = (typeof REPEATS)[number];

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const scheduleItemSchema = z.strictObject({
  id: z.string().min(1).max(64),
  /** The profile it belongs to; null: this device's (no profile). */
  owner: z.string().max(80).nullable(),
  kind: z.enum(SCHEDULE_KINDS),
  title: z.string().trim().min(1).max(120),
  /** A day (YYYY-MM-DD); a to-do may have none. */
  date: z.string().regex(DAY).nullable(),
  time: z.string().regex(TIME).nullable(),
  repeat: z.enum(REPEATS),
  done: z.boolean(),
  /** Whose birthday or anniversary. */
  person: z.string().trim().max(80).nullable(),
  notes: z.string().max(500).nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type ScheduleItem = z.infer<typeof scheduleItemSchema>;
export type ScheduleDraft = Pick<ScheduleItem, "kind" | "title" | "date" | "time" | "repeat" | "person">;

/** A date a service declares (`dates:` in the service). */
export type ServiceDate = { id: string; title: string; date: string; time?: string | null; description?: string | null };
export const serviceDateSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  title: z.string().trim().min(1).max(120),
  date: z.string().regex(DAY),
  time: z.string().regex(TIME).nullable().optional(),
  description: z.string().max(300).nullable().optional(),
});

/** Problems with a service's `dates:` (the catalogue checks them with the rest of the service). */
export function serviceDateProblems(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return ["dates must be a list of { id, title, date }"];
  const problems: string[] = [];
  const ids = new Set<string>();
  value.forEach((d, i) => {
    const r = serviceDateSchema.safeParse(d);
    if (!r.success) problems.push(`date ${i + 1}: ${r.error.issues[0]?.path.join(".") || "it"} ${r.error.issues[0]?.message ?? "isn't right"} (a date is YYYY-MM-DD)`);
    else if (ids.has(r.data.id)) problems.push(`date '${r.data.id}' is listed twice`);
    else ids.add(r.data.id);
  });
  return problems;
}

// ---- days --------------------------------------------------------------------------------------
export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const dayOf = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
};
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** The day an entry falls on in a year (a 29 February birthday is the 28th in other years). */
function inYear(iso: string, year: number): Date {
  const d = dayOf(iso);
  if (d.getMonth() === 1 && d.getDate() === 29 && !isLeap(year)) return new Date(year, 1, 28);
  return new Date(year, d.getMonth(), d.getDate());
}

export type Occurrence = { id: string; date: string; time: string | null; title: string; kind: ScheduleKind | "service"; done: boolean; person: string | null; /** For a service's date: its catalogue entry and service title. */ service?: { entry: string; title: string }; years?: number };

/** Every time each entry falls between two days (inclusive), with repeats; and the services' dates. */
export function occurrences(items: readonly ScheduleItem[], from: string, to: string, services: readonly { entry: string; title: string; dates: readonly ServiceDate[] }[] = []): Occurrence[] {
  const start = dayOf(from);
  const end = dayOf(to);
  const out: Occurrence[] = [];
  for (const it of items) {
    if (!it.date) continue;
    const first = dayOf(it.date);
    const push = (d: Date) => {
      if (d < start || d > end || d < first) return;
      const years = it.kind === "birthday" || it.kind === "anniversary" ? d.getFullYear() - first.getFullYear() : undefined;
      out.push({ id: it.id, date: isoDay(d), time: it.time, title: it.title, kind: it.kind, done: it.done, person: it.person, ...(years ? { years } : {}) });
    };
    if (it.repeat === "none") push(first);
    else if (it.repeat === "yearly") for (let y = start.getFullYear(); y <= end.getFullYear(); y++) push(inYear(it.date, y));
    else if (it.repeat === "monthly") {
      for (let d = new Date(start.getFullYear(), start.getMonth(), 1); d <= end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
        const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        push(new Date(d.getFullYear(), d.getMonth(), Math.min(first.getDate(), last)));
      }
    } else {
      // weekly: the same weekday from the first day on
      const offset = (((first.getDay() - start.getDay()) % 7) + 7) % 7;
      for (let d = addDays(start, offset); d <= end; d = addDays(d, 7)) push(d);
    }
  }
  for (const s of services)
    for (const d of s.dates) {
      if (d.date < from || d.date > to) continue;
      out.push({ id: `${s.entry}:${d.id}`, date: d.date, time: d.time ?? null, title: d.title, kind: "service", done: false, person: null, service: { entry: s.entry, title: s.title } });
    }
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? "") || a.title.localeCompare(b.title));
}

/** What's coming: the next `days` days from today, and the to-dos not done (dated before today, or none). */
export function upcoming(items: readonly ScheduleItem[], today: string, days: number, services: Parameters<typeof occurrences>[3] = []) {
  const to = isoDay(addDays(dayOf(today), days - 1));
  return {
    dated: occurrences(items, today, to, services),
    overdue: items.filter((i) => i.kind === "todo" && !i.done && i.date !== null && i.date < today && i.repeat === "none"),
    undated: items.filter((i) => i.kind === "todo" && !i.done && i.date === null),
  };
}

// ---- the Scheduler agent: from a sentence to an entry -------------------------------------------
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const monthOf = (w: string) => MONTHS.findIndex((m) => m.startsWith(w.toLowerCase().slice(0, 3)) && w.length >= 3);

/** The next time a day of a month comes (this year, or next year if it has passed). */
function nextDayOfMonth(month: number, day: number, today: Date, year?: number): Date {
  if (year) return new Date(year, month, day);
  const d = new Date(today.getFullYear(), month, day);
  return d < today ? new Date(today.getFullYear() + 1, month, day) : d;
}

/**
 * Read a plain sentence into an entry, on the device (no model): "Mum's birthday on 3 March",
 * "Our anniversary is June 12", "remind me to renew the passport next Friday at 10am", "dentist on
 * 2026-12-05 at 4:30pm". What it can't tell stays null, for the person to fill in.
 */
export function parseScheduleText(text: string, today: Date = new Date()): ScheduleDraft {
  let rest = ` ${text.trim()} `;
  const lower = rest.toLowerCase();
  const kind: ScheduleKind = /\bbirthday\b|\bb'?day\b/.test(lower) ? "birthday" : /\banniversary\b/.test(lower) ? "anniversary" : /\b(remind me to|to-?do|todo|task|need to|have to|buy|call|pay|renew|book)\b/.test(lower) ? "todo" : "event";
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let date: Date | null = null;
  /** Use a match: its words leave the rest (which becomes the title). */
  const use = (m: RegExpMatchArray) => (rest = rest.replace(m[0], " "));
  const take = (re: RegExp) => {
    const m = rest.match(re);
    if (m) use(m);
    return m;
  };
  let m: RegExpMatchArray | null;
  if ((m = rest.match(/\b(\d{4})-(\d{2})-(\d{2})\b/))) {
    date = new Date(+m[1]!, +m[2]! - 1, +m[3]!);
    use(m);
  }
  // "3 March", "the 3rd of March 2027"
  if (!date && (m = rest.match(/\b(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]{3,9})\.?(?:\s+(\d{4}))?\b/i)) && monthOf(m[2]!) >= 0) {
    date = nextDayOfMonth(monthOf(m[2]!), +m[1]!, t0, m[3] ? +m[3] : undefined);
    use(m);
  }
  // "March 3", "June 12, 2027"
  if (!date && (m = rest.match(/\b(?:on\s+)?([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/i)) && monthOf(m[1]!) >= 0) {
    date = nextDayOfMonth(monthOf(m[1]!), +m[2]!, t0, m[3] ? +m[3] : undefined);
    use(m);
  }
  // "3/3", "03/12/2026" (day first)
  if (!date && (m = rest.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
    date = nextDayOfMonth(+m[2]! - 1, +m[1]!, t0, m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : undefined);
    use(m);
  }
  if (!date && take(/\btoday\b/i)) date = t0;
  if (!date && take(/\btomorrow\b/i)) date = addDays(t0, 1);
  if (!date && (m = take(/\bin\s+(\d{1,3})\s+(day|week|month)s?\b/i))) {
    const n = +m[1]!;
    const unit = m[2]!.toLowerCase();
    date = unit === "day" ? addDays(t0, n) : unit === "week" ? addDays(t0, 7 * n) : new Date(t0.getFullYear(), t0.getMonth() + n, t0.getDate());
  }
  if (!date && (m = take(/\b(?:on\s+|next\s+|this\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i))) {
    const want = WEEKDAYS.indexOf(m[1]!.toLowerCase());
    let n = (want - t0.getDay() + 7) % 7;
    if (n === 0) n = 7;
    date = addDays(t0, n);
  }
  let time: string | null = null;
  if ((m = take(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i)) || (m = take(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i)) || (m = take(/\b(\d{1,2})\s*(am|pm)\b/i))) {
    let h = +m[1]!;
    const min = m[2] && /^\d+$/.test(m[2]) ? +m[2] : 0;
    const ap = (m[3] ?? (m[2] && !/^\d+$/.test(m[2]) ? m[2] : "")).toLowerCase();
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    if (h < 24 && min < 60) time = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  }
  // Whose birthday or anniversary: "Mum's birthday", "birthday of Ravi", "Asha and Ravi's anniversary".
  let person: string | null = null;
  if (kind === "birthday" || kind === "anniversary") {
    const word = kind === "birthday" ? "birthday" : "anniversary";
    m = rest.match(new RegExp(`([A-Z][\\w'’-]*(?:\\s+(?:and|&)\\s+[A-Z][\\w'’-]*)?|[Mm]um|[Dd]ad|[Mm]om|[Gg]randma|[Gg]randpa|[Ss]ister|[Bb]rother)(?:'s|’s|s')\\s+${word}`)) ?? rest.match(new RegExp(`${word}\\s+of\\s+([A-Z][\\w'’-]*(?:\\s+[A-Z][\\w'’-]*)?)`, "i"));
    if (m) person = m[1]!.replace(/\b([a-z])/, (c) => c.toUpperCase());
    else if (/\bour\s+anniversary\b/i.test(rest)) person = "Us";
  }
  // The title: what is left, without the filler.
  const title = rest
    .replace(/\b(remind me to|please|add|put|in my (calendar|to-?dos?)|to my (calendar|to-?dos?)|is on|is|on|at|every year|yearly|annually|my|our)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,.\-–\s]+|[,.\-–\s]+$/g, "");
  const named = kind === "birthday" ? (person ? `${person}'s birthday` : "Birthday") : kind === "anniversary" ? (person && person !== "Us" ? `${person}'s anniversary` : "Our anniversary") : title ? title.replace(/^./, (c) => c.toUpperCase()) : "";
  return {
    kind,
    title: named.slice(0, 120),
    date: date ? isoDay(date) : null,
    time,
    repeat: kind === "birthday" || kind === "anniversary" || /\b(every year|yearly|annually)\b/i.test(lower) ? "yearly" : /\bevery week|weekly\b/i.test(lower) ? "weekly" : /\bevery month|monthly\b/i.test(lower) ? "monthly" : "none",
    person: kind === "birthday" || kind === "anniversary" ? person : null,
  };
}

/** The Scheduler as a form, for the AI model to fill from what someone said (`/api/agent/extract`). */
export const SCHEDULE_FORM = { journey: "kiosk-schedule", step: "entry" } as const;
export function scheduleFields(): Field[] {
  return [
    {
      id: "kind",
      type: "select",
      label: "What it is",
      description: "todo for a task, birthday, anniversary, or event for anything else on a day",
      options: SCHEDULE_KINDS.map((k) => ({ value: k, label: k })),
    },
    { id: "title", type: "text", label: "Title", description: "A short title, e.g. Renew the passport, Dentist" },
    { id: "person", type: "text", label: "Whose", description: "Whose birthday or anniversary (a name or Mum, Dad…); empty otherwise" },
    { id: "date", type: "date", label: "Day", description: "The day it falls on, as YYYY-MM-DD, worked out from today" },
    { id: "time", type: "text", label: "Time", description: "The time as HH:MM in 24 hours, if said" },
    { id: "repeat", type: "select", label: "Repeats", description: "yearly for birthdays and anniversaries; otherwise only if said", options: REPEATS.map((r) => ({ value: r, label: r })) },
  ];
}

/** The model's fills over the device's own reading: what the model found wins, the rest stays. */
export function draftFromFills(base: ScheduleDraft, fills: readonly { field: string; value: unknown }[]): ScheduleDraft {
  const v = (id: string) => fills.find((f) => f.field === id)?.value;
  const str = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : null);
  const kind = SCHEDULE_KINDS.includes(v("kind") as ScheduleKind) ? (v("kind") as ScheduleKind) : base.kind;
  const date = str(v("date")) && DAY.test(str(v("date"))!) ? str(v("date")) : base.date;
  const time = str(v("time")) && TIME.test(str(v("time"))!) ? str(v("time")) : base.time;
  const repeat = REPEATS.includes(v("repeat") as Repeat) ? (v("repeat") as Repeat) : base.repeat;
  return { kind, title: (str(v("title")) ?? base.title).slice(0, 120), date, time, repeat, person: str(v("person")) ?? base.person };
}
