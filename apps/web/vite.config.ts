import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite";

/**
 * The Worker's build only: CommonJS dependencies (deepagents â†’ micromatch, picomatch) call
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
    applyToEnvironment: (env) => env.name === "yaxb_web",
    resolveId: (id) => shims[id] ?? null,
  };
}

// One build: the Vue app (static assets) and the Hono Worker (worker/index.ts), run together in
// workerd by the Cloudflare plugin in `vite dev`, exactly as they deploy.
//
// `--mode native` builds the Vue app alone for the Capacitor app (apps/native, PLT-10): the kiosk
// only, with API calls to VITE_API_BASE (set it in .env.native.local or the environment).
export default defineConfig(({ mode }) => ({
  plugins: [vue(), tailwindcss(), ...(mode === "native" ? [] : [workerNodeShims(), cloudflare()])],
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
  build: { target: "es2022", chunkSizeWarningLimit: 1500, ...(mode === "native" ? { outDir: "dist/native", emptyOutDir: true } : {}) },
}));
