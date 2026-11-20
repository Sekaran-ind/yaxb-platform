// Routes: pages. Registered on the shared app when imported; the order of imports in index.ts is the order of registration.
import { app } from "../app";
import { type Context } from "hono";
import { settings, type Bindings } from "../env";
import { SURFACE_HEADS } from "@sekaran-ind/yaxb-core/context";
import { editionFor, type Edition } from "../edition";
import { accountContext } from "../identity";
import type { AppEnv } from "../app";

// The old CRA kiosk URL.
app.get("/yaxb", (c) => c.redirect("/kiosk", 301));

/** Security headers for every page and asset. The app has no inline scripts, so no nonce is needed. */
function securityHeaders(env: Bindings, url: URL): Record<string, string> {
  // Transformers.js downloads model weights from the Hugging Face Hub and its ONNX runtime from jsDelivr.
  const modelHosts = "https://huggingface.co https://*.huggingface.co https://*.hf.co https://cdn.jsdelivr.net";
  // yaxb-box addresses the browser may call (Storage: Local box).
  const box = (settings(env).KIOSK_BOX_ORIGINS ?? "")
    .split(/[\s,]+/)
    .filter((o) => /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(o))
    .join(" ");
  const local = url.hostname === "localhost" || url.hostname.endsWith(".localhost") || url.hostname === "127.0.0.1";
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline'",
    // Map tiles (VIS-1): OpenStreetMap's, or the provider TILE_ORIGIN names.
    `img-src 'self' data: blob: https://tile.openstreetmap.org${settings(env).TILE_ORIGIN ? ` ${settings(env).TILE_ORIGIN}` : ""}`,
    "font-src 'self'",
    `connect-src 'self' ${modelHosts}${box ? ` ${box}` : ""}`,
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    local ? "" : "upgrade-insecure-requests",
  ]
    .filter(Boolean)
    .join("; ");
  return {
    "Content-Security-Policy": csp,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    ...(local ? {} : { "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload" }),
    // The kiosk needs the microphone for voice input; nothing else.
    // The microphone for voice input; the camera and screen sharing for team calls (TEAM-20).
    "Permissions-Policy": "camera=(self), display-capture=(self), geolocation=(), payment=(), microphone=(self)",
    "Cross-Origin-Opener-Policy": "same-origin",
  };
}

/**
 * The one index.html serves every address (SUR-14): the address's edition, title and description
 * are written into it here, and the app reads `yaxb-edition` to choose its home page and brand.
 */
function pageFor(res: Response, edition: Edition, sections: string | null): Response {
  if (!(res.headers.get("content-type") ?? "").includes("text/html")) return res;
  const head = SURFACE_HEADS[edition];
  const metas = `<meta name="yaxb-edition" content="${edition}">${sections ? `<meta name="yaxb-sections" content="${sections}">` : ""}`;
  return new HTMLRewriter()
    .on("title", { element: (e) => void e.setInnerContent(head.title) })
    .on('meta[name="description"]', { element: (e) => void e.setAttribute("content", head.description) })
    .on("head", { element: (e) => void e.append(metas, { html: true }) })
    .transform(res);
}

/**
 * The sections a page shows (SPC-3, SPC-5): the kind of the space this device is kept for, else of
 * the account's open space, both checked here as on /api. Null: the app decides (the address's).
 */
async function sectionsFor(c: Context<AppEnv>): Promise<string | null> {
  await accountContext(c, async () => undefined);
  const lock = c.get("lock");
  if (lock) return lock.edition === "all" ? null : lock.edition;
  return c.get("space")?.kind ?? null;
}

app.get("*", async (c) => {
  const url = new URL(c.req.url);
  // Only pages (no file extension) need the space: assets skip the session check.
  const page = !/\.[a-z0-9]+$/i.test(url.pathname);
  const res = pageFor(await c.env.ASSETS.fetch(c.req.raw), editionFor({ host: url.hostname, fallback: settings(c.env).SURFACE }), page ? await sectionsFor(c).catch(() => null) : null);
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(securityHeaders(c.env, url))) out.headers.set(k, v);
  return out;
});
