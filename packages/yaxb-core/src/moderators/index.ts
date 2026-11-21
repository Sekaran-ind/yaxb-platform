// Moderators, their keys and profiles, and the audit log (docs/specs/07-moderation-and-quality.md
// MOD-20..25, 09 SEC-5).
//
// The organisation's administrator issues each moderator a key: a random secret (256 bits) shown
// once, stored only as its SHA-256 hash, with a name, roles, a label and an optional expiry. A key
// can be revoked or rotated. A moderator signs in with it; their profile (display name, languages,
// the knowledge sources they look after, preferences) and their activity live on the server,
// because moderators work from several devices. Every key change, sign-in and profile change goes
// into the audit log: who, what, when, never content.
import { z } from "zod";
import { knowledgeSources } from "../knowledge/index.js";
import { LANGUAGES, type LanguageCode } from "../schemas/index.js";
import { leavesNoAdministrator } from "../team/index.js";

/** A team rule refused a change (TEAM-6). */
export class TeamRuleError extends Error {}
const LAST_ADMIN = "The team needs at least one active administrator. Make someone else an administrator first.";

/**
 * Built-in roles (TEAM-1, LIB-10). An administrator member may manage the team, like the
 * ADMIN_TOKEN holder; a reviewer accepts or rejects library entries. A member may also hold the
 * organisation's own roles (the library's catalogue: front-desk, nurse…), so a role is any role id.
 */
export const MODERATOR_ROLES = ["moderator", "curator", "reviewer", "administrator"] as const;
export type ModeratorRole = string;
const ROLE_ID = /^[a-z][a-z0-9-]{0,31}$/;
export const KEY_PREFIX = "yaxb_mod_";

export type ModeratorStatus = "active" | "revoked" | "expired";

/**
 * What a machine key may call (IDN-16): routines and integrations, never a person's sign-in. Each
 * scope is a method and a path under /api; a machine calling anything else is refused.
 */
export const MACHINE_SCOPES = {
  "catalogue:read": { label: "Read the published services", routes: [["GET", "/api/library/published"]] },
  "events:read": { label: "Read services' events", routes: [["GET", "/api/events"]] },
  "events:write": { label: "Record services' events", routes: [["POST", "/api/events"]] },
  "cases:read": { label: "Read requests", routes: [["GET", "/api/cases"]] },
  "cases:write": { label: "Start and act on requests", routes: [["POST", "/api/cases"]] },
  "relay:use": { label: "Use the relay for hand-overs", routes: [["GET", "/api/relay"], ["POST", "/api/relay"], ["DELETE", "/api/relay"]] },
  "audit:read": { label: "Read the audit chain's head", routes: [["GET", "/api/admin/audit/chain"]] },
} as const satisfies Record<string, { label: string; routes: readonly (readonly [string, string])[] }>;
export type MachineScope = keyof typeof MACHINE_SCOPES;
export const MACHINE_SCOPE_IDS = Object.keys(MACHINE_SCOPES) as MachineScope[];
/** A machine key lasts at most a year: it is renewed by rotating it. */
export const MACHINE_MAX_DAYS = 365;

/** Whether a machine with these scopes may make this call (the path's prefix, method exact). */
export function machineMayCall(scopes: readonly string[], method: string, path: string): boolean {
  return scopes.some((s) =>
    (MACHINE_SCOPES[s as MachineScope]?.routes ?? []).some(([m, prefix]) => m === method.toUpperCase() && (path === prefix || path.startsWith(`${prefix}/`))),
  );
}

export type Moderator = {
  id: string;
  name: string;
  label: string | null;
  roles: ModeratorRole[];
  /** As stored: active or revoked. Use statusOf() for expiry. */
  status: "active" | "revoked";
  /** The first characters of the key, to tell keys apart ("yaxb_mod_3fA9…"). */
  key_prefix: string;
  created_at: string;
  expires_at: string | null;
  last_seen_at: string | null;
  reviews: number;
  /** The business (tenant, TEN-1) the member belongs to; absent: the default one. */
  tenant?: string;
  /** A person (the default) or a machine (IDN-16): a routine or an integration, with scopes and no roles. */
  kind?: "person" | "machine";
  /** A machine's scopes (MACHINE_SCOPES). */
  scopes?: string[] | null;
  /** When a person linked this member to their account (IDN-44): their key no longer signs in. */
  linked_at?: string | null;
};

