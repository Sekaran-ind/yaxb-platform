// Timeline items (VIS-4) as schema.org Events: `name`, `startDate`, and a `lane` for the kind of
// thing. Built from the Scheduler's occurrences, a request's thread and dated notebook sources, for
// yaxb-journeys/vue's EventTimeline. Facts only: titles and when, never answers or notes' text.
import type { Occurrence } from "../schedule/index.js";

export type TimelineEvent = { "@type": "Event"; id: string; name: string; startDate: string; lane?: string; description?: string };

const LANES: Record<string, string> = { todo: "To-dos", birthday: "Birthdays", anniversary: "Anniversaries", event: "Events", service: "Service dates" };

/** The Scheduler's occurrences, a lane per kind; a time of day when there is one. */
export const occurrenceEvents = (list: readonly Occurrence[]): TimelineEvent[] =>
  list.map((o) => ({
    "@type": "Event",
    id: `${o.id}@${o.date}`,
    name: o.service ? `${o.title} (${o.service.title})` : o.person ? `${o.title} · ${o.person}` : o.title,
    startDate: o.time ? `${o.date}T${o.time}` : o.date,
    lane: LANES[o.kind] ?? "Events",
  }));

const CASE_STEPS: Record<string, string> = { started: "Started", answered: "Answered", note: "A note", finished: "Done", declined: "Declined", reassigned: "Reassigned", dependency: "Another service" };
/** A request's thread: who did what, when (a note says only that there was one). */
export const caseTimeline = (events: readonly { id: string; at: string; kind: string; actor_name: string }[]): TimelineEvent[] =>
  events.map((e) => ({ "@type": "Event", id: e.id, name: `${CASE_STEPS[e.kind] ?? e.kind} · ${e.actor_name}`, startDate: e.at, lane: e.kind === "note" ? "Notes" : "Steps" }));

/** Notebook sources with a date (a fetched page, a document): when each was added or read. */
export const sourceEvents = (sources: readonly { id: string; title: string; fetchedAt?: string; addedAt?: string }[]): TimelineEvent[] =>
  sources.flatMap((s) => {
    const at = s.fetchedAt ?? s.addedAt;
    return at ? [{ "@type": "Event" as const, id: s.id, name: s.title, startDate: at, lane: "Notebook" }] : [];
  });
