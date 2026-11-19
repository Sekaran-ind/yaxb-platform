// The person's account and spaces (docs/specs/15-identity.md step 1, SPC-1..4): one instance per
// page. The session lives in HttpOnly cookies the Worker sets (never readable here); this keeps what
// the screen shows. Passkeys are made and used with SimpleWebAuthn's browser half (IDN-10).
//
// Switching space reloads the page, so nothing from one space stays on screen in another (SPC-4).
// One address serves every edition (SUR-14): a space of any kind opens where the person is, and its
// kind decides the sections (SPC-3), remembered for the next start in `yaxb.space.kind`
// (lib/surface.ts reads it).
import type { Membership } from "@sekaran-ind/yaxb-core/identity";
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { computed, ref, shallowRef } from "vue";
import { api } from "@/lib/api";
import { rememberSpaceKind } from "@/lib/surface";

export type IdentityMethod = { id: string; kind: "passkey" | "oidc" | "recovery" | "phone" | "email" | "member_key"; display: string; created_at: string; last_used_at: string | null };
export type Me =
  | { signedIn: false }
  | {
      signedIn: true;
      level: number;
      account: { id: string; display_name: string | null; created_at: string };
      methods: IdentityMethod[];
      spaces: Membership[];
      space: Membership | null;
      /** Join requests waiting for a space's administrator (SPC-8). */
      waiting?: { space_name: string; kind: string }[];
      edition: string;
      locked?: DeviceLocked | null;
    };
/** This device is kept for one space (SPC-5): no other space opens here. */
export type DeviceLocked = { space_name: string; label: string; edition: string; created_at: string };
export type KeptDevice = DeviceLocked & { id: string; tenant_id: string; locked_by: string | null; unlocked_at: string | null };
export type IdentityConfig = { enabled: boolean; passkeys: boolean; google: boolean; edition: string; locked?: DeviceLocked | null; notice: string };
export type SessionRow = { id: string; method: string; level: number; device: string | null; created_at: string; last_used_at: string };

const me = shallowRef<Me>({ signedIn: false });
const config = shallowRef<IdentityConfig | null>(null);
const loading = ref(false);
let started = false;
let timer: ReturnType<typeof setInterval> | null = null;

async function load() {
  loading.value = true;
  try {
    config.value ??= await api<IdentityConfig>("/api/identity/config");
    me.value = config.value.enabled ? await api<Me>("/api/identity/me") : { signedIn: false };
    rememberSpaceKind(me.value.signedIn ? (me.value.space?.kind ?? null) : null);
    // A link that opens a space (`?space=<tenant>`, or `?space=<edition>:<tenant>`).
    const asked = new URLSearchParams(location.search).get("space");
    const [askedEdition, askedTenant] = asked?.includes(":") ? asked.split(":", 2) : [undefined, asked];
    const target = asked && me.value.signedIn ? me.value.spaces.find((s) => s.tenant_id === askedTenant && (!askedEdition || s.edition === askedEdition)) : undefined;
    if (target && me.value.signedIn && !(me.value.space?.tenant_id === target.tenant_id && me.value.space.edition === target.edition)) {
      const r = await api<{ space: Membership | null }>("/api/identity/space", { tenant: target.tenant_id, edition: target.edition });
      rememberSpaceKind(r.space?.kind ?? null);
      const url = new URL(location.href);
      url.searchParams.delete("space");
      location.replace(url.href);
    }
  } catch {
    me.value = { signedIn: false };
  } finally {
    loading.value = false;
  }
  // The access token lasts 15 minutes: asking who is signed in renews it.
  if (me.value.signedIn && !timer) timer = setInterval(() => void load(), 10 * 60_000);
  if (!me.value.signedIn && timer) {
    clearInterval(timer);
    timer = null;
  }
}

type ConsentNeeded = { consent_required: true; notice: string };

// The app starts again when a space opens. A journey step that opened one (your-account) runs again
// when the conversation is reopened: this marker, kept a few minutes for this tab, tells it the space
// is already open, so it carries on instead of opening it again.
const OPENED = "yaxb.space.opened";
function markOpened() {
  try {
    sessionStorage.setItem(OPENED, String(Date.now()));
  } catch {
    /* private mode */
  }
}
/** A space was opened in this tab in the last few minutes (and the marker is used up). */
export function justOpened(): boolean {
  try {
    const at = Number(sessionStorage.getItem(OPENED) ?? 0);
    sessionStorage.removeItem(OPENED);
    return Date.now() - at < 5 * 60_000;
  } catch {
    return false;
  }
}
/**
 * Start the app again in the new space. `after`: a journey that opened it first reaches its ending
 * and the conversation keeps it, then the app restarts (the conversation is reopened, KioskShell).
 */
const restart = (after = 400) => setTimeout(() => location.reload(), after);
/** How long a journey gets to reach its ending before the app restarts. */
export const JOURNEY_RESTART_MS = 2500;

