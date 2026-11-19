// The native app's own sign-in (IDN-43). It opens the site in the system browser (never an embedded
// web view); the person signs in there and approves; the app polls for its own tokens, keeps them on
// the device, sends the access token as a bearer token and renews it with the refresh token. The open
// space goes in X-Yaxb-Space, since the app has no cookies.
// Kept in the app's private storage, like its session id: the Keychain/Keystore waits for a secure
// storage plugin.
import { API_BASE, NATIVE } from "./platform";

type Tokens = { access: string; refresh: string; access_expires_at: string; expires_at: string };
const TOKENS = "yaxb.native.tokens";
const SPACE = "yaxb.native.space";

const read = <T>(key: string): T | null => {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
};
const write = (key: string, v: unknown) => {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable: signed in for this run only */
  }
};

export const nativeTokens = () => read<Tokens>(TOKENS);
export const setNativeTokens = (t: Tokens | null) => write(TOKENS, t);
/** The app's open space, `<edition>:<tenant>`. */
export const nativeSpace = () => read<string>(SPACE);
export const setNativeSpace = (s: string | null) => write(SPACE, s);

let renewing: Promise<string | null> | null = null;
/** The access token, renewed first when it has under a minute left; null when signed out. */
export async function nativeAccess(fetchImpl: typeof fetch): Promise<string | null> {
  const t = nativeTokens();
  if (!t) return null;
  if (new Date(t.access_expires_at).getTime() - Date.now() > 60_000) return t.access;
  renewing ??= (async () => {
    try {
      const res = await fetchImpl(`${API_BASE}/api/identity/app/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh: t.refresh }), credentials: "omit", mode: "cors" });
      if (!res.ok) {
        // Refused (signed out elsewhere, or the session ended): sign this app out.
        if (res.status === 401) setNativeTokens(null);
        return null;
      }
      const { tokens } = (await res.json()) as { tokens: Tokens };
      setNativeTokens(tokens);
      return tokens.access;
    } catch {
      return t.access; // offline: try the old one
    } finally {
      renewing = null;
    }
  })();
  return renewing;
}

/**
 * Sign the app in: ask for a code, open the approval page in the system browser, and wait for the
 * person to sign in and approve there. Resolves when the app has its tokens.
 */
export async function nativeSignIn(): Promise<void> {
  if (!NATIVE) throw new Error("Only the app signs in this way.");
  const start = await fetch("/api/identity/app/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Anjal on this phone" }) });
  const s = (await start.json()) as { device_code: string; verification_uri_complete: string; expires_in: number; interval: number; error?: string };
  if (!start.ok) throw new Error(s.error ?? "Signing in isn't available right now.");
  const { Browser } = await import("@capacitor/browser");
  const { App } = await import("@capacitor/app");
  await Browser.open({ url: s.verification_uri_complete });
  const until = Date.now() + s.expires_in * 1000;
  let wake: (() => void) | null = null;
  // The approval page hands back to the app by its link (ai.yaxb.kiosk://signed-in): check at once.
  const back = await App.addListener("appUrlOpen", (e) => {
    if (e.url.startsWith("ai.yaxb.kiosk://")) wake?.();
  });
  try {
    while (Date.now() < until) {
      await new Promise<void>((r) => {
        wake = r;
        setTimeout(r, s.interval * 1000);
      });
      const res = await fetch("/api/identity/app/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ device_code: s.device_code }) });
      const out = (await res.json().catch(() => ({}))) as { status?: string; tokens?: Tokens; error?: string };
      if (out.status === "approved" && out.tokens) {
        setNativeTokens(out.tokens);
        return;
      }
      if (out.status === "denied") throw new Error("The sign-in was turned down.");
      if (out.status === "expired") break;
    }
    throw new Error("The sign-in took too long. Try again.");
  } finally {
    await back.remove();
    await Browser.close().catch(() => undefined);
  }
}

/** Sign the app out: its session ends on the site, and its tokens and open space go. */
export async function nativeSignOut() {
  await fetch("/api/identity/app/signout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => undefined);
  setNativeTokens(null);
  setNativeSpace(null);
}
