// The person's account and spaces (docs/specs/15-identity.md step 1, SPC-1..4): one instance per
// page. The session lives in HttpOnly cookies the Worker sets (never readable here); this keeps what
// the screen shows. Passkeys are made and used with SimpleWebAuthn's browser half (IDN-10).
//
// Switching space reloads the page, so nothing from one space stays on screen in another (SPC-4).
// On the combined site and the native app the open space's kind decides the sections (SPC-3): it is
// remembered for the next start in `yaxb.space.kind` (lib/surface.ts reads it).
import type { Membership } from "@sekaran-ind/yaxb-core/identity";
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { computed, ref, shallowRef } from "vue";
import { api } from "@/lib/api";
import { PLATFORM_URLS, rememberSpaceKind } from "@/lib/surface";

export type IdentityMethod = { id: string; kind: "passkey" | "oidc" | "recovery" | "phone" | "email" | "member_key"; display: string; created_at: string; last_used_at: string | null };
export type Me =
  | { signedIn: false }
  | { signedIn: true; level: number; account: { id: string; display_name: string | null; created_at: string }; methods: IdentityMethod[]; spaces: Membership[]; space: Membership | null; edition: string };
export type IdentityConfig = { enabled: boolean; passkeys: boolean; google: boolean; edition: string; notice: string };
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
    // Arrived from another edition's site to open a space here (`?space=<tenant>`).
    const asked = new URLSearchParams(location.search).get("space");
    if (asked && me.value.signedIn && me.value.spaces.some((s) => s.tenant_id === asked) && me.value.space?.tenant_id !== asked) {
      const r = await api<{ space: Membership | null }>("/api/identity/space", { tenant: asked });
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

export function useIdentity() {
  if (!started) {
    started = true;
    void load();
  }
  const signedIn = computed(() => me.value.signedIn);
  const passkeys = computed(() => Boolean(config.value?.passkeys) && browserSupportsWebAuthn());

  return {
    me,
    config,
    loading,
    signedIn,
    passkeys,
    reload: load,

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
    /**
     * Open a space (or none) and start the app again in it. A space of another edition opens on that
     * edition's site, where its data lives (the session cookie is shared across anjalai.cc).
     */
    async openSpace(tenant: string | null, edition?: string) {
      const here = me.value.signedIn ? me.value.edition : "all";
      if (tenant && edition && edition !== here && edition !== "all" && edition in PLATFORM_URLS) {
        location.href = `${PLATFORM_URLS[edition as keyof typeof PLATFORM_URLS]}kiosk?space=${encodeURIComponent(tenant)}`;
        return;
      }
      const r = await api<{ space: Membership | null }>("/api/identity/space", { tenant });
      rememberSpaceKind(r.space?.kind ?? null);
      location.reload();
    },
    /** Add the space this site is in now to the account (as its signed-in member, or the administrator). */
    async linkSpace() {
      const r = await api<{ space: Membership }>("/api/identity/spaces/link", {});
      rememberSpaceKind(r.space.kind);
      location.reload();
    },
    async leaveSpace(tenant: string) {
      await api(`/api/identity/spaces/${encodeURIComponent(tenant)}`, undefined, "DELETE");
      await load();
    },
  };
}
