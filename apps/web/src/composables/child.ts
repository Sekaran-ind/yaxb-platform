// The child safety lock (CHL-1..8). A parent turns it on with a PIN (kept only as a hash), or a
// profile says its owner is under 18: either way the kiosk is in child mode.
// - The assistant answers for a child, and the server allows no web search and no MCP tools.
// - Kiosk only's web answers are off.
// - The staff sections, the Service Catalogue and the AI designer are hidden.
// - Preferences keep only language, layout, theme and voice.
// - Commands can't change the knowledge settings.
// Only the PIN turns the device lock off; an Under 18 profile stays in child mode while it is open.
import { computed } from "vue";
import { offers } from "@/lib/surface";
import { useAccount } from "./account";
import { settings, updateSettings } from "./settings";

export const CHILD_PIN = /^\d{4,8}$/;

async function sha256(text: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`yaxb-child:${text}`));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The device lock is on (a parent's PIN). */
export const childLock = computed(() => settings.child.on);

/** Child mode: the device lock, or an open profile whose owner is under 18. */
export function useChildMode() {
  const account = useAccount();
  const minor = computed(() => account.profile.value?.ageRange === "under-18");
  // Only on a surface that offers it (SUR-3): the business surface has no child lock or family profiles.
  const on = computed(() => offers("child-lock") && (settings.child.on || minor.value));
  return { on, minor, lock: childLock };
}

export async function enableChildLock(pin: string) {
  if (!CHILD_PIN.test(pin)) throw new Error("The PIN is 4 to 8 digits.");
  updateSettings({ child: { on: true, pinHash: await sha256(pin) } });
}

/** Turn the device lock off with the PIN; false when the PIN isn't right. */
export async function disableChildLock(pin: string): Promise<boolean> {
  if (!settings.child.pinHash || (await sha256(pin)) !== settings.child.pinHash) return false;
  updateSettings({ child: { on: false, pinHash: null } });
  return true;
}
