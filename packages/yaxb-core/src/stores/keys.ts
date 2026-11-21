// The directory of members' device keys on D1 (migration 0026): where a device finds the public keys
// of the people who may read a sealed step (cases/sealed.ts `KeyDirectory`). Public keys only; the
// server never sees a private key. Scoped to one business (tenant).
import type { KeyDirectory } from "../cases/sealed.js";
import type { PublicKey } from "../seal/index.js";
import type { D1Like } from "./d1.js";

/** A member's devices that are listed; a new one beyond this replaces the oldest. */
export const MAX_DEVICE_KEYS = 8;
const ADMIN_MEMBER = "admin";

/** A public ECDH P-256 key and nothing else: no private part, no other curve, bounded size. */
export function checkPublicKey(k: unknown): PublicKey {
  const key = k as { id?: unknown; jwk?: Record<string, unknown> } | null;
  const jwk = key?.jwk;
  if (typeof key?.id !== "string" || !/^[\w-]{8,80}$/.test(key.id)) throw new Error("A key has an id of 8 to 80 letters, digits, - or _.");
  if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-256" || typeof jwk.x !== "string" || typeof jwk.y !== "string" || jwk.x.length > 64 || jwk.y.length > 64) throw new Error("That isn't a public P-256 key.");
  if ("d" in jwk) throw new Error("That key has a private part. Only the public key is shared.");
  return { id: key.id, jwk: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y } };
}

export interface MemberKeys extends KeyDirectory {
  /** List a device's key for a member (or the administrator). Listing it again changes nothing. */
  register(memberId: string, key: PublicKey, now?: Date): Promise<void>;
  /** Take a device's key out (a lost device); later copies of a case don't carry its lockbox. */
  remove(memberId: string, keyId: string): Promise<void>;
}

export function createD1MemberKeys(db: D1Like, { tenant = "default" }: { tenant?: string } = {}): MemberKeys {
  const rows = (sql: string, ...args: unknown[]) => db.prepare(sql).bind(...args).all<{ key_id: string; jwk: string }>().then((r) => r.results.map((x) => ({ id: x.key_id, jwk: JSON.parse(x.jwk) }) as PublicKey));
  return {
    async register(memberId, key, now = new Date()) {
      const k = checkPublicKey(key);
      await db.prepare("INSERT OR IGNORE INTO member_keys (tenant_id, member_id, key_id, jwk, created_at) VALUES (?1, ?2, ?3, ?4, ?5)").bind(tenant, memberId, k.id, JSON.stringify(k.jwk), now.toISOString()).run();
      // A member's oldest devices drop off beyond the limit.
      await db
        .prepare("DELETE FROM member_keys WHERE tenant_id = ?1 AND member_id = ?2 AND key_id NOT IN (SELECT key_id FROM member_keys WHERE tenant_id = ?1 AND member_id = ?2 ORDER BY created_at DESC, key_id LIMIT ?3)")
        .bind(tenant, memberId, MAX_DEVICE_KEYS)
        .run();
    },
    async remove(memberId, keyId) {
      await db.prepare("DELETE FROM member_keys WHERE tenant_id = ?1 AND member_id = ?2 AND key_id = ?3").bind(tenant, memberId, keyId).run();
    },
    // Active members who hold any of the roles; a revoked member's devices are not asked to read anything new.
    forRoles: (roles) =>
      roles.length
        ? rows(
            "SELECT k.key_id, k.jwk FROM member_keys k JOIN moderators m ON m.id = k.member_id AND m.tenant_id = k.tenant_id WHERE k.tenant_id = ?1 AND m.status = 'active' AND EXISTS (SELECT 1 FROM json_each(m.roles) r WHERE r.value IN (SELECT value FROM json_each(?2)))",
            tenant,
            JSON.stringify(roles),
          )
        : Promise.resolve([]),
    admins: () => rows("SELECT key_id, jwk FROM member_keys WHERE tenant_id = ?1 AND member_id = ?2", tenant, ADMIN_MEMBER),
  };
}
