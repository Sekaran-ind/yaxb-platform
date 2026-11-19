import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite";

// One spelling of the drive on Windows. Git Bash starts in "c:\…" and PowerShell in "C:\…"; the
// bundler took the same file under both for two modules, so vue-router's injection keys existed
// twice and useRoute() was undefined in production builds made from Git Bash.
if (process.platform === "win32" && /^[a-z]:/.test(process.cwd())) process.chdir(process.cwd()[0]!.toUpperCase() + process.cwd().slice(1));

/**
 * The Worker's build only: CommonJS dependencies (deepagents → micromatch, picomatch) call
 * require("util") and require("path") when they load, which a deployed Worker can't do (the bundler
 * leaves a runtime require for a Node built-in). Bare "util" and "path" resolve to bundled shims that
 * re-export workerd's node:util and node:path (nodejs_compat) instead. Runs before the Cloudflare
 * plugin, which would otherwise mark them external.
 */
function workerNodeShims(): Plugin {
  const shims: Record<string, string> = {
    util: fileURLToPath(new URL("./worker/shims/util.js", import.meta.url)),
    path: fileURLToPath(new URL("./worker/shims/path.js", import.meta.url)),
  };
  return {
    name: "yaxb-worker-node-shims",
    enforce: "pre",
    // The Worker's environment, whatever it's named (yaxb_web, anjal_family, anjal_business).
    applyToEnvironment: (env) => env.config.consumer === "server",
    resolveId: (id) => shims[id] ?? null,
  };
}

/** Each build's page title and description (index.html is shared): the portal, a surface, the app. */
const HEADS: Record<string, { title: string; description: string }> = {
  all: { title: "Yaxb.ai", description: "Yaxb.ai: AI kiosks that answer with facts and sources, in your own language, for families and communities (Anjalai Family), small businesses (Anjalai for Business) and enterprises in regulated care (ClinüxFlow)." },
  family: { title: "Anjalai Family", description: "Anjalai Family: one shared notebook the whole family can ask in its own language, key dates that come up by themselves, and a protected space." },
  business: { title: "Anjalai for Business", description: "Anjalai for Business: connect with your customers, design your services with the AI designer, and get found on Anjalai." },
  community: { title: "Anjalai Community", description: "Anjalai Community: for apartment associations, clubs and committees. Residents raise complaints and book the hall, the committee answers, and notices reach everyone in their own language." },
  native: { title: "Anjalai", description: "Anjalai, the kiosk." },
};
function pageHead(mode: string): Plugin {
  const head = HEADS[mode] ?? HEADS.all!;
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return {
    name: "yaxb-page-head",
    transformIndexHtml: (html) =>
      html.replace(/<title>[^<]*<\/title>/, `<title>${esc(head.title)}</title>`).replace(/(<meta name="description" content=")[^"]*(")/, `$1${esc(head.description)}$2`),
  };
}

// One build: the Vue app (static assets) and the Hono Worker (worker/index.ts), run together in
// workerd by the Cloudflare plugin in `vite dev`, exactly as they deploy.
//
// `--mode native` builds the Vue app alone for the Capacitor app (apps/native, PLT-10): the kiosk
// only, with API calls to VITE_API_BASE (set it in .env.native.local or the environment).
//
// `--mode family`, `--mode business` and `--mode community` (SUR-1..6, EDN-3) build the app as that
// surface's own Worker: wrangler.<surface>.jsonc (anjal-family, anjal-business, anjal-community), into
// dist/<surface>, with VITE_SURFACE set so each shows only what is its own (what a
// surface offers is yaxb-core's context).
const SURFACES = ["family", "business", "community"] as const;
export default defineConfig(({ mode }) => {
  const surface = (SURFACES as readonly string[]).includes(mode) ? mode : null;
  return {
  plugins: [vue(), tailwindcss(), pageHead(mode), ...(mode === "native" ? [] : [workerNodeShims(), cloudflare(surface ? { configPath: `./wrangler.${surface}.jsonc` } : {})])],
  ...(mode === "native"
    ? {
        define: { "import.meta.env.VITE_NATIVE": JSON.stringify("1") },
        base: "./",
      }
    : surface
      ? { define: { "import.meta.env.VITE_SURFACE": JSON.stringify(surface) } }
      : {}),
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Transformers.js and pdf.js bring their own workers and WASM.
  optimizeDeps: { exclude: ["@huggingface/transformers", "pdfjs-dist"] },
  worker: { format: "es" },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1500,
    ...(mode === "native" ? { outDir: "dist/native", emptyOutDir: true } : surface ? { outDir: `dist/${surface}`, emptyOutDir: true } : {}) },
  };
});
