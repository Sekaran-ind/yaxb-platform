// Tenants and join tokens (TEN-1..8), for the directory's many businesses (after Cübo's facility
// join tokens). Each business is a tenant with its own members and catalogue; the Worker scopes the
// member and library stores by tenant, so the services above them don't change. Everything from
// before tenants belongs to `default`.
//
// Joining:
//   issueToken    an administrator issues a link for a role (only its hash is kept; it expires and
//                 has a number of uses)
//   preview       anyone with the link sees the business and the role
//   redeem        they give their name: a pending request, and a claim code kept in their browser
//                 (only its hash is kept here)
//   decide        an administrator accepts (choosing the role) or declines
//   collect       with the claim code, an accepted request becomes a member: the key is created
//                 then, shown once, never stored
import type { D1Like } from "../stores/d1.js";
import type { ModeratorRole } from "../moderators/index.js";

export type Tenant = { id: string; slug: string; name: string; kind: "business" | "family" | "community"; status: "active" | "suspended"; created_at: string };
export type JoinToken = { id: string; tenant_id: string; role: string; label: string | null; uses_left: number; expires_at: string; created_by: string | null; created_at: string; revoked: boolean; /** Accepted without a decision: only a new business's first administrator (TEN-8). */ auto_accept?: boolean };
export type JoinRequest = {
  id: string;
  tenant_id: string;
  token_id: string;
  name: string;
  role: string;
  status: "pending" | "accepted" | "declined" | "collected";
  member_id: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
};

export const DEFAULT_TENANT = "default";
export const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;
const ROLE = /^[a-z][a-z0-9-]{0,31}$/;

export class TenantError extends Error {
  constructor(
    message: string,
    readonly status = 422,
  ) {
    super(message);
  }
}

export interface TenantStore {
  tenants(): Promise<Tenant[]>;
  tenant(idOrSlug: string): Promise<Tenant | null>;
  putTenant(t: Tenant): Promise<void>;
  tokens(tenantId: string): Promise<(JoinToken & { token_hash: string })[]>;
  tokenByHash(hash: string): Promise<(JoinToken & { token_hash: string }) | null>;
  putToken(t: JoinToken & { token_hash: string }): Promise<void>;
  requests(tenantId: string): Promise<(JoinRequest & { claim_hash: string })[]>;
  request(id: string): Promise<(JoinRequest & { claim_hash: string }) | null>;
  putRequest(r: JoinRequest & { claim_hash: string }): Promise<void>;
}

