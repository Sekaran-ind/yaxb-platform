// Restricted Mode (RST-1..6): the kiosk as a public front desk. Staff prepare it (design or load the
// services, add their documents and SOPs, assign people), then turn it on with a PIN. Visitors get
// Ask Me alone, with the chosen services and their documents; each visit is a session in memory,
// wiped on End session or after a short idle time; nothing about a visitor stays on the kiosk (what
// they hand over goes to the service as a request with a reference). Profiles, the catalogue,
// preferences, Quick tools and the notebook are hidden. Only staff leave it: the PIN, or their key.
import { computed, ref } from "vue";
import { settings, updateSettings } from "./settings";

export const restricted = computed(() => settings.restricted.on);
export const restrictedServices = computed(() => (settings.restricted.on ? settings.restricted.services : []));

async function sha256(text: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`yaxb-restricted:${text}`));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const PIN = /^\d{4,8}$/;

export type RestrictedOptions = { services: string[]; idleMinutes: number; mic: boolean; attach: boolean };

/** Turn it on (staff only: the caller checks). The PIN is kept only as a hash. */
export async function enableRestricted(opts: RestrictedOptions, pin: string) {
  if (!PIN.test(pin)) throw new Error("The PIN is 4 to 8 digits.");
  if (!opts.services.length) throw new Error("Choose at least one service for the front desk.");
  updateSettings({ restricted: { on: true, ...opts, idleMinutes: Math.min(Math.max(Math.round(opts.idleMinutes), 1), 30), pinHash: await sha256(pin) } });
  sessionEnds.value++;
}

/** Leave it with the PIN; false when the PIN isn't right. */
export async function unlockRestricted(pin: string): Promise<boolean> {
  if (!settings.restricted.pinHash || (await sha256(pin)) !== settings.restricted.pinHash) return false;
  updateSettings({ restricted: { ...settings.restricted, on: false } });
  return true;
}
/** Leave it because staff signed in with their own key. */
export function leaveRestricted() {
  updateSettings({ restricted: { ...settings.restricted, on: false } });
}

/** Bumped when a visitor's session ends (End session, idle, or the mode turned on): the shell wipes it. */
export const sessionEnds = ref(0);
export const endSession = () => sessionEnds.value++;

// Idle: the session ends when nobody has touched the kiosk for `idleMinutes`.
let idle: ReturnType<typeof setTimeout> | null = null;
let active = false;
function arm() {
  if (idle) clearTimeout(idle);
  if (!settings.restricted.on || !active) return;
  idle = setTimeout(() => {
    active = false;
    endSession();
  }, settings.restricted.idleMinutes * 60_000);
}
if (typeof window !== "undefined")
  for (const ev of ["pointerdown", "keydown"])
    window.addEventListener(
      ev,
      () => {
        active = true;
        arm();
      },
      { passive: true },
    );