export type ModeratorProfile = {
  moderator_id: string;
  display_name: string;
  languages: LanguageCode[];
  /** Knowledge source ids (knowledge_sources.json) they look after. */
  sources: string[];
  preferences: { reviewLanguage?: LanguageCode; queue?: "open" | "all"; availability?: "available" | "busy" | "away" };
  updated_at: string;
};

export const AUDIT_ACTIONS = {
  "audit.viewed": "Audit log viewed",
  "link.created": "Business link asked for",
  "link.consent_changed": "Business link's consent changed",
  "link.ended": "Business link ended",
  "audit.exported": "Audit log exported",
  "admin.signed_in": "Administrator signed in",
  "moderator.signed_in": "Moderator signed in",
  "moderator.sign_in_refused": "Sign-in refused",
  "moderator.key_issued": "Moderator key issued",
  "moderator.key_revoked": "Moderator key revoked",
  "moderator.key_rotated": "Moderator key rotated",
  "moderator.updated": "Moderator details changed",
  "moderator.profile_updated": "Moderator profile changed",
  "moderator.removed": "Member removed",
  "moderator.reinstated": "Member reinstated with a new key",
  "moderator.linked": "Member now signs in with an account",
  "machine.key_issued": "Machine key issued",
  "machine.refused": "Machine call refused",
  "tenant.created": "Business added to the directory",
  "join.link_issued": "Join link issued",
  "join.link_withdrawn": "Join link withdrawn",
  "join.accepted": "Join request accepted",
  "join.declined": "Join request declined",
  "join.collected": "Joined with a new key",
  "moderation.viewed": "Moderation queue opened",
  "moderation.handled": "Escalated question handled",
  "answer.reviewed": "Answer reviewed",
  "library.created": "Library created",
  "library.changed": "Library renamed or described",
  "library.archived": "Library archived",
  "library.restored": "Library restored",
  "library.entry_created": "Service created",
  "library.template_applied": "Organisation template applied",
  "library.entry_saved": "Service saved",
  "library.entry_submitted": "Service submitted for review",
  "library.entry_accepted": "Service accepted",
  "library.entry_rejected": "Service rejected",
  "library.entry_archived": "Service archived",
  "library.entry_restored": "Service restored",
  "library.role_added": "Role added",
  "library.role_changed": "Role changed",
  "library.role_removed": "Role removed",
  "library.entry_storage": "Storage chosen",
  "library.entry_retain": "Retention period set",
  "connector.secret_set": "Connector secret set",
  "connector.secret_removed": "Connector secret removed",
  "routine.settings": "Routines paused, resumed or limited",
  "routine.run_now": "Routine run by hand",
  "routine.approved": "Routine's action approved",
  "routine.declined": "Routine's action declined",
  "routine.switched": "Family routine switched on or off",
  "routine.signing_key": "Routine's webhook signing key shown",
} as const;
export type AuditAction = keyof typeof AUDIT_ACTIONS;

export type AuditEvent = {
  id: string;
  at: string;
  /** guest: someone designing in the Service Catalogue without signing in (their session). */
  actor_type: "admin" | "moderator" | "system" | "guest";
  actor_id: string | null;
  actor_name: string | null;
  action: AuditAction;
  target_id: string | null;
  /** Short facts only (a label, a role list, a count): never what was reviewed or asked. */
  details: Record<string, string | number | boolean> | null;
  /**
   * The hash chain (AUD-2): the hash of the tenant's record before this one, and this record's
   * own hash over its facts and that one. Set by the store; null on records from before the chain.
   */
  prev_hash?: string | null;
  hash?: string | null;
};

/**
 * Runs async work one after another (a store's audit writes in one instance), so each record is
 * hashed from the head the one before it left. Other instances are handled by the store (D1).
 */
export function serially(): <T>(work: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return (work) => {
    const run = tail.then(work, work);
    tail = run.catch(() => undefined);
    return run;
  };
}

/** Where every tenant's chain starts. */
export const AUDIT_GENESIS = "0".repeat(64);

/** A record's hash (AUD-2): SHA-256 over its facts, in a fixed order, and the hash before it. */
export async function auditHash(e: AuditEvent, prev: string): Promise<string> {
  const details = e.details ? Object.fromEntries(Object.entries(e.details).sort(([a], [b]) => a.localeCompare(b))) : null;
  return hashKey(JSON.stringify([prev, e.id, e.at, e.actor_type, e.actor_id, e.actor_name, e.action, e.target_id, details]));
}

