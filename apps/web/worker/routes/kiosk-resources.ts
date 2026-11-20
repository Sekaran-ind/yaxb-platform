// Routes: kiosk-resources. Registered on the shared app when imported; the order of imports in index.ts is the order of registration.
import { app } from "../app";
import { settings } from "../env";
import { orgMcpServers } from "../kiosk";
import { mcpServerInfo } from "@sekaran-ind/yaxb-core/mcp";
import { kiosk, moderators } from "../kiosk";
import { freePlanInfo } from "../limits";
import { moderatorOf, sessionId } from "../session";
import { jsonError } from "../http";

// Read-only kiosk resources. `moderation` holds visitors' escalated questions: moderators only.
app.get("/api/agent/:resource", async (c) => {
  sessionId(c); // issue the session cookie on the kiosk's first call
  const k = kiosk(c.env);
  switch (c.req.param("resource")) {
    case "providers":
      return c.json(k.providers());
    case "capabilities": {
      // Where cases may be kept here (LIB-42..48): central storage only on the paid plan.
      const s = settings(c.env);
      const caps = k.capabilities();
      // The business's own MCP servers (CNX-1) join the deployment's; never their address's secrets.
      const org = (await orgMcpServers(c.env).catch(() => [])).filter((sv) => !caps.mcp.some((m) => m.id === sv.id)).map(mcpServerInfo);
      return c.json({ ...caps, freeTier: freePlanInfo(c.env), mcp: [...caps.mcp, ...org], cases: { central: s.CASES_CENTRAL === "on", relay: s.CASES_RELAY === "on", relayHours: s.RELAY_HOURS } });
    }
    case "sources":
      return c.json({ sources: k.sources() });
    case "curated":
      return c.json({ items: k.curated().slice(0, 10) });
    case "feedback":
      if (!(await moderatorOf(c, moderators(c.env)))) return jsonError(c, 401, "Moderator sign-in required.");
      return c.json(await k.feedbackSummary());
    case "moderation":
      if (!(await moderatorOf(c, moderators(c.env)))) return jsonError(c, 401, "Moderator sign-in required.");
      return c.json({
        items: await k.moderation(100, {
          ...(c.req.query("state") === "open" || c.req.query("state") === "handled" ? { state: c.req.query("state") as "open" | "handled" } : {}),
          ...(c.req.query("reason") ? { reason: c.req.query("reason")!.slice(0, 500) } : {}),
        }),
      });
    default:
      return jsonError(c, 404, "Not found");
  }
});
