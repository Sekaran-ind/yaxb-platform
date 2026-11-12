// Where the app is running: the web kiosk (served by the Worker) or the native app (Capacitor,
// PLT-10..14), which is built with `vite build --mode native` and talks to the kiosk server at
// VITE_API_BASE.
//
// The native app's pages come from the device (capacitor://localhost, https://localhost), so its
// API calls are cross-origin. Instead of cookies (third-party cookies are blocked in app web views),
// the app keeps its own session id and sends it as X-Yaxb-Session; the server accepts that only
// from the app origins it allows (KIOSK_APP_ORIGINS), with the same rate limits and validation.

/** Built for the native app: the kiosk is the whole app, with no website around it. */
export const NATIVE = import.meta.env.VITE_NATIVE === "1";

/** The kiosk server for the native app ("" on the web: same origin). */
export const API_BASE = NATIVE ? String(import.meta.env.VITE_API_BASE ?? "").replace(/\/+$/, "") : "";

export const SESSION_HEADER = "X-Yaxb-Session";
const SESSION_KEY = "yaxb.native.session";

/** This device's session id for the native app (a random UUID, kept on the device). */
export function nativeSessionId(): string {
  try {
    const saved = localStorage.getItem(SESSION_KEY);
    if (saved && /^[0-9a-f-]{36}$/.test(saved)) return saved;
    const id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return (memorySession ??= crypto.randomUUID());
  }
}
let memorySession: string | undefined;

/**
 * In the native app, send every /api call to the kiosk server with the session header. Done once,
 * before the app starts, so components keep calling fetch("/api/...") as on the web.
 */
export function installNativeFetch() {
  if (!NATIVE) return;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith("/api/")) return original(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set(SESSION_HEADER, nativeSessionId());
    const base = input instanceof Request ? new Request(API_BASE + url, input) : API_BASE + url;
    return original(base, { ...init, headers, credentials: "omit", mode: "cors" });
  };
}

/** Running inside the Capacitor shell on a device (not the native build opened in a browser). */
export async function onDevice(): Promise<boolean> {
  if (!NATIVE) return false;
  const { Capacitor } = await import("@capacitor/core");
  return Capacitor.isNativePlatform();
}
