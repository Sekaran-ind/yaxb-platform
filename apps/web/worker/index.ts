// The YAXB web Worker: the API under /api (Hono) and the Vue app's static assets for everything
// else, served with strict security headers. The agent runs here (yaxb-core); provider keys never
// leave the Worker.
//
// The routes live in ./routes, one module per area. Each registers itself on the shared app (./app)
// when imported, so the order of the imports below IS the order Hono tries them in: middleware first,
// the API's 404 after every API route, the pages last. Shared helpers: ./http and ./actors.
import { app } from "./app";
import { sweep } from "./routines";
import type { AppEnv } from "./app";

export { TeamHub } from "./team";
export type { AppEnv } from "./app";

import "./routes/middleware";
import "./routes/agent";
import "./routes/sites";
import "./routes/kiosk-resources";
import "./routes/moderator";
import "./routes/admin-session";
import "./routes/tenants";
import "./routes/links";
import "./routes/join";
import "./routes/admin";
import "./routes/reviews";
import "./routes/library-public";
import "./routes/identity";
import "./routes/cases";
import "./routes/connectors";
import "./routes/events";
import "./routes/routines";
import "./routes/relay";
import "./routes/library";
import "./routes/team";
import "./routes/forms";
import "./routes/api-fallback";
import "./routes/pages";

/** The routes, for the authorization test (worker/test/authorization.test.ts). */
export { app };

/**
 * The Worker: requests through Hono, and the Cron Trigger (wrangler.jsonc `triggers.crons`, every
 * 15 minutes) sweeping every business's time routines (RTN-2).
 */
export default {
  fetch: app.fetch,
  scheduled(_event: ScheduledController, env: AppEnv["Bindings"], ctx: ExecutionContext) {
    ctx.waitUntil(sweep(env).then((n) => void (n && console.log(JSON.stringify({ msg: "routines swept", runs: n })))));
  },
} satisfies ExportedHandler<AppEnv["Bindings"]>;
