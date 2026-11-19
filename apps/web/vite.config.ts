import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { SURFACE_HEADS } from "@sekaran-ind/yaxb-core/context";

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
    // The Worker's environment, whatever it's named (yaxb_web).
    applyToEnvironment: (env) => env.config.consumer === "server",
    resolveId: (id) => shims[id] ?? null,
  };
}

/**
 * The page head of the native app's build. On the web the Worker writes each address's title and
 * description into the one index.html (worker/index.ts, yaxb-core SURFACE_HEADS).
 */
function pageHead(mode: string): Plugin {
  const head = SURFACE_HEADS.native;
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return {
    name: "yaxb-page-head",
    apply: () => mode === "native",
    transformIndexHtml: (html) =>
      html.replace(/<title>[^<]*<\/title>/, `<title>${esc(head.title)}</title>`).replace(/(<meta name="description" content=")[^"]*(")/, `$1${esc(head.description)}$2`),
  };
}

// One build: the Vue app (static assets) and the Hono Worker (worker/index.ts), run together in
// workerd by the Cloudflare plugin in `vite dev`, exactly as they deploy. It serves every address
// (SUR-14): the address and the open space choose the edition at run time, so there are no
// per-edition builds. Locally, open http://family.localhost:3000 (business., community.) for an
// edition's address, and http://localhost:3000 for the portal.
//
// `--mode native` builds the Vue app alone for the Capacitor app (apps/native, PLT-10): the kiosk
// only, with API calls to VITE_API_BASE (set it in .env.native.local or the environment).
export default defineConfig(({ mode }) => ({
  plugins: [vue(), tailwindcss(), pageHead(mode), ...(mode === "native" ? [] : [workerNodeShims(), cloudflare()])],
  ...(mode === "native"
    ? {
        define: { "import.meta.env.VITE_NATIVE": JSON.stringify("1") },
        base: "./",
      }
    : {}),
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Transformers.js and pdf.js bring their own workers and WASM.
  optimizeDeps: { exclude: ["@huggingface/transformers", "pdfjs-dist"] },
  worker: { format: "es" },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1500,
    ...(mode === "native" ? { outDir: "dist/native", emptyOutDir: true } : {}),
  },
}));