export type ChainCheck = { ok: boolean; checked: number; head: string; brokenAt: string | null; reason: string | null };

/**
 * Re-computes a chain, oldest first (AUD-2). Records from before the chain (no hash) are skipped.
 * A window that doesn't start at the beginning is checked from its first record's prev_hash.
 */
export async function verifyAuditChain(oldestFirst: readonly AuditEvent[]): Promise<ChainCheck> {
  const chained = oldestFirst.filter((e) => e.hash);
  let prev = chained[0]?.prev_hash ?? AUDIT_GENESIS;
  for (const e of chained) {
    if (e.prev_hash !== prev) return { ok: false, checked: chained.indexOf(e), head: prev, brokenAt: e.id, reason: "a record is missing or out of order before this one" };
    if ((await auditHash(e, prev)) !== e.hash) return { ok: false, checked: chained.indexOf(e), head: prev, brokenAt: e.id, reason: "this record was changed after it was written" };
    prev = e.hash!;
  }
  return { ok: true, checked: chained.length, head: prev, brokenAt: null, reason: null };
}

// ---- input ------------------------------------------------------------------------------------------

// Built-in roles or the organisation's own (the Worker checks those exist in the catalogue).
const ROLE = z.string().regex(ROLE_ID, "A role id is lower-case words joined by '-'.");
export const newModeratorSchema = z
  .strictObject({
    name: z.string().trim().min(1, "Enter the moderator's name.").max(80),
    label: z.string().trim().max(80).optional(),
    roles: z.array(ROLE).max(20).default(["moderator"]),
    /** Days until the key expires; none = no expiry (a machine's key always expires). */
    expiresInDays: z.number().int().min(1).max(730).optional(),
    /** A machine (IDN-16): its scopes instead of roles. */
    kind: z.enum(["person", "machine"]).default("person"),
    scopes: z.array(z.enum(MACHINE_SCOPE_IDS as [MachineScope, ...MachineScope[]])).max(MACHINE_SCOPE_IDS.length).optional(),
  })
  .superRefine((m, ctx) => {
    if (m.kind === "person" && !m.roles.length) ctx.addIssue({ code: "custom", path: ["roles"], message: "Choose at least one role." });
    if (m.kind === "person" && m.scopes?.length) ctx.addIssue({ code: "custom", path: ["scopes"], message: "Scopes are for machines." });
    if (m.kind === "machine" && !m.scopes?.length) ctx.addIssue({ code: "custom", path: ["scopes"], message: "Choose what the machine may do." });
    if (m.kind === "machine" && (!m.expiresInDays || m.expiresInDays > MACHINE_MAX_DAYS)) ctx.addIssue({ code: "custom", path: ["expiresInDays"], message: `A machine's key expires within ${MACHINE_MAX_DAYS} days.` });
  });
export type NewModerator = z.input<typeof newModeratorSchema>;

export const updateModeratorSchema = z.strictObject({
  name: z.string().trim().min(1).max(80).optional(),
  label: z.string().trim().max(80).nullable().optional(),
  roles: z.array(ROLE).min(1).max(20).optional(),
});

const LANGUAGE = z.enum(LANGUAGES.map((l) => l.code) as [LanguageCode, ...LanguageCode[]]);
export const moderatorProfileSchema = z.strictObject({
  display_name: z.string().trim().min(1, "Enter a display name.").max(60),
  languages: z.array(LANGUAGE).max(LANGUAGES.length).default([]),
  sources: z
    .array(z.string())
    .max(20)
    .default([])
    .refine((ids) => ids.every((id) => knowledgeSources.some((s) => s.id === id)), { message: "Unknown knowledge source." }),
  preferences: z.strictObject({ reviewLanguage: LANGUAGE.optional(), queue: z.enum(["open", "all"]).optional(), availability: z.enum(["available", "busy", "away"]).optional() }).default({}),
});
export type ModeratorProfileInput = z.input<typeof moderatorProfileSchema>;

// ---- keys -------------------------------------------------------------------------------------------

