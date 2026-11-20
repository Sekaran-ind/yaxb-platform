// Routes: identity. Registered on the shared app when imported; the order of imports in index.ts is the order of registration.
import { app } from "../app";
import { currentTenant, moderators, tenantContext, tenantOfMember, tenants } from "../kiosk";
import { DEFAULT_TENANT, SLUG, TenantError } from "@sekaran-ind/yaxb-core/tenants";
import { currentEdition, withEdition } from "../edition";
import { isAdmin, moderatorOf } from "../session";
import { identityRoutes } from "../identity";
import { IdentityError } from "@sekaran-ind/yaxb-core/identity";
import { sameOrigin, ip, withinLimit } from "../http";
import { joinEdition } from "../actors";

/** A space's name when its tenant has none (the edition's own space). */
const OWN_SPACE: Record<string, { name: string; kind: "family" | "business" | "community" }> = {
  family: { name: "Our home", kind: "family" },
  business: { name: "Our business", kind: "business" },
  community: { name: "Our community", kind: "community" },
  all: { name: "Anjal", kind: "business" },
};
app.route(
  "/api/identity",
  identityRoutes({
    sameOrigin,
    ip,
    limited: (c, key) => withinLimit("form", c.env.FORM_LIMITER, key),
    polled: (c, key) => withinLimit("chat", c.env.CHAT_LIMITER, key),
    tenant: currentTenant,
    isAdmin,
    async findSpace(_c, slug) {
      if (!SLUG.test(slug)) return null;
      for (const edition of ["business", "community", "all"] as const) {
        const t = await withEdition(edition, () => tenants(_c.env).tenant(slug)).catch(() => null);
        if (t) return { edition, tenant_id: t.id, name: t.name };
      }
      return null;
    },
    async joinAsStaff(c, edition, tenant, input) {
      return withEdition(edition, () =>
        tenantContext.run(tenant, async () => {
          const svc = moderators(c.env, tenant);
          const { moderator } = await svc.issue({ name: input.name.slice(0, 80) || "Staff", label: "Signed in with the company's sign-in", roles: [input.role] }, { name: "Company sign-in" });
          // They sign in with their company's account; the key made for the record is never used (IDN-44).
          await svc.linkToAccount(moderator.id);
          const t = await tenants(c.env).tenant(tenant);
          return { member_id: moderator.id, roles: [...moderator.roles], space_name: t?.name ?? "Our business", kind: t?.kind ?? (edition === "community" ? "community" : "business") };
        }),
      );
    },
    async spaceAdministrator(c) {
      const who = await moderatorOf(c, moderators(c.env));
      return Boolean(who?.roles.includes("administrator")) || (await isAdmin(c));
    },
    async spaceInfo(env, tenant) {
      const own = OWN_SPACE[currentEdition()]!;
      if (tenant === DEFAULT_TENANT) return own;
      const t = await tenants(env).tenant(tenant);
      return t ? { name: t.name, kind: t.kind } : own;
    },
    async signedInMember(c) {
      const who = await moderatorOf(c, moderators(c.env));
      if (!who || who.machine) return null;
      // The person now signs in with their account (IDN-44): their key stops signing in.
      await moderators(c.env).linkToAccount(who.moderator.id);
      return { id: who.moderator.id, roles: [...who.moderator.roles] };
    },
    async startSpace(c, input) {
      const base = input.name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 36) || "space";
      const slug = `${base}-${crypto.getRandomValues(new Uint32Array(1))[0]!.toString(36).slice(0, 5)}`;
      const t = await tenants(c.env).createTenant({ name: input.name, slug, kind: input.kind });
      const { moderator } = await moderators(c.env, t.id).issue({ name: input.person.slice(0, 80) || "Administrator", label: "Started the space", roles: ["administrator"] }, { name: input.person });
      // The person signs in with their account; the key made for the record is never shown or used (IDN-44).
      await moderators(c.env, t.id).linkToAccount(moderator.id);
      return { tenant_id: t.id, name: t.name, kind: t.kind, member_id: moderator.id, roles: [...moderator.roles] };
    },
    async joinSpace(c, token, person) {
      try {
        const { edition, value } = await joinEdition(async () => {
          const svc = tenants(c.env);
          const { request, claim } = await svc.redeem(token, { name: person });
          const t = await svc.tenant(request.tenant_id);
          const own = OWN_SPACE[currentEdition()]!;
          return { tenant_id: request.tenant_id, space_name: t?.name ?? own.name, kind: t?.kind ?? own.kind, request_id: request.id, claim, accepted: request.status === "accepted" };
        });
        return { ...value, edition };
      } catch (e) {
        if (e instanceof TenantError) throw new IdentityError(e.message, e.status);
        throw e;
      }
    },
    async collectJoin(c, requestId, claim) {
      const svc = tenants(c.env);
      try {
        const s = await svc.status(requestId, claim);
        if (s.status === "pending") return { status: "pending" };
        if (s.status === "declined") return { status: "declined" };
        if (s.status === "collected") return { status: "gone" };
        const { memberId } = await svc.collect(requestId, claim);
        // The member is made in the space's tenant; they sign in with their account from now (IDN-44).
        const tenant = (await tenantOfMember(c.env, memberId)) ?? currentTenant();
        const m = await moderators(c.env, tenant).linkToAccount(memberId);
        return { status: "collected", member_id: memberId, roles: m ? [...m.roles] : [s.role] };
      } catch {
        return { status: "gone" };
      }
    },
    async memberFor(c, input) {
      const { moderator } = await moderators(c.env).issue({ name: input.name.slice(0, 80) || "Administrator", label: "Linked to an account", roles: input.roles as never }, { name: "Administrator" });
      await moderators(c.env).linkToAccount(moderator.id);
      return { id: moderator.id, roles: [...moderator.roles] };
    },
  }),
);
