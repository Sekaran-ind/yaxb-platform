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
  "moderation.viewed": "Moderation queue opened",
  "moderation.handled": "Escalated question handled",
  "answer.reviewed": "Answer reviewed",
  "library.created": "Library created",
  "library.changed": "Library renamed or described",
  "library.archived": "Library archived",
  "library.restored": "Library restored",
  "library.entry_saved": "Library entry saved",
  "library.entry_submitted": "Library entry submitted for review",
  "library.entry_accepted": "Library entry accepted",
  "library.entry_rejected": "Library entry rejected",
  "library.entry_archived": "Library entry archived",
  "library.entry_restored": "Library entry restored",
  "library.role_added": "Role added",
  "library.role_changed": "Role changed",
  "library.role_removed": "Role removed",
} as const;
export type AuditAction = keyof typeof AUDIT_ACTIONS;

export type AuditEvent = {
  id: string;
  at: string;
  actor_type: "admin" | "moderator" | "system";
  actor_id: string | null;
  actor_name: string | null;
  action: AuditAction;
  target_id: string | null;
  /** Short facts only (a label, a role list, a count): never what was reviewed or asked. */
  details: Record<string, string | number | boolean> | null;
};

// ---- input ------------------------------------------------------------------------------------------

// Built-in roles or the organisation's own (the Worker checks those exist in the catalogue).
const ROLE = z.string().regex(ROLE_ID, "A role id is lower-case words joined by '-'.");
export const newModeratorSchema = z.strictObject({
  name: z.string().trim().min(1, "Enter the moderator's name.").max(80),
  label: z.string().trim().max(80).optional(),
  roles: z.array(ROLE).min(1).max(20).default(["moderator"]),
  /** Days until the key expires; none = no expiry. */
  expiresInDays: z.number().int().min(1).max(730).optional(),
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
  update(id: string, patch: Partial<Pick<Moderator, "name" | "label" | "roles" | "status" | "key_prefix" | "expires_at" | "last_seen_at" | "reviews">>, keyHash?: string): Promise<Moderator | null>;
  getProfile(id: string): Promise<ModeratorProfile | null>;
  putProfile(p: ModeratorProfile): Promise<void>;
  /** Remove a member and their profile (TEAM-2); the audit log keeps the history. */
  remove(id: string): Promise<boolean>;
  audit(e: AuditEvent): Promise<void>;
  auditLog(opts?: { limit?: number; actorId?: string; before?: string }): Promise<AuditEvent[]>;
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
      const created = await store.create(
        {
          id: crypto.randomUUID(),
          name: m.name,
          label: m.label || null,
          roles: m.roles,
          status: "active",
          key_prefix: keyPrefixOf(key),
          created_at: nowIso(),
          expires_at: m.expiresInDays ? new Date(Date.now() + m.expiresInDays * 864e5).toISOString() : null,
        },
        await hashKey(key),
      );
      await store.audit(auditEvent({ actor_type: "admin", actor_id: null, actor_name: actor.name, action: "moderator.key_issued", target_id: created.id, details: { name: created.name, roles: created.roles, expires: created.expires_at ?? "never" } }));
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
      const m = await store.update(id, { status: "active", key_prefix: keyPrefixOf(key) }, await hashKey(key));
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

    /** Sign in with a key: the moderator when the key is theirs, active and not expired. */
    async signIn(key: string): Promise<Moderator | null> {
      if (!looksLikeKey(key)) return null;
      const m = await store.byKeyHash(await hashKey(key));
      if (!m || statusOf(m) !== "active") {
        if (m) await store.audit(auditEvent({ actor_type: "system", actor_id: m.id, actor_name: m.name, action: "moderator.sign_in_refused", target_id: m.id, details: { status: statusOf(m) } }));
        return null;
      }
      await store.update(m.id, { last_seen_at: nowIso() });
      await store.audit(auditEvent({ actor_type: "moderator", actor_id: m.id, actor_name: m.name, action: "moderator.signed_in", target_id: m.id }));
      return m;
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
      const r = { ...m, last_seen_at: null, reviews: 0, key_hash: keyHash };
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
    async audit(e) {
      log.unshift(e);
      log.length = Math.min(log.length, 5000);
    },
    async auditLog({ limit = 100, actorId, before } = {}) {
      return log.filter((e) => (!actorId || e.actor_id === actorId) && (!before || e.at < before)).slice(0, Math.min(Math.max(limit, 1), 500));
    },
  };
}
