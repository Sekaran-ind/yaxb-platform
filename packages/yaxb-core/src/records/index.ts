// Runtime-data export and import (docs/architecture/hardening.md, "Data lifetime and trust", step 4).
// A business's services and configuration are designed and kept on the server (the service catalogue);
// what leaves and comes back is only what its services captured at run time: cases, their events and
// the service events. The file is a versioned bundle of that business's rows, never a copy of the
// database, so an export or import touches no other business. The import re-checks every row, puts it
// in the importing business, and maps each row to that business's own copy of the service by the
// service's id, so it works on another deployment as well as the same one.
import { z } from "zod";
import type { D1Like } from "../stores/d1.js";
import { CASE_STATUSES, MAX_CASE_RUN } from "../cases/index.js";
import { EVENT_KINDS, retainDaysOf } from "../metrics/index.js";
import { TRANSIENT_DAYS } from "../stores/lifetime.js";

export const RECORDS_FORMAT = "yaxb-records";
export const RECORDS_VERSION = 1;
/** Rows a bundle may hold, in all: a Worker request has only a few dozen database calls (export a service at a time for more). */
export const MAX_RECORD_ROWS = 5000;
/** The biggest import body: bound by the 2 MB a database value may hold per batch, and the Worker's request size. */
export const MAX_RECORDS_BYTES = 8 * 1024 * 1024;
const BATCH_ROWS = 200;
const BATCH_BYTES = 900_000;
const DAY_MS = 86_400_000;

export class RecordsError extends Error {
  constructor(message: string, readonly status = 422) {
    super(message);
  }
}

const text = (max: number) => z.string().max(max);
const json = (max: number) => z.string().max(max).refine((s) => { try { JSON.parse(s); return true; } catch { return false; } }, "must be JSON text");
const iso = z.string().max(40).refine((s) => !Number.isNaN(Date.parse(s)), "must be a date");
const id = z.string().min(1).max(80);

const caseRow = z.strictObject({
  id, ref: text(40), entry_id: id, service_id: text(120), service_title: text(200), journey_id: text(120), journey_title: text(200),
  revision: z.number().int().nullable(), status: z.enum(CASE_STATUSES as [string, ...string[]]), waiting_step: text(120).nullable(), waiting_role: text(120).nullable(),
  finish_roles: json(4000), roles: json(8000), started_by: text(120), started_by_name: text(200), created_at: iso, updated_at: iso, closed_at: iso.nullable(),
  result: json(MAX_CASE_RUN).nullable(), run: json(MAX_CASE_RUN), journey: json(MAX_CASE_RUN), starter_device: text(120).nullable(), assignee: text(120).nullable(), assignee_name: text(200).nullable(),
});
const caseEventRow = z.strictObject({ id, case_id: id, at: iso, actor_id: text(120), actor_name: text(200), kind: text(60), step: text(120).nullable(), text: text(4000).nullable() });
const serviceEventRow = z.strictObject({
  id, service: id, journey: text(120), kind: z.enum(EVENT_KINDS), step: text(120).nullable(), role: text(120).nullable(), run: text(120), at: iso,
  ms: z.number().int().nullable(), ok: z.number().int().min(0).max(1).nullable(), actor: text(200).nullable(), outcome: text(200).nullable(),
});

export const recordsBundleSchema = z.strictObject({
  format: z.literal(RECORDS_FORMAT),
  version: z.literal(RECORDS_VERSION),
  exported_at: iso,
  /** The services the rows belong to: the id each had where it was exported, and the id it has as a document (what the importer matches on). */
  services: z.array(z.strictObject({ entry_id: id, doc_id: text(120), title: text(200) })).max(500),
  cases: z.array(caseRow),
  case_events: z.array(caseEventRow),
  service_events: z.array(serviceEventRow),
}).refine((b) => b.cases.length + b.case_events.length + b.service_events.length <= MAX_RECORD_ROWS, `A bundle holds at most ${MAX_RECORD_ROWS} rows. Export one service at a time.`);
export type RecordsBundle = z.infer<typeof recordsBundleSchema>;

const CASE_COLS = Object.keys(caseRow.shape);
const CASE_EVENT_COLS = Object.keys(caseEventRow.shape);
const SERVICE_EVENT_COLS = Object.keys(serviceEventRow.shape);

