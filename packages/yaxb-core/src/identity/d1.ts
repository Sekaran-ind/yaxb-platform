// Identity in the platform database (PLATFORM_DB, migrations-platform 0002), shared by every edition.
import type { D1Like } from "../stores/d1.js";
import type { Account, Challenge, DeviceLock, SpacePolicy, IdentityAuditEvent, IdentityStore, Membership, Method, PendingJoin, Session, SigningKey } from "./index.js";

type MembershipRow = Omit<Membership, "roles"> & { roles: string };
type AuditRow = Omit<IdentityAuditEvent, "details"> & { details: string | null };

const METHOD_COLS = "id, account_id, kind, subject_hash, display, public_key, counter, verified_at, created_at, last_used_at";
const SESSION_COLS = "id, account_id, refresh_hash, prev_hash, method, level, device, created_at, last_used_at, expires_at, revoked_at";
const MEMBER_COLS = "account_id, edition, tenant_id, space_name, kind, roles, member_id, created_at";

const membership = (r: MembershipRow): Membership => ({ ...r, roles: JSON.parse(r.roles) as string[] });

export function createD1IdentityStore(db: D1Like): IdentityStore {
  const all = async <T>(sql: string, ...v: unknown[]) => (await db.prepare(sql).bind(...v).all<T>()).results;
  const first = <T>(sql: string, ...v: unknown[]) => db.prepare(sql).bind(...v).first<T>();
  const run = (sql: string, ...v: unknown[]) => db.prepare(sql).bind(...v).run();
  return {
    account: (id) => first<Account>("SELECT id, display_name, created_at, updated_at, deleted_at FROM accounts WHERE id = ?1", id),
    putAccount: async (a) =>
      void (await run(
        "INSERT INTO accounts (id, display_name, created_at, updated_at, deleted_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (id) DO UPDATE SET display_name = ?2, updated_at = ?4, deleted_at = ?5",
        a.id,
        a.display_name,
        a.created_at,
        a.updated_at,
        a.deleted_at,
      )),
    methodBySubject: (kind, hash) => first<Method>(`SELECT ${METHOD_COLS} FROM account_methods WHERE kind = ?1 AND subject_hash = ?2`, kind, hash),
    methods: (id) => all<Method>(`SELECT ${METHOD_COLS} FROM account_methods WHERE account_id = ?1 ORDER BY created_at, rowid`, id),
    putMethod: async (m) =>
      void (await run(
        `INSERT INTO account_methods (${METHOD_COLS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) ON CONFLICT (id) DO UPDATE SET display = ?5, public_key = ?6, counter = ?7, verified_at = ?8, last_used_at = ?10`,
        m.id,
        m.account_id,
        m.kind,
        m.subject_hash,
        m.display,
        m.public_key,
        m.counter,
        m.verified_at,
        m.created_at,
        m.last_used_at,
      )),
    removeMethod: async (id) => void (await run("DELETE FROM account_methods WHERE id = ?1", id)),
    memberships: async (id) => (await all<MembershipRow>(`SELECT ${MEMBER_COLS} FROM memberships WHERE account_id = ?1 ORDER BY created_at, rowid`, id)).map(membership),
    putMembership: async (m) =>
      void (await run(
        `INSERT INTO memberships (${MEMBER_COLS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) ON CONFLICT (account_id, edition, tenant_id) DO UPDATE SET space_name = ?4, kind = ?5, roles = ?6, member_id = ?7`,
        m.account_id,
        m.edition,
        m.tenant_id,
        m.space_name,
        m.kind,
        JSON.stringify(m.roles),
        m.member_id,
        m.created_at,
      )),
    removeMembership: async (a, e, t) => {
      const had = await first("SELECT 1 AS x FROM memberships WHERE account_id = ?1 AND edition = ?2 AND tenant_id = ?3", a, e, t);
      if (had) await run("DELETE FROM memberships WHERE account_id = ?1 AND edition = ?2 AND tenant_id = ?3", a, e, t);
      return Boolean(had);
    },
    session: (id) => first<Session>(`SELECT ${SESSION_COLS} FROM sessions WHERE id = ?1`, id),
    sessionByRefresh: (hash) => first<Session>(`SELECT ${SESSION_COLS} FROM sessions WHERE refresh_hash = ?1 OR prev_hash = ?1`, hash),
    sessions: (id) => all<Session>(`SELECT ${SESSION_COLS} FROM sessions WHERE account_id = ?1 ORDER BY created_at, rowid`, id),
    putSession: async (s) =>
      void (await run(
        `INSERT INTO sessions (${SESSION_COLS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) ON CONFLICT (id) DO UPDATE SET refresh_hash = ?3, prev_hash = ?4, level = ?6, last_used_at = ?9, expires_at = ?10, revoked_at = ?11`,
        s.id,
        s.account_id,
        s.refresh_hash,
        s.prev_hash,
        s.method,
        s.level,
        s.device,
        s.created_at,
        s.last_used_at,
        s.expires_at,
        s.revoked_at,
      )),
    challenge: (id) => first<Challenge>("SELECT id, channel, subject_hash, code_hash, attempts, created_at, expires_at, consumed_at FROM otp_challenges WHERE id = ?1", id),
    putChallenge: async (c) => {
      await run(
        "INSERT INTO otp_challenges (id, channel, subject_hash, code_hash, attempts, created_at, expires_at, consumed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) ON CONFLICT (id) DO UPDATE SET attempts = ?5, consumed_at = ?8",
        c.id,
        c.channel,
        c.subject_hash,
        c.code_hash,
        c.attempts,
        c.created_at,
        c.expires_at,
        c.consumed_at,
      );
      // Ended challenges are useless after a day: removed as new ones arrive.
      await run("DELETE FROM otp_challenges WHERE expires_at < ?1", new Date(Date.now() - 86400_000).toISOString());
    },
    keys: () => all<SigningKey>("SELECT kid, public_jwk, sealed_private, created_at, retired_at FROM signing_keys ORDER BY created_at"),
    putKey: async (k) =>
      void (await run(
        "INSERT INTO signing_keys (kid, public_jwk, sealed_private, created_at, retired_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (kid) DO UPDATE SET retired_at = ?5",
        k.kid,
        k.public_jwk,
        k.sealed_private,
        k.created_at,
        k.retired_at,
      )),
    hit: async (key, w) => {
      await run("INSERT INTO identity_counters (key, window_start, count) VALUES (?1, ?2, 1) ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1", key, w);
      return (await first<{ count: number }>("SELECT count FROM identity_counters WHERE key = ?1 AND window_start = ?2", key, w))?.count ?? 1;
    },
    count: async (key, w) => (await first<{ count: number }>("SELECT count FROM identity_counters WHERE key = ?1 AND window_start = ?2", key, w))?.count ?? 0,
    audit: async (e) => void (await run("INSERT INTO identity_audit (id, at, account_id, action, details) VALUES (?1, ?2, ?3, ?4, ?5)", e.id, e.at, e.account_id, e.action, e.details ? JSON.stringify(e.details) : null)),
    auditLog: async (id, limit) =>
      (await all<AuditRow>("SELECT id, at, account_id, action, details FROM identity_audit WHERE account_id = ?1 ORDER BY at DESC, rowid DESC LIMIT ?2", id, limit)).map((r) => ({
        ...r,
        details: r.details ? (JSON.parse(r.details) as IdentityAuditEvent["details"]) : null,
      })),
    pendingJoins: (id) => all<PendingJoin>("SELECT id, account_id, edition, tenant_id, space_name, kind, request_id, sealed_claim, created_at FROM pending_joins WHERE account_id = ?1 ORDER BY created_at, rowid", id),
    putPendingJoin: async (p) =>
      void (await run(
        "INSERT INTO pending_joins (id, account_id, edition, tenant_id, space_name, kind, request_id, sealed_claim, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        p.id,
        p.account_id,
        p.edition,
        p.tenant_id,
        p.space_name,
        p.kind,
        p.request_id,
        p.sealed_claim,
        p.created_at,
      )),
    removePendingJoin: async (id) => void (await run("DELETE FROM pending_joins WHERE id = ?1", id)),
    spacePolicy: async (e, t) => {
      const r = await first<Omit<SpacePolicy, "methods" | "staff_passkeys"> & { methods: string; staff_passkeys: number }>("SELECT edition, tenant_id, methods, staff_passkeys, session_hours, updated_at FROM space_policies WHERE edition = ?1 AND tenant_id = ?2", e, t);
      return r ? { ...r, methods: JSON.parse(r.methods) as SpacePolicy["methods"], staff_passkeys: Boolean(r.staff_passkeys) } : null;
    },
    putSpacePolicy: async (p) =>
      void (await run(
        "INSERT INTO space_policies (edition, tenant_id, methods, staff_passkeys, session_hours, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT (edition, tenant_id) DO UPDATE SET methods = ?3, staff_passkeys = ?4, session_hours = ?5, updated_at = ?6",
        p.edition,
        p.tenant_id,
        JSON.stringify(p.methods),
        p.staff_passkeys ? 1 : 0,
        p.session_hours,
        p.updated_at,
      )),
    deviceLock: (id) => first<DeviceLock>("SELECT id, edition, tenant_id, space_name, label, secret_hash, locked_by, created_at, unlocked_at FROM device_locks WHERE id = ?1", id),
    deviceLocks: (e, t) => all<DeviceLock>("SELECT id, edition, tenant_id, space_name, label, secret_hash, locked_by, created_at, unlocked_at FROM device_locks WHERE edition = ?1 AND tenant_id = ?2 ORDER BY created_at DESC, rowid DESC", e, t),
    putDeviceLock: async (l) =>
      void (await run(
        "INSERT INTO device_locks (id, edition, tenant_id, space_name, label, secret_hash, locked_by, created_at, unlocked_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) ON CONFLICT (id) DO UPDATE SET unlocked_at = ?9",
        l.id,
        l.edition,
        l.tenant_id,
        l.space_name,
        l.label,
        l.secret_hash,
        l.locked_by,
        l.created_at,
        l.unlocked_at,
      )),
    eraseAccount: async (id) => {
      await run("DELETE FROM pending_joins WHERE account_id = ?1", id);
      await run("DELETE FROM account_methods WHERE account_id = ?1", id);
      await run("DELETE FROM memberships WHERE account_id = ?1", id);
      await run("UPDATE sessions SET revoked_at = COALESCE(revoked_at, ?2) WHERE account_id = ?1", id, new Date().toISOString());
    },
  };
}
