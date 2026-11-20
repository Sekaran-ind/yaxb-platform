// The Worker's tests (worker/test), in Node without the Cloudflare plugin: the edition, its database
// and its caches (SUR-11), and the routes' authorization. The stores run on node:sqlite through
// yaxb-core's D1-shaped test adapter; `cloudflare:workers` is a stub (workerd isn't running).
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "cloudflare:workers": fileURLToPath(new URL("./worker/test/shims/cloudflare-workers.ts", import.meta.url)) } },
  test: { include: ["worker/test/**/*.test.ts"], environment: "node" },
});