/** A business's runtime data, optionally for one service (its entry id). Reads only that business's rows. */
export async function exportRecords(db: D1Like, tenant: string, { service }: { service?: string } = {}, now = new Date()): Promise<RecordsBundle> {
  const sc = service ? " AND entry_id = ?2" : "";
  const args = service ? [tenant, service] : [tenant];
  const count = async (sql: string) => (await db.prepare(sql).bind(...args).first<{ n: number }>())?.n ?? 0;
  const total =
    (await count(`SELECT COUNT(*) AS n FROM cases WHERE tenant_id = ?1${sc}`)) +
    (await count(`SELECT COUNT(*) AS n FROM case_events WHERE case_id IN (SELECT id FROM cases WHERE tenant_id = ?1${sc})`)) +
    (await count(`SELECT COUNT(*) AS n FROM service_events WHERE tenant_id = ?1${service ? " AND service = ?2" : ""}`));
  if (total > MAX_RECORD_ROWS) throw new RecordsError(`That is ${total} rows; a bundle holds at most ${MAX_RECORD_ROWS}. Export one service at a time.`, 413);
  const all = async <T>(sql: string) => (await db.prepare(sql).bind(...args).all<T>()).results;
  const cases = await all<Record<string, unknown>>(`SELECT ${CASE_COLS.join(", ")} FROM cases WHERE tenant_id = ?1${sc} ORDER BY created_at, id`);
  const case_events = await all<Record<string, unknown>>(`SELECT ${CASE_EVENT_COLS.join(", ")} FROM case_events WHERE case_id IN (SELECT id FROM cases WHERE tenant_id = ?1${sc}) ORDER BY at, id`);
  const service_events = await all<Record<string, unknown>>(`SELECT ${SERVICE_EVENT_COLS.join(", ")} FROM service_events WHERE tenant_id = ?1${service ? " AND service = ?2" : ""} ORDER BY at, id`);
  const entries = [...new Set([...cases.map((c) => c.entry_id as string), ...service_events.map((e) => e.service as string), ...(service ? [service] : [])])];
  const services = entries.length
    ? (await db.prepare("SELECT id AS entry_id, doc_id, title FROM library_entries WHERE tenant_id = ?1 AND id IN (SELECT value FROM json_each(?2))").bind(tenant, JSON.stringify(entries)).all<{ entry_id: string; doc_id: string; title: string }>()).results
    : [];
  return parseRecords({ format: RECORDS_FORMAT, version: RECORDS_VERSION, exported_at: now.toISOString(), services, cases, case_events, service_events });
}

/** Checks a bundle read from a file or request; the first problem is the error. */
export function parseRecords(input: unknown): RecordsBundle {
  const r = recordsBundleSchema.safeParse(input);
  if (!r.success) {
    const i = r.error.issues[0]!;
    throw new RecordsError(`That is not a records file this version can read: ${i.path.length ? `${i.path.join(".")}: ` : ""}${i.message}`);
  }
  return r.data;
}

export type ImportReport = {
  /** Rows written, per kind. */
  added: { cases: number; case_events: number; service_events: number };
  /** Rows already there (a second import of the same file adds nothing). */
  already: { cases: number; case_events: number; service_events: number };
  /** Rows older than they may live here (the free plan keeps 30 days; the paid plan the service's period). */
  expired: number;
  /** Rows of services this business doesn't have: add the service first, then import again. */
  missingServices: string[];
};

