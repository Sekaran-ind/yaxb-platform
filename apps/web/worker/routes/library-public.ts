// Routes: library-public. Registered on the shared app when imported; the order of imports in index.ts is the order of registration.
import { app } from "../app";
import { catalogue, moderators } from "../kiosk";
import { staffingOf } from "@sekaran-ind/yaxb-core/cases";
import { memberStatus } from "@sekaran-ind/yaxb-core/team";
import { libraryActor } from "../actors";

/**
 * The published catalogue (LIB-8, LIB-18): every accepted service of an active library, with its
 * roles and journeys, and which journeys this viewer may start. Kiosks load services from it.
 */
app.get("/api/library/published", async (c) => {
  const actor = await libraryActor(c);
  const out = await (await catalogue(c.env)).published(actor.roles, { all: actor.admin });
  // Whether the team has someone for each role (LIB-37), so a kiosk loading a service can say
  // which of its journeys would wait with nobody to act. Yes, invited or no; never who, or how many.
  const members = (await moderators(c.env).store.list()).map((m) => ({ roles: m.roles, status: memberStatus(m) }));
  return c.json({ ...out, staffing: staffingOf(out.roles.map((r) => r.id), members), viewer: { roles: actor.roles, member: !actor.guest, admin: actor.admin, ...(actor.guest ? {} : { id: actor.id, name: actor.name }) } });
});
