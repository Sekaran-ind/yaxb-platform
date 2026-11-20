// Attendance (ATT-1..6) on the kiosk: the business's roster, kept on this device and as service data on
// its box (sync v2, `attendance-roster`), so every front desk checks PINs offline; managers keep it
// under For staff → Attendance. A check-in is the Attendance service's event (its outcome: in, late
// or out; its actor: the employee's roster id, never a name).
import { emptyRoster, type Roster } from "@sekaran-ind/yaxb-core/attendance";
import { shallowRef } from "vue";
import { trackWrite } from "@/lib/browser/sync-hook";

export const ATTENDANCE_ID = "attendance-roster";
const KEY = "yaxb.attendance.roster";
function read(): Roster {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Roster | null;
    return v && v.version === 1 ? v : emptyRoster();
  } catch {
    return emptyRoster();
  }
}
export const roster = shallowRef<Roster>(read());
export function saveRoster(r: Roster) {
  const next = { ...r, updated_at: new Date().toISOString() };
  roster.value = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode: this visit only */
  }
  trackWrite("service-data", ATTENDANCE_ID, next);
}
/** A newer roster from the box (sync). */
export function applyRoster(data: unknown | null) {
  if (!data || typeof data !== "object" || (data as Roster).version !== 1) return;
  const r = data as Roster;
  if (r.updated_at <= roster.value.updated_at) return;
  roster.value = r;
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    /* ignore */
  }
}
