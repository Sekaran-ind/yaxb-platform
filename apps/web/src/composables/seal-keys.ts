// Sealed steps on this device (core cases/sealed.ts): a step whose access doesn't let everyone read it
// travels sealed for the devices of the people who may. This lists this device's public key for the
// signed-in member, finds the readers' keys when a case is sent on, and opens what this device may read
// when a case arrives. Nothing is sealed (and nothing is fetched) for a case with no such step.
import { openCase, sealCase, type Case, type KeyDirectory } from "@sekaran-ind/yaxb-core/cases";
import type { PublicKey } from "@sekaran-ind/yaxb-core/seal";
import { kioskViewer } from "@/composables/library";
import { api } from "@/lib/api";
import { deviceKey } from "@/lib/browser/device-key";

/** This device's public key, for the directory and for a case it starts (so what a visitor gave can be sealed back to them). */
export async function devicePublicKey(): Promise<PublicKey> {
  const k = await deviceKey();
  return { id: k.id, jwk: k.jwk };
}

let listed = false;
/** List this device's key for the signed-in member (or the administrator), once per page. A visitor has none to list. */
export async function registerDeviceKey(): Promise<void> {
  if (listed || !(kioskViewer.value.member || kioskViewer.value.admin)) return;
  try {
    await api("/api/keys", await devicePublicKey(), "PUT");
    listed = true;
  } catch {
    // Offline or signed out: tried again at the next start.
  }
}

/** The directory on the server: public keys only, asked for when a step has to be sealed. */
const directory: KeyDirectory = {
  forRoles: async (roles) => (await api<{ keys: PublicKey[] }>(`/api/keys/directory?roles=${encodeURIComponent(roles.join(","))}`)).keys,
  admins: async () => (await api<{ admins: PublicKey[] }>("/api/keys/directory")).admins,
};

/** The case as it goes in an envelope: restricted steps sealed for their readers. Throws (and nothing is sent) if no device could read one. */
export const sealForSend = (c: Case): Promise<Case> => sealCase(c, { directory });

/** A case that arrived, with every sealed step this device's key can open in the clear. */
export async function openReceived(c: Case): Promise<Case> {
  return openCase(c, await deviceKey());
}