const base64url = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** A new key: "yaxb_mod_" and 256 random bits, base64url. */
export function newModeratorKey(): string {
  return KEY_PREFIX + base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** What's stored instead of the key: its SHA-256, hex. (The key is random, so no slow hash is needed.) */
export async function hashKey(key: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The part of a key shown in lists. */
export const keyPrefixOf = (key: string) => `${key.slice(0, KEY_PREFIX.length + 4)}…`;

/** Does it look like a moderator key at all (before any lookup)? */
export const looksLikeKey = (s: string) => new RegExp(`^${KEY_PREFIX}[A-Za-z0-9_-]{43}$`).test(s);

/** Active, revoked or expired, at `now`. */
export function statusOf(m: Pick<Moderator, "status" | "expires_at">, now = new Date()): ModeratorStatus {
  if (m.status === "revoked") return "revoked";
  if (m.expires_at && new Date(m.expires_at) <= now) return "expired";
  return "active";
}

// ---- the store ----------------------------------------------------------------------------------------

export interface ModeratorStore {
  list(): Promise<Moderator[]>;
  get(id: string): Promise<Moderator | null>;
  byKeyHash(hash: string): Promise<Moderator | null>;
  /** The stored hash for a moderator (to bind their session to the current key). */
  keyHashOf(id: string): Promise<string | null>;
  create(m: Omit<Moderator, "last_seen_at" | "reviews">, keyHash: string): Promise<Moderator>;
  update(id: string, patch: Partial<Pick<Moderator, "name" | "label" | "roles" | "status" | "key_prefix" | "expires_at" | "last_seen_at" | "reviews" | "linked_at">>, keyHash?: string): Promise<Moderator | null>;
  getProfile(id: string): Promise<ModeratorProfile | null>;
  putProfile(p: ModeratorProfile): Promise<void>;
  /** Remove a member and their profile (TEAM-2); the audit log keeps the history. */
  remove(id: string): Promise<boolean>;
  audit(e: AuditEvent): Promise<void>;
  auditLog(opts?: { limit?: number; actorId?: string; targetId?: string; before?: string }): Promise<AuditEvent[]>;
  /** The chain's newest hash and how many records it holds (AUD-2), to compare with the box. */
  auditHead(): Promise<{ hash: string; count: number }>;
  /** The newest `limit` chained records, oldest first, to verify. */
  auditChain(limit?: number): Promise<AuditEvent[]>;
}

/** An audit entry, with details limited to short scalar facts. */
export function auditEvent(input: Omit<AuditEvent, "id" | "at" | "details"> & { details?: Record<string, unknown> }, now = new Date()): AuditEvent {
  if (!(input.action in AUDIT_ACTIONS)) throw new Error(`Unknown audit action: ${input.action}`);
  const details: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(input.details ?? {}).slice(0, 8)) {
    if (typeof v === "number" || typeof v === "boolean") details[k] = v;
    else if (typeof v === "string") details[k] = v.slice(0, 80);
    else if (Array.isArray(v)) details[k] = v.map(String).join(", ").slice(0, 80);
  }
  return { id: crypto.randomUUID(), at: now.toISOString(), ...input, details: Object.keys(details).length ? details : null };
}

/** The administrator's view of moderators and keys (MOD-20..23). */
export function createModeratorService(store: ModeratorStore) {
  const nowIso = () => new Date().toISOString();
  return {
    store,

    /** Issue a key: the key is in the result once, and never again. */
    async issue(input: NewModerator, actor: { name: string | null } = { name: null }) {
      const m = newModeratorSchema.parse(input);
      const key = newModeratorKey();
      const machine = m.kind === "machine";
      const created = await store.create(
        {
          id: crypto.randomUUID(),
          name: m.name,
          label: m.label || null,
          roles: machine ? [] : m.roles,
          status: "active",
          key_prefix: keyPrefixOf(key),
          created_at: nowIso(),
          expires_at: m.expiresInDays ? new Date(Date.now() + m.expiresInDays * 864e5).toISOString() : null,
          kind: m.kind,
          scopes: machine ? [...new Set(m.scopes)] : null,
          linked_at: null,
        },
        await hashKey(key),
      );
      await store.audit(
        machine
          ? auditEvent({ actor_type: "admin", actor_id: null, actor_name: actor.name, action: "machine.key_issued", target_id: created.id, details: { name: created.name, scopes: (created.scopes ?? []).join(","), expires: created.expires_at ?? "never" } })
          : auditEvent({ actor_type: "admin", actor_id: null, actor_name: actor.name, action: "moderator.key_issued", target_id: created.id, details: { name: created.name, roles: created.roles, expires: created.expires_at ?? "never" } }),
      );
      return { moderator: created, key };
    },

    async revoke(id: string) {
      if (leavesNoAdministrator(await store.list(), id, { suspend: true })) throw new TeamRuleError(LAST_ADMIN);
      const m = await store.update(id, { status: "revoked" });
      if (m) await store.audit(auditEvent({ actor_type: "admin", actor_id: null, actor_name: null, action: "moderator.key_revoked", target_id: id, details: { name: m.name } }));
      return m;
    },

    /** A new key for the same moderator; the old one stops working at once. */
    async rotate(id: string) {
      const old = await store.get(id);
      if (!old) return null;
      const key = newModeratorKey();
      // A machine's key is renewed by rotating it: it lasts as long again as it did, at most a year.
      const renewed =
        old.kind === "machine" && old.expires_at
          ? { expires_at: new Date(Date.now() + Math.min(new Date(old.expires_at).getTime() - new Date(old.created_at).getTime(), MACHINE_MAX_DAYS * 864e5)).toISOString() }
          : {};
      const m = await store.update(id, { status: "active", key_prefix: keyPrefixOf(key), ...renewed }, await hashKey(key));
      await store.audit(auditEvent({ actor_type: "admin", actor_id: null, actor_name: null, action: old.status === "revoked" ? "moderator.reinstated" : "moderator.key_rotated", target_id: id, details: { name: old.name } }));
      return m ? { moderator: m, key } : null;
    },

    async change(id: string, patch: unknown) {
      const p = updateModeratorSchema.parse(patch);
      if (p.roles && leavesNoAdministrator(await store.list(), id, { roles: p.roles })) throw new TeamRuleError(LAST_ADMIN);
      const m = await store.update(id, { ...(p.name ? { name: p.name } : {}), ...(p.label !== undefined ? { label: p.label || null } : {}), ...(p.roles ? { roles: p.roles } : {}) });
      if (m) await store.audit(auditEvent({ actor_type: "admin", actor_id: null, actor_name: null, action: "moderator.updated", target_id: id, details: { fields: Object.keys(p) } }));
      return m;
    },

    /** Remove a member (TEAM-2): their key stops working and their profile goes. */
    async remove(id: string, actor: { name: string | null } = { name: null }) {
      const m = await store.get(id);
      if (!m) return false;
      if (leavesNoAdministrator(await store.list(), id, { remove: true })) throw new TeamRuleError(LAST_ADMIN);
      await store.remove(id);
      await store.audit(auditEvent({ actor_type: "admin", actor_id: null, actor_name: actor.name, action: "moderator.removed", target_id: id, details: { name: m.name } }));
      return true;
    },

    /**
     * Sign in with a key: the person when the key is theirs, active and not expired. A machine's key
     * never signs in (IDN-16), and a person who signs in with an account no longer uses theirs (IDN-44).
     */
    async signIn(key: string): Promise<Moderator | null> {
      if (!looksLikeKey(key)) return null;
      const m = await store.byKeyHash(await hashKey(key));
      const refused = !m ? null : statusOf(m) !== "active" ? statusOf(m) : m.kind === "machine" ? "machine" : m.linked_at ? "linked" : null;
      if (!m || refused) {
        if (m) await store.audit(auditEvent({ actor_type: "system", actor_id: m.id, actor_name: m.name, action: "moderator.sign_in_refused", target_id: m.id, details: { status: refused! } }));
        return null;
      }
      await store.update(m.id, { last_seen_at: nowIso() });
      await store.audit(auditEvent({ actor_type: "moderator", actor_id: m.id, actor_name: m.name, action: "moderator.signed_in", target_id: m.id }));
      return m;
    },

    /** Why a key doesn't sign in, for the message: a machine's, or a person's who uses an account now. */
    async keyKind(key: string): Promise<"machine" | "linked" | null> {
      if (!looksLikeKey(key)) return null;
      const m = await store.byKeyHash(await hashKey(key));
      return m?.kind === "machine" ? "machine" : m?.linked_at ? "linked" : null;
    },

    /** A machine calling the API with its key (IDN-16): the machine when the key is its, active and not expired. */
    async machine(key: string): Promise<Moderator | null> {
      if (!looksLikeKey(key)) return null;
      const m = await store.byKeyHash(await hashKey(key));
      if (!m || m.kind !== "machine" || statusOf(m) !== "active") return null;
      // Seen at most once an hour: a routine may call often.
      if (!m.last_seen_at || Date.now() - new Date(m.last_seen_at).getTime() > 3600_000) await store.update(m.id, { last_seen_at: nowIso() });
      return m;
    },

    /** A person's member record now signs in through their account (IDN-44): their key stops signing in. */
    async linkToAccount(id: string): Promise<Moderator | null> {
      const m = await store.get(id);
      if (!m || m.kind === "machine") return null;
      if (m.linked_at) return m;
      const done = await store.update(id, { linked_at: nowIso() });
      await store.audit(auditEvent({ actor_type: "moderator", actor_id: id, actor_name: m.name, action: "moderator.linked", target_id: id }));
      return done;
    },

    /** A moderator's profile, with defaults until they save one. */
    async profile(m: Moderator): Promise<ModeratorProfile> {
      return (await store.getProfile(m.id)) ?? { moderator_id: m.id, display_name: m.name, languages: [], sources: [], preferences: {}, updated_at: m.created_at };
    },

    async saveProfile(m: Moderator, input: unknown): Promise<ModeratorProfile> {
      const p = moderatorProfileSchema.parse(input);
      const profile: ModeratorProfile = { moderator_id: m.id, ...p, updated_at: nowIso() };
      await store.putProfile(profile);
      await store.audit(auditEvent({ actor_type: "moderator", actor_id: m.id, actor_name: p.display_name, action: "moderator.profile_updated", target_id: m.id, details: { languages: p.languages.length, sources: p.sources.length } }));
      return profile;
    },
  };
}
export type ModeratorService = ReturnType<typeof createModeratorService>;

/** In memory (tests, the CLI). */
export function createMemoryModeratorStore(): ModeratorStore {
  const rows = new Map<string, Moderator & { key_hash: string }>();
  const profiles = new Map<string, ModeratorProfile>();
  const log: AuditEvent[] = [];
  let chained = 0;
  const inOrder = serially();
  const strip = (r: Moderator & { key_hash: string }): Moderator => {
    const { key_hash: _, ...m } = r;
    return { ...m, roles: [...m.roles] };
  };
  return {
    async list() {
      return [...rows.values()].map(strip).sort((a, b) => a.name.localeCompare(b.name));
    },
    async get(id) {
      const r = rows.get(id);
      return r ? strip(r) : null;
    },
    async byKeyHash(hash) {
      const r = [...rows.values()].find((x) => x.key_hash === hash);
      return r ? strip(r) : null;
    },
    async keyHashOf(id) {
      return rows.get(id)?.key_hash ?? null;
    },
    async create(m, keyHash) {
      const r = { ...m, kind: m.kind ?? "person", scopes: m.scopes ?? null, linked_at: m.linked_at ?? null, last_seen_at: null, reviews: 0, key_hash: keyHash };
      rows.set(m.id, r);
      return strip(r);
    },
    async update(id, patch, keyHash) {
      const r = rows.get(id);
      if (!r) return null;
      Object.assign(r, patch, keyHash ? { key_hash: keyHash } : {});
      return strip(r);
    },
    async getProfile(id) {
      return profiles.get(id) ?? null;
    },
    async putProfile(p) {
      profiles.set(p.moderator_id, p);
    },
    async remove(id) {
      profiles.delete(id);
      return rows.delete(id);
    },
    audit: (e) =>
      inOrder(async () => {
        const prev = log[0]?.hash ?? AUDIT_GENESIS;
        log.unshift({ ...e, prev_hash: prev, hash: await auditHash(e, prev) });
        log.length = Math.min(log.length, 5000);
        chained++;
      }),
    async auditHead() {
      return { hash: log[0]?.hash ?? AUDIT_GENESIS, count: chained };
    },
    async auditChain(limit = 5000) {
      return log.slice(0, Math.max(1, limit)).reverse();
    },
    async auditLog({ limit = 100, actorId, targetId, before } = {}) {
      return log.filter((e) => (!actorId || e.actor_id === actorId) && (!targetId || e.target_id === targetId) && (!before || e.at < before)).slice(0, Math.min(Math.max(limit, 1), 500));
    },
  };
}
