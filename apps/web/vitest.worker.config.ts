// The Worker's tests (worker/test), in Node without the Cloudflare plugin: the edition, its database
// and its caches (SUR-11). The stores run on node:sqlite through yaxb-core's D1-shaped test adapter.
import { defineConfig } from "vitest/config";

export default defineConfig({ test: { include: ["worker/test/**/*.test.ts"], environment: "node" } });