async function sha256(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const secret = (prefix: string) => {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return prefix + btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const strip = <T extends { token_hash?: string; claim_hash?: string }>(x: T) => {
  const { token_hash: _t, claim_hash: _c, ...rest } = x;
  return rest as Omit<T, "token_hash" | "claim_hash">;
};

/** What the tenant service needs to make a member of a tenant (the moderator service, scoped). */
export type MemberIssuer = (tenantId: string, input: { name: string; roles: ModeratorRole[] }, actor: { name: string | null }) => Promise<{ moderator: { id: string }; key: string }>;

export function createTenantService(store: TenantStore, { issueMember, now = () => new Date() }: { issueMember: MemberIssuer; now?: () => Date }) {
  const iso = () => now().toISOString();

  /** A token that can still be used, or why not. */
  async function usable(token: string) {
    const t = typeof token === "string" && token.startsWith("yaxb_join_") ? await store.tokenByHash(await sha256(token)) : null;
    if (!t) throw new TenantError("That join link isn't valid.", 404);
    if (t.revoked) throw new TenantError("That join link was withdrawn.", 410);
    if (t.expires_at <= iso()) throw new TenantError("That join link has expired. Ask for a new one.", 410);
    if (t.uses_left <= 0) throw new TenantError("That join link has been used.", 410);
    const tenant = await store.tenant(t.tenant_id);
    if (!tenant || tenant.status !== "active") throw new TenantError("That business isn't taking new members.", 410);
    return { t, tenant };
  }

  return {
    store,
    /** A new business (the deployment's administrator only: the caller checks). */
    async createTenant(input: { name: string; slug: string; kind?: Tenant["kind"] }) {
      const name = String(input.name ?? "").trim();
      const slug = String(input.slug ?? "").trim().toLowerCase();
      if (!name || name.length > 80) throw new TenantError("Give the business a name (up to 80 characters).");
      if (!SLUG.test(slug)) throw new TenantError("The short name is lower-case letters, digits and '-' (up to 48).");
      if (await store.tenant(slug)) throw new TenantError("That short name is taken.", 409);
      const t: Tenant = { id: crypto.randomUUID(), slug, name, kind: input.kind === "family" || input.kind === "community" ? input.kind : "business", status: "active", created_at: iso() };
      await store.putTenant(t);
      return t;
    },
    /** The directory: active businesses, by name. */
    async directory() {
      return (await store.tenants()).filter((t) => t.status === "active").sort((a, b) => a.name.localeCompare(b.name)).map(({ id, slug, name, kind }) => ({ id, slug, name, kind }));
    },
    tenant: (idOrSlug: string) => store.tenant(idOrSlug),

    /** A join link for a role: the token is returned once; only its hash is kept. */
    async issueToken(tenantId: string, input: { role: string; hours?: number; uses?: number; label?: string; autoAccept?: boolean }, actor: { name: string | null }) {
      if (!ROLE.test(String(input.role ?? ""))) throw new TenantError("Choose the role the link gives.");
      const hours = Math.min(Math.max(Math.round(input.hours ?? 72), 1), 720);
      const uses = Math.min(Math.max(Math.round(input.uses ?? 1), 1), 50);
      const token = secret("yaxb_join_");
      const t = {
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        token_hash: await sha256(token),
        role: input.role,
        label: input.label?.trim().slice(0, 80) || null,
        uses_left: uses,
        expires_at: new Date(now().getTime() + hours * 3_600_000).toISOString(),
        created_by: actor.name,
        created_at: iso(),
        revoked: false,
        auto_accept: Boolean(input.autoAccept),
      };
      await store.putToken(t);
      return { token, joinToken: strip(t) as JoinToken };
    },
    async tokens(tenantId: string) {
      return (await store.tokens(tenantId)).map((t) => strip(t) as JoinToken).sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    async revokeToken(tenantId: string, id: string) {
      const t = (await store.tokens(tenantId)).find((x) => x.id === id);
      if (!t) throw new TenantError("No such join link.", 404);
      await store.putToken({ ...t, revoked: true });
    },

    /** What a join link offers: the business and the role. */
    async preview(token: string) {
      const { t, tenant } = await usable(token);
      return { tenant: { name: tenant.name, slug: tenant.slug }, role: t.role, label: t.label, expires_at: t.expires_at };
    },
    /** Ask to join: a pending request and the claim code (kept by the person, shown once). */
    async redeem(token: string, input: { name: string }) {
      const { t } = await usable(token);
      const name = String(input.name ?? "").trim();
      if (!name || name.length > 80) throw new TenantError("Enter your name (up to 80 characters).");
      const claim = secret("yaxb_claim_");
      // A new business's first administrator needs nobody's decision (TEN-8).
      const auto = Boolean(t.auto_accept);
      const r = { id: crypto.randomUUID(), tenant_id: t.tenant_id, token_id: t.id, name, role: t.role, claim_hash: await sha256(claim), status: auto ? ("accepted" as const) : ("pending" as const), member_id: null, decided_by: auto ? "join link" : null, decided_at: auto ? iso() : null, created_at: iso() };
      await store.putToken({ ...t, uses_left: t.uses_left - 1 });
      await store.putRequest(r);
      return { request: strip(r) as JoinRequest, claim };
    },
    async requests(tenantId: string) {
      return (await store.requests(tenantId)).map((r) => strip(r) as JoinRequest).sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    /** Accept (with the role, which may differ from the link's) or decline a pending request. */
    async decide(tenantId: string, id: string, decision: "accept" | "decline", opts: { role?: string }, actor: { name: string | null }) {
      const r = await store.request(id);
      if (!r || r.tenant_id !== tenantId) throw new TenantError("No such request.", 404);
      if (r.status !== "pending") throw new TenantError("That request was already decided.", 409);
      const role = opts.role ?? r.role;
      if (!ROLE.test(role)) throw new TenantError("Choose a role.");
      const next = { ...r, role, status: decision === "accept" ? ("accepted" as const) : ("declined" as const), decided_by: actor.name, decided_at: iso() };
      await store.putRequest(next);
      return strip(next) as JoinRequest;
    },
    /** Where a request stands, for the person who made it (with their claim code). */
    async status(id: string, claim: string) {
      const r = await store.request(id);
      if (!r || !claim || (await sha256(claim)) !== r.claim_hash) throw new TenantError("No such request.", 404);
      const tenant = await store.tenant(r.tenant_id);
      return { status: r.status, name: r.name, role: r.role, tenant: tenant ? { name: tenant.name, slug: tenant.slug } : null };
    },
    /** Collect an accepted request: the member is created and their key returned, once. */
    async collect(id: string, claim: string) {
      const r = await store.request(id);
      if (!r || !claim || (await sha256(claim)) !== r.claim_hash) throw new TenantError("No such request.", 404);
      if (r.status === "collected") throw new TenantError("This key was already collected. Ask the administrator to rotate it if it's lost.", 410);
      if (r.status !== "accepted") throw new TenantError(r.status === "declined" ? "The request was declined." : "The request is still waiting for an administrator.", 409);
      // Mark first, so a second collect can't make a second member.
      await store.putRequest({ ...r, status: "collected" });
      const { moderator, key } = await issueMember(r.tenant_id, { name: r.name, roles: [r.role] }, { name: r.decided_by });
      await store.putRequest({ ...r, status: "collected", member_id: moderator.id });
      return { key, memberId: moderator.id };
    },
  };
}
export type TenantService = ReturnType<typeof createTenantService>;

export function createMemoryTenantStore(): TenantStore {
  const tenants = new Map<string, Tenant>([[DEFAULT_TENANT, { id: DEFAULT_TENANT, slug: DEFAULT_TENANT, name: "This organisation", kind: "business", status: "active", created_at: "2026-11-15T00:00:00.000Z" }]]);
  const tokens = new Map<string, JoinToken & { token_hash: string }>();
  const requests = new Map<string, JoinRequest & { claim_hash: string }>();
  const c = <T>(v: T): T => structuredClone(v);
  return {
    tenants: async () => [...tenants.values()].map(c),
    tenant: async (k) => c([...tenants.values()].find((t) => t.id === k || t.slug === k) ?? null),
    putTenant: async (t) => void tenants.set(t.id, c(t)),
    tokens: async (tenantId) => [...tokens.values()].filter((t) => t.tenant_id === tenantId).map(c),
    tokenByHash: async (h) => c([...tokens.values()].find((t) => t.token_hash === h) ?? null),
    putToken: async (t) => void tokens.set(t.id, c(t)),
    requests: async (tenantId) => [...requests.values()].filter((r) => r.tenant_id === tenantId).map(c),
    request: async (id) => c(requests.get(id) ?? null),
    putRequest: async (r) => void requests.set(r.id, c(r)),
  };
}

/** Tenants and join tokens on D1 (migration 0013). */
export function createD1TenantStore(db: D1Like): TenantStore {
  const T = "id, slug, name, kind, status, created_at";
  const K = "id, tenant_id, token_hash, role, label, uses_left, expires_at, created_by, created_at, revoked, auto_accept";
  const R = "id, tenant_id, token_id, name, role, claim_hash, status, member_id, decided_by, decided_at, created_at";
  const token = (r: (JoinToken & { token_hash: string; revoked: unknown }) | null) => (r ? { ...r, revoked: Boolean(r.revoked), auto_accept: Boolean(r.auto_accept) } : null);
  return {
    tenants: async () => (await db.prepare(`SELECT ${T} FROM tenants ORDER BY name`).all<Tenant>()).results,
    tenant: (k) => db.prepare(`SELECT ${T} FROM tenants WHERE id = ?1 OR slug = ?1`).bind(k).first<Tenant>(),
    async putTenant(t) {
      await db.prepare(`INSERT INTO tenants (${T}) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT (id) DO UPDATE SET slug = ?2, name = ?3, kind = ?4, status = ?5`).bind(t.id, t.slug, t.name, t.kind, t.status, t.created_at).run();
    },
    tokens: async (tenantId) => (await db.prepare(`SELECT ${K} FROM join_tokens WHERE tenant_id = ?1`).bind(tenantId).all<JoinToken & { token_hash: string }>()).results.map((r) => token(r)!),
    tokenByHash: async (h) => token(await db.prepare(`SELECT ${K} FROM join_tokens WHERE token_hash = ?1`).bind(h).first<JoinToken & { token_hash: string }>()),
    async putToken(t) {
      await db
        .prepare(`INSERT INTO join_tokens (${K}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) ON CONFLICT (id) DO UPDATE SET uses_left = ?6, revoked = ?10`)
        .bind(t.id, t.tenant_id, t.token_hash, t.role, t.label, t.uses_left, t.expires_at, t.created_by, t.created_at, t.revoked ? 1 : 0, t.auto_accept ? 1 : 0)
        .run();
    },
    requests: async (tenantId) => (await db.prepare(`SELECT ${R} FROM join_requests WHERE tenant_id = ?1`).bind(tenantId).all<JoinRequest & { claim_hash: string }>()).results,
    request: (id) => db.prepare(`SELECT ${R} FROM join_requests WHERE id = ?1`).bind(id).first<JoinRequest & { claim_hash: string }>(),
    async putRequest(r) {
      await db
        .prepare(`INSERT INTO join_requests (${R}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) ON CONFLICT (id) DO UPDATE SET role = ?5, status = ?7, member_id = ?8, decided_by = ?9, decided_at = ?10`)
        .bind(r.id, r.tenant_id, r.token_id, r.name, r.role, r.claim_hash, r.status, r.member_id, r.decided_by, r.decided_at, r.created_at)
        .run();
    },
  };
}
