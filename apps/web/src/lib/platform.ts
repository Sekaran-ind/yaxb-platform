// Where the app is running: the web kiosk (served by the Worker) or the native app (Capacitor),
// which is built with `vite build --mode native` and talks to the kiosk server at VITE_API_BASE.

/** Built for the native app (PLT-10): the kiosk is the whole app, with no website around it. */
export const NATIVE = import.meta.env.VITE_NATIVE === "1";

/** The kiosk server for the native app ("" on the web: same origin). */
export const API_BASE = NATIVE ? String(import.meta.env.VITE_API_BASE ?? "").replace(/\/+$/, "") : "";
