// Routines in plain words for the catalogue (RTN-1): what sets one off.
import type { RoutineTrigger } from "@sekaran-ind/yaxb-core/routines";

const DAYS: Record<string, string> = { sun: "Sunday", mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday" };
const KINDS: Record<string, string> = {
  "journey.started": "someone starts",
  "journey.finished": "someone finishes",
  "journey.outcome": "it ends with",
  "journey.handed": "a request is handed on in",
  "request.closed": "a request is closed in",
  "request.declined": "a request is declined in",
};

/** "Every Monday at 09:00", "3 days before race-day of marathon, at 08:00", "When attendance ends with attendance.late". */
export function triggerText(on: RoutineTrigger): string {
  if ("schedule" in on) {
    const s = on.schedule;
    if (s.every === "hour") return `Every hour at :${String(s.minute ?? 0).padStart(2, "0")}`;
    const at = s.at ?? "09:00";
    if (s.every === "day") return `Every day at ${at}`;
    if (s.every === "week") return `Every ${DAYS[String(s.on)] ?? s.on} at ${at}`;
    return `On day ${s.on} of every month at ${at}`;
  }
  if ("date" in on) {
    const d = on.date;
    return `${d.before ? `${d.before} day${d.before === 1 ? "" : "s"} before` : "On"} ${d.date} of ${d.service}, at ${d.at}`;
  }
  const e = on.event;
  const what = KINDS[e.kind] ?? `${e.kind} in`;
  if (e.kind === "journey.outcome") return `When ${e.service}${e.journey ? ` (${e.journey})` : ""} ends with ${e.outcome ?? "any outcome"}`;
  return `When ${what} ${e.service}${e.journey ? ` (${e.journey})` : ""}`;
}
