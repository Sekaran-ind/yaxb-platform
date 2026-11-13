import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// The Vue components as a library: dist/vue/index.js and dist/vue/style.css (the YAML editor's
// CodeMirror module is its own chunk, loaded on demand). Vue, CodeMirror and the headless
// core (this package's own dist, built first by tsc) stay external, so a host has one copy of each.
export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: "dist/vue",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: true,
    lib: { entry: fileURLToPath(new URL("./vue/index.ts", import.meta.url)), formats: ["es"], fileName: "index", cssFileName: "style" },
    rolldownOptions: { external: ["vue", /^@sekaran-ind\/yaxb-journeys/, "js-yaml", /^@codemirror\//, /^@lezer\//] },
  },
});