async function insertBatches(db: D1Like, table: string, cols: string[], rows: Record<string, unknown>[], extra: { sql: string; select: string; args: unknown[] }): Promise<number> {
  let written = 0;
  let batch: Record<string, unknown>[] = [];
  let bytes = 0;
  const flush = async () => {
    if (!batch.length) return;
    const select = cols.map((c) => `json_extract(value, '$.${c}')`).join(", ");
    const r = await db
      .prepare(`INSERT OR IGNORE INTO ${table} (${cols.join(", ")}${extra.sql}) SELECT ${select}${extra.select} FROM json_each(?1)${table === "case_events" ? " WHERE json_extract(value, '$.case_id') IN (SELECT id FROM cases WHERE tenant_id = ?2)" : ""}`)
      .bind(JSON.stringify(batch), ...extra.args)
      .run();
    written += (r as { meta?: { changes?: number }; changes?: number | bigint } | null)?.meta?.changes ?? Number((r as { changes?: number | bigint } | null)?.changes ?? 0);
    batch = [];
    bytes = 0;
  };
  for (const row of rows) {
    const size = JSON.stringify(row).length;
    if (batch.length >= BATCH_ROWS || bytes + size > BATCH_BYTES) await flush();
    batch.push(row);
    bytes += size;
  }
  await flush();
  return written;
}

/**
 * Puts a bundle's rows in `tenant`, matching each to the business's own copy of its service by the
 * service's document id. A case's dependency links are never exported (they point at other cases and
 * businesses of the place it came from). Rows are added only (an id that exists is left alone, whoever owns it), so an
 * import never overwrites or takes over anything. `plan` decides the clock: on the free plan a case
 * gets a fresh `created_at` (a sync starts its 30 days again; it is counted, 5 a year, by the caller),
 * and any row older than 30 days is skipped; on the paid plan rows keep their times and are skipped
 * only when older than their service's retention period.
 */
export async function importRecords(db: D1Like, tenant: string, bundle: RecordsBundle, { plan, now = new Date() }: { plan: "free" | "paid"; now?: Date }): Promise<ImportReport> {
  const report: ImportReport = { added: { cases: 0, case_events: 0, service_events: 0 }, already: { cases: 0, case_events: 0, service_events: 0 }, expired: 0, missingServices: [] };
  // Each exported service → this business's entry for the same document, and how long its records live here.
  const here = new Map<string, { id: string; days: number }>();
  for (const s of bundle.services) {
    const row = await db.prepare("SELECT id, retain_days FROM library_entries WHERE tenant_id = ?1 AND doc_id = ?2 AND kind = 'service' ORDER BY created_at LIMIT 1").bind(tenant, s.doc_id).first<{ id: string; retain_days: number | null }>();
    if (row) here.set(s.entry_id, { id: row.id, days: plan === "paid" ? (retainDaysOf(row.retain_days) ?? TRANSIENT_DAYS) : TRANSIENT_DAYS });
    else report.missingServices.push(s.title);
  }
  const old = (at: string, days: number) => Date.parse(at) < now.getTime() - days * DAY_MS;

  const cases: Record<string, unknown>[] = [];
  const kept = new Set<string>();
  for (const c of bundle.cases) {
    const svc = here.get(c.entry_id);
    if (!svc) continue;
    if (plan === "free" ? false : old(c.created_at, svc.days)) { report.expired++; continue; }
    cases.push({ ...c, entry_id: svc.id, created_at: plan === "free" ? now.toISOString() : c.created_at });
    kept.add(c.id);
  }
  // Events belong to their case: they are written only for a case that came in with them, or is already here.
  const inBundle = new Set(bundle.cases.map((c) => c.id));
  const events = bundle.case_events.filter((e) => kept.has(e.case_id) || !inBundle.has(e.case_id));
  const serviceEvents: Record<string, unknown>[] = [];
  for (const e of bundle.service_events) {
    const svc = here.get(e.service);
    if (!svc) continue;
    if (old(e.at, svc.days)) { report.expired++; continue; }
    serviceEvents.push({ ...e, service: svc.id });
  }
  const asked = { cases: cases.length, case_events: events.length, service_events: serviceEvents.length };
  report.added.cases = await insertBatches(db, "cases", CASE_COLS, cases, { sql: ", tenant_id", select: ", ?2", args: [tenant] });
  report.added.case_events = await insertBatches(db, "case_events", CASE_EVENT_COLS, events, { sql: "", select: "", args: [tenant] });
  report.added.service_events = await insertBatches(db, "service_events", SERVICE_EVENT_COLS, serviceEvents, { sql: ", tenant_id", select: ", ?2", args: [tenant] });
  report.already = { cases: asked.cases - report.added.cases, case_events: asked.case_events - report.added.case_events, service_events: asked.service_events - report.added.service_events };
  return report;
}
