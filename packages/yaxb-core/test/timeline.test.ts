// Timeline items (VIS-4) as schema.org Events from the Scheduler, a request's thread and the notebook.
import { describe, expect, it } from "vitest";
import { caseTimeline, occurrenceEvents, sourceEvents } from "../src/timeline/index.js";

describe("timeline items as schema.org Events (VIS-4)", () => {
  it("builds them from occurrences, a thread and dated sources, facts only", () => {
    expect(occurrenceEvents([{ id: "a", date: "2026-11-23", time: "09:30", title: "Parents' meeting", kind: "event", done: false, person: null }, { id: "b", date: "2026-12-01", time: null, title: "Birthday", kind: "birthday", done: false, person: "Amma" }])).toEqual([
      { "@type": "Event", id: "a@2026-11-23", name: "Parents' meeting", startDate: "2026-11-23T09:30", lane: "Events" },
      { "@type": "Event", id: "b@2026-12-01", name: "Birthday · Amma", startDate: "2026-12-01", lane: "Birthdays" },
    ]);
    const t = caseTimeline([{ id: "e1", at: "2026-11-20T05:00:00Z", kind: "note", actor_name: "Lata", text: "secret" } as never]);
    expect(t).toEqual([{ "@type": "Event", id: "e1", name: "A note · Lata", startDate: "2026-11-20T05:00:00Z", lane: "Notes" }]);
    expect(JSON.stringify(t)).not.toContain("secret");
    expect(sourceEvents([{ id: "s1", title: "Price list", fetchedAt: "2026-11-01T00:00:00Z" }, { id: "s2", title: "Undated" }])).toHaveLength(1);
  });
});