export function useIdentity() {
  if (!started) {
    started = true;
    void load();
  }
  const signedIn = computed(() => me.value.signedIn);
  const passkeys = computed(() => Boolean(config.value?.passkeys) && browserSupportsWebAuthn());
  /** The space this device is kept for (SPC-5), or null. */
  const locked = computed(() => (me.value.signedIn ? me.value.locked : null) ?? config.value?.locked ?? null);

  return {
    me,
    config,
    loading,
    signedIn,
    passkeys,
    locked,
    reload: load,

    // ---- a device kept for one space (SPC-5): its administrator only ----
    /** Keep this device for the space it is in now; the app starts again in it. */
    async lockDevice(label?: string) {
      await api("/api/identity/device-lock", { label });
      config.value = null;
      restart();
    },
    /** Release this device; the app starts again. */
    async releaseDevice() {
      await api("/api/identity/device-lock", undefined, "DELETE");
      config.value = null;
      restart();
    },
    /** The space's kept devices. */
    keptDevices: () => api<{ devices: KeptDevice[]; here: string | null }>("/api/identity/device-locks"),
    releaseKept: (id: string) => api(`/api/identity/device-locks/${encodeURIComponent(id)}`, undefined, "DELETE"),

    /** Sign in with a passkey this device (or a nearby phone) holds. */
    async passkeySignIn() {
      const start = await api<{ challenge: string; options: Parameters<typeof startAuthentication>[0]["optionsJSON"] }>("/api/identity/passkey/signin/start", {});
      const response = await startAuthentication({ optionsJSON: start.options });
      await api("/api/identity/passkey/signin/finish", { challenge: start.challenge, response });
      await load();
    },

    /** Make an account with a new passkey (or, signed in, add one). `consent`: the notice was accepted. */
    async passkeyCreate(input: { name?: string; consent?: boolean; label?: string } = {}): Promise<ConsentNeeded | null> {
      const start = await api<{ challenge: string; options: Parameters<typeof startRegistration>[0]["optionsJSON"] }>("/api/identity/passkey/register/start", { name: input.name });
      const response = await startRegistration({ optionsJSON: start.options });
      const r = await api<ConsentNeeded | object>("/api/identity/passkey/register/finish", { challenge: start.challenge, response, consent: input.consent, name: input.name, label: input.label });
      if ("consent_required" in r) return r;
      await load();
      return null;
    },

    /** Go to Google; it comes back to this page. Pressing the button under the notice is the consent. */
    google(returnTo = location.pathname + location.search) {
      location.href = `/api/identity/google/start?consent=1&return=${encodeURIComponent(returnTo)}`;
    },

    async recovery(code: string) {
      await api("/api/identity/recovery", { code });
      await load();
    },
    newRecoveryCodes: () => api<{ codes: string[] }>("/api/identity/recovery-codes", {}).then((r) => r.codes),

    sessions: () => api<{ current: string; sessions: SessionRow[] }>("/api/identity/sessions"),
    endSession: (id: string) => api(`/api/identity/sessions/${id}`, undefined, "DELETE"),
    async removeMethod(id: string) {
      await api(`/api/identity/methods/${id}`, undefined, "DELETE");
      await load();
    },
    async rename(name: string) {
      await api("/api/identity/account", { name }, "PATCH");
      await load();
    },
    async signOut(everywhere = false) {
      await api("/api/identity/signout", { everywhere });
      rememberSpaceKind(null);
      await load();
    },
    async deleteAccount() {
      await api("/api/identity/account", undefined, "DELETE");
      rememberSpaceKind(null);
      await load();
    },

    // ---- spaces (SPC-2..4) ----
    /** Open a space (or none), of any edition, and start the app again in it on this address (SUR-14). */
    async openSpace(tenant: string | null, edition?: string, { after }: { after?: number } = {}) {
      const r = await api<{ space: Membership | null }>("/api/identity/space", { tenant, ...(tenant && edition ? { edition } : {}) });
      rememberSpaceKind(r.space?.kind ?? null);
      markOpened();
      restart(after);
      return r.space;
    },
    /** Start a family, business or community (SPC-8): you are its administrator, and it opens. */
    async startSpace(kind: string, name: string, { after }: { after?: number } = {}) {
      const r = await api<{ space: Membership }>("/api/identity/spaces/start", { kind, name });
      rememberSpaceKind(r.space.kind);
      markOpened();
      restart(after);
      return r.space;
    },
    /** Join with a code or link: it opens at once, or waits for the space's administrator. */
    async joinSpace(code: string, { after }: { after?: number } = {}) {
      const r = await api<{ space: Membership | null; pending: boolean; space_name?: string }>("/api/identity/spaces/join", { code });
      if (r.space) {
        rememberSpaceKind(r.space.kind);
        markOpened();
        restart(after);
      } else await load();
      return r;
    },
    /** Add the space this site is in now to the account (as its signed-in member, or the administrator). */
    async linkSpace() {
      const r = await api<{ space: Membership }>("/api/identity/spaces/link", {});
      rememberSpaceKind(r.space.kind);
      markOpened();
      restart();
    },
    async leaveSpace(tenant: string, edition?: string) {
      await api(`/api/identity/spaces/${encodeURIComponent(edition ? `${edition}:${tenant}` : tenant)}`, undefined, "DELETE");
      await load();
    },
  };
}
