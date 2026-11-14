// Cases kept on this device (LIB-42..48): when the kiosk keeps requests on its devices (no paid
// central storage), each device that works on a case keeps its copy here, with its thread, and
// what it sent and how far that got (deliveries), so it can send it again. IndexedDB, or memory
// when IndexedDB is unavailable (private windows). Framework-free.
import type { Case, CaseEvent, CaseStore, CaseSummary, Delivery } from "@sekaran-ind/yaxb-core/cases";

const DB = "yaxb-cases";
let dbPromise: Promise<IDBDatabase | null> | null = null;
const mem = { cases: new Map<string, Case>(), events: new Map<string, CaseEvent>(), deliveries: new Map<string, Delivery & { case_id: string }>() };

function db(): Promise<IDBDatabase | null> {
  return (dbPromise ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore("cases", { keyPath: "id" }).createIndex("ref", "ref", { unique: true });
        d.createObjectStore("events", { keyPath: "id" }).createIndex("case", "case_id");
        d.createObjectStore("deliveries", { keyPath: "envelope" }).createIndex("case", "case_id");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  }));
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T | undefined> {
  return db().then(
    (d) =>
      new Promise((resolve) => {
        if (!d) return resolve(undefined);
        const tx = d.transaction(store, mode);
        const r = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(r ? (r.result as T) : undefined);
        tx.onerror = () => resolve(undefined);
      }),
  );
}
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const summaryOf = ({ run: _r, journey: _j, ...rest }: Case): CaseSummary => rest;

/** This device's cases, as a CaseStore (the core's case service runs over it). */
export const localCaseStore: CaseStore = {
  async put(c) {
    if (!(await db())) return void mem.cases.set(c.id, copy(c));
    await run("cases", "readwrite", (s) => void s.put(copy(c)));
  },
  async get(id) {
    if (!(await db())) return mem.cases.has(id) ? copy(mem.cases.get(id)!) : null;
    return (await run<Case>("cases", "readonly", (s) => s.get(id))) ?? null;
  },
  async byRef(ref) {
    if (!(await db())) return copy([...mem.cases.values()].find((c) => c.ref === ref) ?? null);
    return (await run<Case>("cases", "readonly", (s) => s.index("ref").get(ref))) ?? null;
  },
  async list({ open, startedBy, limit }) {
    const all = (await db()) ? ((await run<Case[]>("cases", "readonly", (s) => s.getAll())) ?? []) : [...mem.cases.values()];
    return all
      .filter((c) => (open ? c.status === "waiting" || c.status === "to_finish" : true) && (startedBy === undefined || c.started_by === startedBy))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, limit)
      .map((c) => summaryOf(copy(c)));
  },
  async addEvent(e) {
    if (!(await db())) return void mem.events.set(e.id, { ...e });
    await run("events", "readwrite", (s) => void s.put({ ...e }));
  },
  async events(caseId) {
    const all = (await db()) ? ((await run<CaseEvent[]>("events", "readonly", (s) => s.index("case").getAll(caseId))) ?? []) : [...mem.events.values()].filter((e) => e.case_id === caseId);
    return all.sort((a, b) => a.at.localeCompare(b.at));
  },
};

/** Every case on this device (for its beacons and the moderator's resend). */
export async function allLocalCases(): Promise<Case[]> {
  return (await db()) ? ((await run<Case[]>("cases", "readonly", (s) => s.getAll())) ?? []) : [...mem.cases.values()].map(copy);
}

export async function saveDelivery(caseId: string, d: Delivery) {
  if (!(await db())) return void mem.deliveries.set(d.envelope, { ...d, case_id: caseId });
  await run("deliveries", "readwrite", (s) => void s.put({ ...d, case_id: caseId }));
}
/** What this device sent for a case, newest first. */
export async function deliveriesOf(caseId: string): Promise<Delivery[]> {
  const all = (await db())
    ? ((await run<(Delivery & { case_id: string })[]>("deliveries", "readonly", (s) => s.index("case").getAll(caseId))) ?? [])
    : [...mem.deliveries.values()].filter((d) => d.case_id === caseId);
  return all.sort((a, b) => b.sent_at.localeCompare(a.sent_at));
}

// ---- this device ----------------------------------------------------------------------------------

const DEVICE_KEY = "yaxb.device";
let device: { secret: string; id: string } | null = null;

/**
 * This device's identity for handing cases over: a secret kept in this browser, and its id (the
 * SHA-256 of the secret, as the Worker computes it), which is how an envelope addresses a device.
 */
export async function thisDevice(): Promise<{ secret: string; id: string }> {
  if (device) return device;
  let secret = "";
  try {
    secret = localStorage.getItem(DEVICE_KEY) ?? "";
  } catch {
    /* private mode: a new identity for this page */
  }
  if (secret.length < 32) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    secret = btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, (ch) => ({ "+": "-", "/": "_", "=": "" })[ch]!);
    try {
      localStorage.setItem(DEVICE_KEY, secret);
    } catch {
      /* private mode */
    }
  }
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const id = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
  return (device = { secret, id });
}
