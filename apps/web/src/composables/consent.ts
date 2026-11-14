// Consent on this device (CON-6..8): which consent form versions this person agreed to, per service
// and role, kept in localStorage for the open profile (Visitor: the device; at the front desk only
// for the visit, in memory). Agreeing or declining is also a service event (facts only: the role
// and `consent-v<version>`, never who), when the service records events.
import { consentFormFor, parseDocument, serviceConsent, type ConsentForm, type ServiceConsent } from "@sekaran-ind/yaxb-journeys";
import { ref, watch } from "vue";
import { sessionEnds } from "@/composables/restricted";
import { useAccount } from "@/composables/account";
import { loadedServices } from "@/composables/library";
import { recordEvent } from "@/composables/service-events";
import { settings } from "@/composables/settings";

const KEY = "yaxb.consent";
type Kept = Record<string, Record<string, { version: number; at: string }>>;
const read = (): Kept => {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? "{}") as Kept) ?? {};
  } catch {
    return {};
  }
};
/** At the front desk nothing is kept beyond the visit (RST-4). */
const visit = ref<Kept>({});
const kept = ref<Kept>(read());

/** The consent block of a loaded catalogue service (by entry id), or null. */
export function consentOfEntry(entryId: string | null | undefined): { service: string; title: string; consent: ServiceConsent } | null {
  if (!entryId) return null;
  const s = loadedServices.value.find((x) => x.meta.entry_id === entryId);
  if (!s) return null;
  const p = parseDocument(s.meta.yaml);
  const consent = p.ok ? serviceConsent(p.doc.consent, null) : null;
  return consent ? { service: s.meta.id, title: s.meta.title, consent } : null;
}

export function useConsent() {
  const account = useAccount();
  const owner = () => (settings.restricted.on ? "visit" : (account.profileId.value ?? "device"));
  const store = () => (settings.restricted.on ? visit : kept);
  const key = (service: string, role: string) => `${service}@${role}`;

  /** The form this person must agree to before acting in `allowed` roles (null: none, or agreed). */
  function pending(entryId: string | null | undefined, roles: readonly string[], allowed?: readonly string[]): { service: string; title: string; version: number; form: ConsentForm } | null {
    const c = consentOfEntry(entryId);
    if (!c) return null;
    const form = consentFormFor(c.consent, roles, allowed);
    if (!form) return null;
    const had = store().value[owner()]?.[key(c.service, form.role)];
    return had && had.version >= c.consent.version ? null : { service: c.service, title: c.title, version: c.consent.version, form };
  }

  function answer(entryId: string, p: { service: string; version: number; form: ConsentForm }, agreed: boolean, journey: string, run: string, staff = false) {
    recordEvent(entryId, { journey, kind: agreed ? "consent.given" : "consent.declined", run, step: `consent-v${p.version}`, role: p.form.role, ok: agreed, staff });
    if (!agreed) return;
    const s = store();
    const mine = { ...(s.value[owner()] ?? {}), [key(p.service, p.form.role)]: { version: p.version, at: new Date().toISOString() } };
    s.value = { ...s.value, [owner()]: mine };
    if (!settings.restricted.on) {
      try {
        localStorage.setItem(KEY, JSON.stringify(kept.value));
      } catch {
        /* private window: agreed for this page only */
      }
    }
  }
  return { pending, answer };
}

// End session (or a quiet spell) at the front desk forgets the visit's agreements (RST-4).
watch(sessionEnds, () => (visit.value = {}));
