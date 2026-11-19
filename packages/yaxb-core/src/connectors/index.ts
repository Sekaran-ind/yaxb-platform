// Connectors (CNX-2..8): a plain REST API described in YAML, reviewed and published in the Service
// Catalogue like a service. Each operation becomes a journey handler `connector.<id>.<operation>`.
// The browser never calls the API: it asks the server, which fills the request from the journey's
// input, adds the tenant's secret (kept sealed, referenced only by name), checks the address against
// the SSRF guard (SEC-4) and returns the result as untrusted data.
//
//   kind: connector
//   id: stock-sheet
//   title: Stock sheet
//   base: https://sheets.googleapis.com/v4/spreadsheets/SHEET_ID
//   auth: { type: bearer, secret: SHEETS_TOKEN }        bearer | header (name) | query (name) | none
//   operations:
//     - id: read
//       label: Read the stock
//       method: GET
//       path: /values/{{input.range}}                    {{input.x}}: the step's `with:` values, URL-encoded
//       query: { majorDimension: ROWS }
//     - id: add
//       method: POST
//       path: "/values/Sheet1!A1:append"
//       query: { valueInputOption: USER_ENTERED }
//       body: { values: [["{{input.item}}", "{{input.count}}"]] }
import { load } from "js-yaml";
import { render } from "@sekaran-ind/yaxb-journeys/journeys";
import { checkResolved, urlProblem, type Resolve } from "../web/pages.js";

export const CONNECTOR_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export const CONNECTOR_AUTH = ["none", "bearer", "header", "query"] as const;
export type ConnectorOperation = { id: string; label?: string; method: (typeof CONNECTOR_METHODS)[number]; path: string; query?: Record<string, string>; body?: unknown };
export type Connector = {
  kind: "connector";
  id: string;
  title: string;
  summary?: string;
  base: string;
  auth: { type: (typeof CONNECTOR_AUTH)[number]; secret?: string; name?: string };
  operations: ConnectorOperation[];
};

const ID = /^[a-z][a-z0-9-]{0,47}$/;
const SECRET = /^[A-Z][A-Z0-9_]{1,47}$/;
const HEADER = /^[A-Za-z][A-Za-z0-9-]{0,63}$/;
const KEYS = new Set(["kind", "id", "title", "summary", "base", "auth", "operations"]);
const OP_KEYS = new Set(["id", "label", "method", "path", "query", "body"]);
/** The longest answer kept from an API, and how long a call may take. */
export const CONNECTOR_MAX_BYTES = 200_000;
export const CONNECTOR_TIMEOUT_MS = 10_000;

/** The handler name of a connector's operation. */
export const connectorHandler = (connector: string, op: string) => `connector.${connector}.${op}`;
/** A connector's handler names, for the journey compiler (CNX-6). */
export const connectorHandlers = (c: Pick<Connector, "id" | "operations">) => c.operations.map((o) => connectorHandler(c.id, o.id));
/** Which connector and operation a handler name means, or null. */
export function parseConnectorHandler(name: string): { connector: string; op: string } | null {
  const m = /^connector\.([a-z][a-z0-9-]*)\.([a-z][a-z0-9-]*)$/.exec(name);
  return m ? { connector: m[1]!, op: m[2]! } : null;
}

