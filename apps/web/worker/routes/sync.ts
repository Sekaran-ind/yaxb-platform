// Routes: sync. Registered on the shared app when imported; the order of imports in index.ts is the order of registration.
import { app } from "../app";
import { jsonError } from "../http";
import { syncAllowance } from "../sync-allowance";

/** What the signed-in account has left of the free plan's yearly syncs ("3 of 5 left"); limit null = no limit. */
app.get("/api/sync/allowance", async (c) => {
  const account = c.get("account");
  if (!account) return jsonError(c, 401, "Sign in to see your syncs.");
  return c.json(await syncAllowance(c.env).status(account.sub));
});
