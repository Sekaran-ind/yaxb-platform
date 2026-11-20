// Connectors (CNX-2..8): a REST API in YAML; requests built on the server with the secret; the SSRF
// guard; answers as untrusted data.
import { describe, expect, it } from "vitest";
import { buildConnectorRequest, callConnector, connectorHandlers, connectorSecrets, parseConnector, parseConnectorHandler, mcpServerOfConnector, guardedFetch } from "../src/connectors/index.js";
import { createD1ConnectorSecretStore } from "../src/stores/d1.js";
import { sqliteD1 } from "./sqlite-d1.js";

const SHEET = `kind: connector
id: stock-sheet
title: Stock sheet
base: https://sheets.example.com/v4/spreadsheets/abc
auth: { type: bearer, secret: SHEETS_TOKEN }
operations:
  - id: read
    method: GET
    path: /values/{{input.range}}
    query: { majorDimension: ROWS }
  - id: add
    method: POST
    path: "/values/Sheet1!A1:append"
    query: { valueInputOption: USER_ENTERED }
    body: { values: [["{{input.item}}", "{{input.count}}"]] }
`;
const sheet = () => {
  const r = parseConnector(SHEET);
  if (!r.ok) throw new Error(r.problems.join("; "));
  return r.connector;
};

describe("connectors", () => {
  it("checks a connector document", () => {
    const c = sheet();
    expect(connectorHandlers(c)).toEqual(["connector.stock-sheet.read", "connector.stock-sheet.add"]);
    expect(connectorSecrets(c)).toEqual(["SHEETS_TOKEN"]);
    expect(parseConnectorHandler("connector.stock-sheet.add")).toEqual({ connector: "stock-sheet", op: "add" });
    const bad = parseConnector(SHEET.replace("https://sheets.example.com", "http://sheets.example.com").replace("secret: SHEETS_TOKEN", "secret: sk-live-123").replace("method: GET", "method: FETCH"));
    expect(bad.ok).toBe(false);
    const text = (bad as { problems: string[] }).problems.join("\n");
    expect(text).toMatch(/https/);
    expect(text).toMatch(/secret's name/);
    expect(text).toMatch(/method must be/);
    expect(parseConnector(SHEET.replace("https://sheets.example.com/v4", "https://localhost/v4")).ok).toBe(false);
    expect((parseConnector(SHEET.replace("/values/{{input.range}}", "/values/{{answers.x}}")) as { problems: string[] }).problems.join()).toMatch(/only use \{\{input/);
  });

  it("builds the request on the server: input URL-encoded in the path, the secret only where it belongs", () => {
    const r = buildConnectorRequest(sheet(), "read", { range: "Sheet1!A1:B9/../../x" }, { SHEETS_TOKEN: "tok" });
    expect(r.url).toBe("https://sheets.example.com/v4/spreadsheets/abc/values/Sheet1!A1%3AB9%2F..%2F..%2Fx?majorDimension=ROWS");
    expect((r.init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(r.init.redirect).toBe("manual");
    const add = buildConnectorRequest(sheet(), "add", { item: "Rice", count: 4 }, { SHEETS_TOKEN: "tok" });
    expect(JSON.parse(String(add.init.body))).toEqual({ values: [["Rice", 4]] });
    expect(() => buildConnectorRequest(sheet(), "read", { range: "x" }, {})).toThrow(/isn't set/);
    expect(() => buildConnectorRequest(sheet(), "nope", {}, {})).toThrow(/no operation/);
  });

  it("calls through the guard, follows no redirect, and returns untrusted data", async () => {
    const seen: string[] = [];
    const fake: typeof fetch = async (input) => {
      seen.push(String(input));
      return Response.json({ values: [["Rice", "4"]] });
    };
    const r = await callConnector(sheet(), "read", { range: "A1" }, { SHEETS_TOKEN: "tok" }, { fetchImpl: fake, resolve: async () => ["93.184.216.34"] });
    expect(r).toMatchObject({ ok: true, status: 200, untrusted: true, data: { values: [["Rice", "4"]] } });
    await expect(callConnector(sheet(), "read", { range: "A1" }, { SHEETS_TOKEN: "tok" }, { fetchImpl: fake, resolve: async () => ["10.0.0.5"] })).rejects.toThrow(/local network/);
    const redirect: typeof fetch = async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } });
    await expect(callConnector(sheet(), "read", { range: "A1" }, { SHEETS_TOKEN: "tok" }, { fetchImpl: redirect, resolve: async () => ["93.184.216.34"] })).rejects.toThrow(/redirect/);
    expect(seen).toHaveLength(1);
  });

  it("keeps secrets per tenant on D1", async () => {
    const store = createD1ConnectorSecretStore(sqliteD1());
    await store.put({ tenant_id: "t1", connector_id: "stock-sheet", name: "SHEETS_TOKEN", sealed: "sealed-1", set_at: "2026-11-20", set_by: "Admin" });
    await store.put({ tenant_id: "t2", connector_id: "stock-sheet", name: "SHEETS_TOKEN", sealed: "sealed-2", set_at: "2026-11-20", set_by: null });
    expect((await store.list("t1", "stock-sheet")).map((r) => r.sealed)).toEqual(["sealed-1"]);
    await store.remove("t1", "stock-sheet");
    expect(await store.list("t1", "stock-sheet")).toEqual([]);
    expect(await store.list("t2", "stock-sheet")).toHaveLength(1);
  });
});

describe("connectors as places data goes (CNX-7)", () => {
  it("says so in a journey's privacy line, and never calls it the assistant", async () => {
    const { compileBundle } = await import("@sekaran-ind/yaxb-journeys/bundle");
    const { summarizeJourney } = await import("../src/journeys/summary.js");
    const b = compileBundle(`kind: service
id: stock
title: Stock
journeys:
  - id: add-stock
    title: Add stock
    screens:
      - { id: what, title: What, questions: [{ id: item, type: text, label: Item, required: true }] }
      - { id: save, title: Save, service: connector.stock-sheet.add, with: { item: "{{answers.what.item}}" } }
      - { id: done, result: { title: Added } }
`);
    const s = summarizeJourney(b.journeys[0]!);
    expect(s.leavesDevice).toBe(true);
    expect(s.privacy).toMatch(/sent to stock sheet, an outside service/);
    expect(s.privacy).not.toMatch(/AI assistant/);
  });
});

describe("a business's own MCP server (CNX-1)", () => {
  const YAML = `kind: connector
id: our-docs
title: Our docs
summary: The shop's product notes.
mcp: { url: "https://mcp.example.com/mcp", tools: [search_docs] }
auth: { type: bearer, secret: DOCS_TOKEN }
`;
  it("is a connector with mcp instead of operations, and becomes a server with its secret", () => {
    const r = parseConnector(YAML);
    if (!r.ok) throw new Error(r.problems.join());
    expect(r.connector).toMatchObject({ base: "https://mcp.example.com/mcp", operations: [], mcp: { url: "https://mcp.example.com/mcp", tools: ["search_docs"] } });
    expect(connectorHandlers(r.connector)).toEqual([]);
    expect(connectorSecrets(r.connector)).toEqual(["DOCS_TOKEN"]);
    expect(mcpServerOfConnector(r.connector, {})).toBeNull();
    expect(mcpServerOfConnector(r.connector, { DOCS_TOKEN: "t" })).toEqual({ id: "org-our-docs", label: "Our docs", description: "The shop's product notes.", url: "https://mcp.example.com/mcp", headers: { Authorization: "Bearer t" }, tools: ["search_docs"] });
  });
  it("refuses plain http, private addresses, query auth and operations beside mcp", () => {
    const bad = (y: string) => {
      const r = parseConnector(y);
      return r.ok ? "" : r.problems.join(" | ");
    };
    expect(bad(YAML.replace("https://mcp.example.com", "http://mcp.example.com"))).toMatch(/https/);
    expect(bad(YAML.replace("https://mcp.example.com", "https://10.0.0.2"))).toMatch(/mcp.url/);
    expect(bad(YAML.replace("type: bearer", "type: query, name: key"))).toMatch(/none, bearer or header/);
    expect(bad(`${YAML}operations: []\n`)).toMatch(/not base or operations/);
  });
  it("guards every request: a private address is refused before it is fetched", async () => {
    let fetched = 0;
    const f = guardedFetch(async () => ["192.168.0.9"], (async () => (fetched++, new Response("{}"))) as unknown as typeof fetch);
    await expect(f("https://inside.example.com/mcp", { method: "POST" })).rejects.toThrow();
    expect(fetched).toBe(0);
    const ok = guardedFetch(async () => ["93.184.216.34"], (async (_u: string, init: RequestInit) => (fetched++, new Response(init.redirect ?? ""))) as unknown as typeof fetch);
    expect(await (await ok("https://mcp.example.com/mcp", { method: "POST" })).text()).toBe("error");
  });
});