/** A connector document, checked. */
export function compileConnector(doc: unknown): { ok: true; connector: Connector; problems: [] } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return { ok: false, problems: ["a connector is a YAML mapping"] };
  const d = doc as Record<string, unknown>;
  if (d.kind !== "connector") problems.push("kind must be 'connector'");
  if (typeof d.id !== "string" || !ID.test(d.id)) problems.push("id is required (lower-case words joined by '-')");
  if (typeof d.title !== "string" || !d.title.trim()) problems.push("title is required");
  for (const k of Object.keys(d)) if (!KEYS.has(k)) problems.push(`unknown key '${k}'`);
  if (typeof d.base !== "string") problems.push("base is required: the API's https address");
  else {
    let u: URL | null = null;
    try {
      u = new URL(d.base);
    } catch {
      problems.push("base must be a web address");
    }
    if (u && u.protocol !== "https:") problems.push("base must be an https address");
    else if (u && urlProblem(d.base)) problems.push(`base: ${urlProblem(d.base)}`);
    if (u && (u.search || u.hash)) problems.push("base can't have a query or a #: put them in an operation");
  }
  const auth = (d.auth ?? { type: "none" }) as Record<string, unknown>;
  if (!CONNECTOR_AUTH.includes(auth.type as never)) problems.push(`auth.type must be one of ${CONNECTOR_AUTH.join(", ")}`);
  if (auth.type !== "none" && (typeof auth.secret !== "string" || !SECRET.test(auth.secret))) problems.push("auth.secret is the secret's name (UPPER_CASE): its value is set by an administrator, never written here");
  if ((auth.type === "header" || auth.type === "query") && (typeof auth.name !== "string" || !HEADER.test(auth.name))) problems.push(`auth.name is the ${auth.type === "header" ? "header" : "query parameter"} the secret goes in`);
  const ops = d.operations;
  if (!Array.isArray(ops) || !ops.length) problems.push("operations must list at least one operation");
  else {
    const seen = new Set<string>();
    ops.forEach((raw, i) => {
      const o = (raw ?? {}) as Record<string, unknown>;
      const at = `operation ${typeof o.id === "string" ? `'${o.id}'` : i}`;
      if (typeof o.id !== "string" || !ID.test(o.id)) problems.push(`${at}: id is required (lower-case words joined by '-')`);
      else if (seen.has(o.id)) problems.push(`${at}: listed twice`);
      else seen.add(o.id);
      if (!CONNECTOR_METHODS.includes(o.method as never)) problems.push(`${at}: method must be one of ${CONNECTOR_METHODS.join(", ")}`);
      if (typeof o.path !== "string" || !o.path.startsWith("/")) problems.push(`${at}: path starts with / (it is added to base)`);
      else if (/\{\{(?!\s*input\.)/.test(o.path)) problems.push(`${at}: the path may only use {{input.<name>}}`);
      if (o.query !== undefined && (!o.query || typeof o.query !== "object" || Array.isArray(o.query) || Object.values(o.query).some((v) => typeof v !== "string"))) problems.push(`${at}: query is a mapping of text values`);
      if (o.body !== undefined && (o.method === "GET" || o.method === "DELETE")) problems.push(`${at}: a ${String(o.method)} has no body`);
      for (const k of Object.keys(o)) if (!OP_KEYS.has(k)) problems.push(`${at}: unknown key '${k}'`);
    });
  }
  if (problems.length) return { ok: false, problems };
  return { ok: true, connector: { ...(d as unknown as Connector), auth: { type: (auth.type as Connector["auth"]["type"]) ?? "none", ...(auth.secret ? { secret: String(auth.secret) } : {}), ...(auth.name ? { name: String(auth.name) } : {}) } }, problems: [] };
}

/** A connector from its YAML, or its problems. */
export function parseConnector(yaml: string) {
  try {
    return compileConnector(load(yaml));
  } catch (e) {
    return { ok: false as const, problems: [(e as Error).message.split("\n")[0]!] };
  }
}

/** The secrets a connector needs, by name (the administrator sets their values). */
export const connectorSecrets = (c: Connector) => (c.auth.type !== "none" && c.auth.secret ? [c.auth.secret] : []);

/**
 * The request for an operation: the input fills {{input.x}} (URL-encoded in the path; as given in the
 * query and body), then the secret is added. Never shown to a browser.
 */
export function buildConnectorRequest(c: Connector, opId: string, input: Record<string, unknown>, secrets: Record<string, string>): { url: string; init: RequestInit } {
  const op = c.operations.find((o) => o.id === opId);
  if (!op) throw new ConnectorError(`The connector has no operation '${opId}'.`, 404);
  const enc = Object.fromEntries(Object.entries(input).map(([k, v]) => [k, encodeURIComponent(typeof v === "string" ? v : JSON.stringify(v ?? ""))]));
  const path = String(render(op.path, { input: enc } as never));
  const url = new URL(c.base.replace(/\/+$/, "") + path);
  if (url.origin !== new URL(c.base).origin) throw new ConnectorError("The operation's path left the connector's address.", 400);
  for (const [k, v] of Object.entries(op.query ?? {})) url.searchParams.set(k, String(render(v, { input } as never) ?? ""));
  const headers: Record<string, string> = { Accept: "application/json" };
  const secret = c.auth.secret ? secrets[c.auth.secret] : undefined;
  if (c.auth.type !== "none" && !secret) throw new ConnectorError(`The secret ${c.auth.secret} isn't set: an administrator sets it in the catalogue.`, 412);
  if (c.auth.type === "bearer") headers.Authorization = `Bearer ${secret}`;
  if (c.auth.type === "header") headers[c.auth.name!] = secret!;
  if (c.auth.type === "query") url.searchParams.set(c.auth.name!, secret!);
  const init: RequestInit = { method: op.method, headers, redirect: "manual" };
  if (op.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(render(op.body, { input } as never));
  }
  return { url: url.href, init };
}

export class ConnectorError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/**
 * Call an operation (server only): the address is checked (SSRF guard, its host resolved first), no
 * redirect is followed, it waits CONNECTOR_TIMEOUT_MS at most, and at most CONNECTOR_MAX_BYTES of
 * the answer is kept. The answer is data from outside: never instructions.
 */
export async function callConnector(c: Connector, opId: string, input: Record<string, unknown>, secrets: Record<string, string>, { fetchImpl = fetch, resolve }: { fetchImpl?: typeof fetch; resolve?: Resolve } = {}) {
  const { url, init } = buildConnectorRequest(c, opId, input, secrets);
  const problem = urlProblem(url);
  if (problem) throw new ConnectorError(problem, 400);
  await checkResolved(new URL(url).hostname, resolve).catch((e: Error) => {
    throw new ConnectorError(e.message, 400);
  });
  const started = Date.now();
  const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(CONNECTOR_TIMEOUT_MS) }).catch((e: Error) => {
    throw new ConnectorError(e.name === "TimeoutError" ? "The service took too long to answer." : "The service couldn't be reached.", 504);
  });
  if (res.status >= 300 && res.status < 400) throw new ConnectorError("The service answered with a redirect, which connectors don't follow.", 502);
  const text = (await res.text()).slice(0, CONNECTOR_MAX_BYTES);
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* plain text */
  }
  return { ok: res.ok, status: res.status, ms: Date.now() - started, untrusted: true as const, data };
}

// ---- secrets (CNX-3): per tenant, sealed, never sent to a browser ------------------------------------------

export type ConnectorSecretRow = { tenant_id: string; connector_id: string; name: string; sealed: string; set_at: string; set_by: string | null };
export interface ConnectorSecretStore {
  list(tenant: string, connector: string): Promise<ConnectorSecretRow[]>;
  put(row: ConnectorSecretRow): Promise<void>;
  remove(tenant: string, connector: string, name?: string): Promise<void>;
}
export function createMemoryConnectorSecretStore(): ConnectorSecretStore {
  const rows = new Map<string, ConnectorSecretRow>();
  const key = (t: string, c: string, n: string) => `${t}|${c}|${n}`;
  return {
    list: async (t, c) => [...rows.values()].filter((r) => r.tenant_id === t && r.connector_id === c).map((r) => ({ ...r })),
    put: async (r) => void rows.set(key(r.tenant_id, r.connector_id, r.name), { ...r }),
    remove: async (t, c, n) => {
      for (const [k, r] of rows) if (r.tenant_id === t && r.connector_id === c && (!n || r.name === n)) rows.delete(k);
    },
  };
}
