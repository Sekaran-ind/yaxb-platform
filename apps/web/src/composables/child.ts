// The child safety lock (CHL-1..8). A parent turns it on with a PIN (kept only as a hash), or a
// profile says its owner is under 18: either way the kiosk is in child mode.
// - The assistant answers for a child, and the server allows no web search and no MCP tools.
// - Kiosk only's web answers are off.
// - The staff sections, the Service Catalogue and the AI designer are hidden.
// - Preferences keep only language, layout, theme and voice.
// - Commands can't change the knowledge settings.
// Only the PIN turns the device lock off; an Under 18 profile stays in child mode while it is open.
import type { Membership } from "@sekaran-ind/yaxb-core/identity";
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
  // The device's lock holds whatever space is open (a business space must not switch it off, SPC-9);
  // an Under 18 profile counts where profiles are offered (SUR-3: not in a business).
  const on = computed(() => settings.child.on || (offers("child-lock") && minor.value));
  return { on, minor, lock: childLock };
}

export async function enableChildLock(pin: string) {
  if (!CHILD_PIN.test(pin)) throw new Error("The PIN is 4 to 8 digits.");
  updateSettings({ child: { ...settings.child, on: true, pinHash: await sha256(pin) } });
}

// ---- the spaces a child may use (SPC-9) ----------------------------------------------------------
// A child sees only the family spaces a guardian chose here, never a business or community space,
// and can't start or join one. Like the rest of child mode, this is the device's (the account on it
// is the guardian's).
export const spaceKey = (m: Pick<Membership, "edition" | "tenant_id">) => `${m.edition}:${m.tenant_id}`;
/** The spaces a child may open, from the account's. */
export const childSpacesOf = (spaces: readonly Membership[]) => spaces.filter((m) => m.kind === "family" && settings.child.spaces.includes(spaceKey(m)));
/** A guardian chooses them while the lock is off (the lock's PIN guards them while it is on). */
export function setChildSpaces(keys: string[]) {
  if (settings.child.on) throw new Error("Turn the child safety lock off first.");
  updateSettings({ child: { ...settings.child, spaces: [...new Set(keys)].slice(0, 20) } });
}

/** Turn the device lock off with the PIN; false when the PIN isn't right. */
export async function disableChildLock(pin: string): Promise<boolean> {
  if (!settings.child.pinHash || (await sha256(pin)) !== settings.child.pinHash) return false;
  updateSettings({ child: { ...settings.child, on: false, pinHash: null } });
  return true;
}
