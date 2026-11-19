// Approved sites on the platform database (D1, migrations-platform 0009).
import type { D1Like } from "../stores/d1.js";
import type { ApprovedSite, SiteRequest, SiteStore } from "./index.js";

type SiteRow = Omit<ApprovedSite, "paths" | "uses"> & { paths: string; uses: string };
const site = (r: SiteRow): ApprovedSite => ({ ...r, paths: JSON.parse(r.paths) as string[], uses: JSON.parse(r.uses) as ApprovedSite["uses"] });
const SITE_COLS = "id, origin, paths, region, category, uses, edition, tenant_id, status, approved_by, review_at, note, created_at, updated_at";
const REQ_COLS = "id, origin, use, reason, asked_by_label, asked_by, edition, tenant_id, count, status, decided_by, created_at, updated_at";

export function createD1SiteStore(db: D1Like): SiteStore {
  return {
    sites: async () => (await db.prepare(`SELECT ${SITE_COLS} FROM approved_sites ORDER BY origin`).all<SiteRow>()).results.map(site),
    site: async (id) => {
      const r = await db.prepare(`SELECT ${SITE_COLS} FROM approved_sites WHERE id = ?1`).bind(id).first<SiteRow>();
      return r ? site(r) : null;
    },
    putSite: async (s) =>
      void (await db
        .prepare(
          `INSERT INTO approved_sites (${SITE_COLS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14) ON CONFLICT (id) DO UPDATE SET paths = ?3, region = ?4, category = ?5, uses = ?6, status = ?9, review_at = ?11, note = ?12, updated_at = ?14`,
        )
        .bind(s.id, s.origin, JSON.stringify(s.paths), s.region, s.category, JSON.stringify(s.uses), s.edition, s.tenant_id, s.status, s.approved_by, s.review_at, s.note, s.created_at, s.updated_at)
        .run()),
    requests: async (status) =>
      status
        ? (await db.prepare(`SELECT ${REQ_COLS} FROM site_requests WHERE status = ?1 ORDER BY updated_at DESC`).bind(status).all<SiteRequest>()).results
        : (await db.prepare(`SELECT ${REQ_COLS} FROM site_requests ORDER BY updated_at DESC`).all<SiteRequest>()).results,
    request: (id) => db.prepare(`SELECT ${REQ_COLS} FROM site_requests WHERE id = ?1`).bind(id).first<SiteRequest>(),
    putRequest: async (r) =>
      void (await db
        .prepare(`INSERT INTO site_requests (${REQ_COLS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13) ON CONFLICT (id) DO UPDATE SET count = ?9, status = ?10, decided_by = ?11, updated_at = ?13`)
        .bind(r.id, r.origin, r.use, r.reason, r.asked_by_label, r.asked_by, r.edition, r.tenant_id, r.count, r.status, r.decided_by, r.created_at, r.updated_at)
        .run()),
    audit: async (e) => void (await db.prepare("INSERT INTO site_audit (id, at, actor, action, origin, details) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").bind(e.id, e.at, e.actor, e.action, e.origin, e.details ? JSON.stringify(e.details) : null).run()),
  };
}
