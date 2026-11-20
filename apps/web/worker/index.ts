// The YAXB web Worker: the API under /api (Hono) and the Vue app's static assets for everything
// else, served with strict security headers. The agent runs here (yaxb-core); provider keys never
// leave the Worker.
//
// The routes live in ./routes, one module per area. Each registers itself on the shared app (./app)
// when imported, so the order of the imports below IS the order Hono tries them in: middleware first,
// the API's 404 after every API route, the pages last. Shared helpers: ./http and ./actors.
import { app } from "./app";
import { runSweepJob, sweep, type SweepJob } from "./routines";
import { checkSizes } from "./db-size";
import { purgeAll } from "./purge";
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
import "./routes/sync";
import "./routes/records";
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

/** Must match the daily entry in wrangler.jsonc `triggers.crons`. */
export const PURGE_CRON = "17 3 * * *";

/**
 * The Worker: requests through Hono, and the Cron Triggers (wrangler.jsonc `triggers.crons`): every
 * 15 minutes the sweep of every business's time routines (RTN-2), and once a day the purge of records
 * past their lifetime (stores/lifetime.ts).
 */
export default {
  fetch: app.fetch,
  scheduled(event: ScheduledController, env: AppEnv["Bindings"], ctx: ExecutionContext) {
    if (event.cron === PURGE_CRON) {
      // The purge first, so the size it reports is what is left.
      ctx.waitUntil(
        purgeAll(env)
          .then((done) => void (Object.keys(done).length && console.log(JSON.stringify({ msg: "records purged", ...done }))))
          .then(() => checkSizes(env))
          .then(() => undefined),
      );
      return;
    }
    ctx.waitUntil(sweep(env).then((n) => void (n && console.log(JSON.stringify({ msg: "routines swept", runs: n })))));
  },
  /**
   * The paid plan's sweep queue (wrangler.jsonc `queues`): one job per business, run in parallel and
   * retried on its own. Without the queue binding the cron runs the jobs itself and this is never called.
   */
  async queue(batch: MessageBatch<SweepJob>, env: AppEnv["Bindings"]) {
    for (const message of batch.messages) {
      try {
        await runSweepJob(env, message.body);
        message.ack();
      } catch (e) {
        console.error(JSON.stringify({ msg: "sweep job failed", edition: message.body.edition, job: message.body.job, attempt: message.attempts, error: e instanceof Error ? `${e.name}: ${e.message.slice(0, 200)}` : "unknown" }));
        message.retry({ delaySeconds: 60 });
      }
    }
  },
} satisfies ExportedHandler<AppEnv["Bindings"], SweepJob>;
