// Routes: connectors. Registered on the shared app when imported; the order of imports in index.ts is the order of registration.
import { app } from "../app";
import { dohResolver } from "@sekaran-ind/yaxb-core/web/pages";
import { type Context } from "hono";
import { connectorSecrets } from "../kiosk";
import { callConnector, connectorSecrets as connectorSecretNames, ConnectorError, parseConnector } from "@sekaran-ind/yaxb-core/connectors";
import { sealConnectorSecret, unsealConnectorSecret } from "../secrets";
import { connectorCalled } from "../kiosk";
import { catalogue, currentTenant } from "../kiosk";
import { LibraryError, permissionsOf } from "@sekaran-ind/yaxb-core/library";
import { clientId } from "../session";
import { MAX_FORM_BODY, jsonError, sameOrigin, withinLimit, readJson } from "../http";
import { audited, libraryCall } from "../actors";
import type { AppEnv } from "../app";

/** A published connector of this tenant, and whether a published journey uses the operation. */
async function connectorFor(c: Context<AppEnv>, id: string) {
  const lib = await catalogue(c.env);
  const pub = await lib.published([], { all: true });
  const entry = pub.connectors.find((x) => x.id === id);
  if (!entry) return null;
  const e = await lib.store.entry(entry.entry_id);
  const parsed = e?.published_yaml ? parseConnector(e.published_yaml) : null;
  if (!parsed?.ok) return null;
  return { connector: parsed.connector, entry_id: entry.entry_id, used: (handler: string) => pub.services.some((s) => s.yaml.includes(handler)) };
}

/**
 * A journey's connector step (CNX-2, CNX-5): the kiosk sends the step's input; the server adds the
 * secret and calls the API through the SSRF guard. Only an operation a published journey uses can be
 * called, so this is never an open proxy. The answer comes back as untrusted data.
 */
app.post("/api/connectors/:id/:op", async (c) => {
  if (!sameOrigin(c)) return jsonError(c, 403, "Forbidden");
  if (!(await withinLimit("chat", c.env.CHAT_LIMITER, `connector:${await clientId(c)}`))) return jsonError(c, 429, "Too many requests. Please wait a minute.");
  const found = await connectorFor(c, c.req.param("id"));
  const handler = `connector.${c.req.param("id")}.${c.req.param("op")}`;
  if (!found || !found.used(handler)) return jsonError(c, 404, "That connector isn't used by a published service here.");
  const body = (await readJson(c, MAX_FORM_BODY)).body as { input?: unknown } | null;
  const input = body?.input && typeof body.input === "object" && !Array.isArray(body.input) ? (body.input as Record<string, unknown>) : {};
  const secrets: Record<string, string> = {};
  for (const r of await connectorSecrets(c.env).list(currentTenant(), found.connector.id)) secrets[r.name] = await unsealConnectorSecret(c.env, r.sealed);
  const started = Date.now();
  try {
    const out = await callConnector(found.connector, c.req.param("op"), input, secrets, { resolve: dohResolver() });
    c.executionCtx.waitUntil(connectorCalled(c.env, found.entry_id, c.req.param("op"), out.ok, out.ms).catch(() => undefined));
    return c.json(out);
  } catch (e) {
    c.executionCtx.waitUntil(connectorCalled(c.env, found.entry_id, c.req.param("op"), false, Date.now() - started).catch(() => undefined));
    if (e instanceof ConnectorError) return jsonError(c, e.status, e.message);
    throw e;
  }
});

/** A connector's secrets for its administrator: names and when they were set, never the values (CNX-3). */
app.get("/api/library/connectors/:id/secrets", (c) =>
  libraryCall(c, async (a) => {
    if (!permissionsOf(a).manage) throw new LibraryError("Only an administrator sees a connector's secrets.", 403);
    const found = await connectorFor(c, c.req.param("id"));
    const needed = found ? connectorSecretNames(found.connector) : [];
    const set = await connectorSecrets(c.env).list(currentTenant(), c.req.param("id"));
    return { needed, set: set.map((r) => ({ name: r.name, set_at: r.set_at, set_by: r.set_by })) };
  }),
);
app.put("/api/library/connectors/:id/secrets/:name", (c) =>
  libraryCall(c, async (a, body) => {
    if (!permissionsOf(a).manage) throw new LibraryError("Only an administrator sets a connector's secrets.", 403);
    const value = String((body as { value?: unknown } | null)?.value ?? "");
    if (!/^[A-Z][A-Z0-9_]{1,47}$/.test(c.req.param("name"))) throw new LibraryError("A secret's name is UPPER_CASE.");
    if (!value || value.length > 4000) throw new LibraryError("Give the secret's value.");
    await connectorSecrets(c.env).put({ tenant_id: currentTenant(), connector_id: c.req.param("id"), name: c.req.param("name"), sealed: await sealConnectorSecret(c.env, value), set_at: new Date().toISOString(), set_by: a.name });
    await audited(c, "connector.secret_set", a.name, c.req.param("id"), { name: c.req.param("name") });
    return { set: true };
  }),
);
app.delete("/api/library/connectors/:id/secrets/:name", (c) =>
  libraryCall(c, async (a) => {
    if (!permissionsOf(a).manage) throw new LibraryError("Only an administrator removes a connector's secrets.", 403);
    await connectorSecrets(c.env).remove(currentTenant(), c.req.param("id"), c.req.param("name"));
    await audited(c, "connector.secret_removed", a.name, c.req.param("id"), { name: c.req.param("name") });
    return { removed: true };
  }),
);
