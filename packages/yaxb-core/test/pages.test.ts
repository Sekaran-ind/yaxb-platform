// Websites as notebook sources (KNW-20..24, SEC-4): the fetch must never reach the kiosk's own
// network, and must keep only a page's readable text.
import { describe, expect, it } from "vitest";
import { webSourcesLine } from "../src/agent/index.js";
import { notebookFiles, notebookSchema } from "../src/notebook/index.js";
import { resolveRetrieved } from "../src/knowledge/semantic.js";
import { BLOCKED_BY_ORGANISATION, BLOCKED_UNSAFE, checkResolved, fetchPage, fetchSite, isPrivateAddress, NOT_ON_ALLOWLIST, parseIPv4, readableText, siteGuard, siteRulesFromEnv, urlProblem, type Resolve } from "../src/web/pages.js";

const publicDns: Resolve = async () => ["93.184.216.34"];
const html = (body: string, head = "<title>Holiday pay | Labour Office</title>") => `<!doctype html><html lang="en"><head>${head}</head><body>${body}</body></html>`;
function fakeFetch(routes: Record<string, () => Response>) {
  const asked: string[] = [];
  const f = (async (url: string) => {
    asked.push(url);
    const r = routes[url];
    if (!r) throw new Error(`no route for ${url}`);
    return r();
  }) as unknown as typeof fetch;
  return { f, asked };
}
const page = (body: string, headers: Record<string, string> = {}) => () => new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8", ...headers } });

describe("addresses the kiosk must never fetch", () => {
  it("in every spelling of a private, local or metadata address", () => {
    for (const host of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.14", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fc00::1", "fe80::1", "::ffff:192.168.1.1", "::ffff:c0a8:0101", "[::1]"]) expect(isPrivateAddress(host), host).toBe(true);
    for (const host of ["2130706433", "0x7f000001", "0177.0.0.1", "127.1"]) expect(isPrivateAddress(host), host).toBe(true);
    for (const host of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:4700::1111"]) expect(isPrivateAddress(host), host).toBe(false);
    expect(parseIPv4("2130706433")).toEqual([127, 0, 0, 1]);
    expect(parseIPv4("who.int")).toBeNull();
  });

  it("refuses local names, other schemes, credentials and odd ports", () => {
    expect(urlProblem("https://who.int/news")).toBeNull();
    for (const u of ["http://localhost/", "http://localhost:3000/", "http://router.local/", "http://intranet/", "http://192.168.1.1/admin", "http://[::1]/", "http://2130706433/", "http://kiosk.home.arpa/"]) expect(urlProblem(u), u).toMatch(/local network/);
    expect(urlProblem("file:///etc/passwd")).toMatch(/Only http/);
    expect(urlProblem("ftp://example.org/x")).toMatch(/Only http/);
    expect(urlProblem("https://user:pass@example.org/")).toMatch(/user name/);
    expect(urlProblem("https://example.org:22/")).toMatch(/port/);
    expect(urlProblem("not a url")).toMatch(/isn't a web address/);
  });

  it("refuses a public name that resolves to a private address (DNS rebinding)", async () => {
    await expect(checkResolved("evil.example", async () => ["10.0.0.5"])).rejects.toThrow(/local network/);
    await expect(checkResolved("ok.example", async () => ["93.184.216.34", "::ffff:127.0.0.1"])).rejects.toThrow(/local network/);
    await expect(checkResolved("ok.example", publicDns)).resolves.toBeUndefined();
    await expect(checkResolved("gone.example", async () => [])).rejects.toThrow(/couldn't be found/);
  });

  it("checks every redirect again", async () => {
    const { f, asked } = fakeFetch({
      "https://short.example/x": () => new Response(null, { status: 302, headers: { location: "http://192.168.1.14:47870/notebooks" } }),
    });
    await expect(fetchPage("https://short.example/x", { fetch: f, resolve: publicDns })).rejects.toThrow(/local network/);
    expect(asked).toEqual(["https://short.example/x"]); // the private address was never requested
  });
});

describe("fetching a page", () => {
  it("keeps the readable text of the page's main content, with its title, language and headings", async () => {
    const body = `<nav><a href="/">Home</a> Menu</nav><header>Site header</header><main><h1>Holiday pay</h1><p>Employees who work on a public holiday are paid <b>twice</b> their normal daily wage.</p><script>alert(1)</script><ul><li>Apply within 30 days</li><li>Ask HR &amp; payroll</li></ul></main><footer>© 2026</footer>`;
    const { f } = fakeFetch({ "https://labour.example/holiday": page(html(body)) });
    const p = await fetchPage("https://labour.example/holiday", { fetch: f, resolve: publicDns });
    expect(p.title).toBe("Holiday pay | Labour Office");
    expect(p.language).toBe("en");
    expect(p.text).toContain("# Holiday pay");
    expect(p.text).toContain("Employees who work on a public holiday are paid twice their normal daily wage.");
    expect(p.text).toContain("- Ask HR & payroll");
    expect(p.text).not.toMatch(/alert|Menu|Site header|© 2026/);
  });

  it("follows a redirect to a public page, and refuses big pages, other file types and empty pages", async () => {
    const { f } = fakeFetch({
      "https://a.example/": () => new Response(null, { status: 301, headers: { location: "/final" } }),
      "https://a.example/final": page(html("<p>Hello there</p>")),
      "https://a.example/big": page("x", { "content-length": "3000000" }),
      "https://a.example/huge": () => new Response("y".repeat(2_000_001), { headers: { "content-type": "text/html" } }),
      "https://a.example/pdf": () => new Response("%PDF", { headers: { "content-type": "application/pdf" } }),
      "https://a.example/empty": page(html("<script>x()</script>")),
    });
    expect((await fetchPage("https://a.example/", { fetch: f, resolve: publicDns })).url).toBe("https://a.example/final");
    await expect(fetchPage("https://a.example/big", { fetch: f, resolve: publicDns })).rejects.toThrow(/too large/);
    await expect(fetchPage("https://a.example/huge", { fetch: f, resolve: publicDns })).rejects.toThrow(/too large/);
    await expect(fetchPage("https://a.example/pdf", { fetch: f, resolve: publicDns })).rejects.toThrow(/Only web pages/);
    await expect(fetchPage("https://a.example/empty", { fetch: f, resolve: publicDns })).rejects.toThrow(/no readable text/);
  });

  it("can include pages linked from it on the same site, up to the limit", async () => {
    const links = '<main><p>Index</p><a href="/a">A</a><a href="https://a.example/b#top">B</a><a href="https://elsewhere.example/c">C</a><a href="/a">A again</a></main>';
    const { f, asked } = fakeFetch({
      "https://a.example/": page(html(links)),
      "https://a.example/a": page(html("<p>Page A</p>")),
      "https://a.example/b": () => new Response("nope", { status: 404 }),
    });
    const site = await fetchSite("https://a.example/", 5, { fetch: f, resolve: publicDns });
    expect(site.pages.map((p) => p.url)).toEqual(["https://a.example/", "https://a.example/a"]);
    expect(site.skipped).toBe(1);
    expect(asked).not.toContain("https://elsewhere.example/c");
  });

  it("decodes entities and tables into plain text", () => {
    const r = readableText(html("<table><tr><th>Day</th><th>Pay</th></tr><tr><td>Holiday</td><td>2&times;</td></tr></table><p>&#8377;500 &ndash; fixed</p>"), "https://x.example/");
    expect(r.text).toContain("Day | Pay |");
    expect(r.text).toContain("₹500 – fixed");
  });
});

describe("a website in the notebook", () => {
  const notebook = notebookSchema.parse({
    id: "nb1",
    title: "Work",
    sources: [{ id: "pay", title: "Holiday pay", mime: "text/html", text: "Employees who work on a public holiday are paid twice.", addedAt: "2026-11-12T00:00:00Z", url: "https://labour.example/holiday", fetchedAt: "2026-11-12T10:00:00Z" }],
  });

  it("only takes http(s) addresses", () => {
    expect(notebookSchema.safeParse({ ...notebook, sources: [{ ...notebook.sources[0], url: "javascript:alert(1)" }] }).success).toBe(false);
  });

  it("shows its address to the agent, in the index, the file and retrieved passages", () => {
    const files = notebookFiles(notebook);
    expect(files["/notebook/README.md"]!.content.join("\n")).toContain("website https://labour.example/holiday, read 2026-11-12");
    expect(files["/notebook/sources/pay.md"]!.content.join("\n")).toContain("Website: https://labour.example/holiday");
    expect(resolveRetrieved([{ ref: "notebook:pay#1", score: 0.9 }], notebook)[0]!.content).toContain("Website: https://labour.example/holiday");
  });

  it("is cited with its address after the answer (KNW-23)", () => {
    expect(webSourcesLine("Paid twice (sources: notebook:pay)", { "notebook:pay": "https://labour.example/holiday" })).toBe("\n\n(sources: notebook:pay · labour.example/holiday)");
  });
});

describe("which sites may be added (KNW-25..28)", () => {
  it("refuses a site the family resolver blocks (malware, phishing, adult content)", async () => {
    await expect(checkResolved("malware.testcategory.com", async () => ["0.0.0.0"])).rejects.toThrow(BLOCKED_UNSAFE);
    await expect(checkResolved("nudity.testcategory.com", async () => ["::"])).rejects.toThrow(BLOCKED_UNSAFE);
  });

  it("follows the organisation's allowlist and blocklist, subdomains included, on every redirect", async () => {
    const guard = siteGuard({ allow: ["who.int", "mohfw.gov.in"], block: ["bad.who.int"] });
    await expect(guard(new URL("https://www.who.int/x"))).resolves.toBeUndefined();
    await expect(guard(new URL("https://bad.who.int/x"))).rejects.toThrow(BLOCKED_BY_ORGANISATION);
    await expect(guard(new URL("https://notwho.int/x"))).rejects.toThrow(NOT_ON_ALLOWLIST);
    const { f } = fakeFetch({ "https://www.who.int/go": () => new Response(null, { status: 302, headers: { location: "https://example.com/" } }) });
    await expect(fetchPage("https://www.who.int/go", { fetch: f, resolve: publicDns, check: guard })).rejects.toThrow(NOT_ON_ALLOWLIST);
  });

  it("asks Google Safe Browsing when configured, sending only the address, and refuses when it can't check", async () => {
    let sent: unknown = null;
    const safe = (matches: unknown[] | "down") =>
      (async (_u: string, init: RequestInit) => {
        sent = JSON.parse(String(init.body));
        return matches === "down" ? new Response("", { status: 503 }) : new Response(JSON.stringify(matches.length ? { matches } : {}));
      }) as unknown as typeof fetch;
    await expect(siteGuard({ safeBrowsingKey: "k", fetch: safe([]) })(new URL("https://www.who.int/"))).resolves.toBeUndefined();
    expect(sent).toMatchObject({ threatInfo: { threatEntries: [{ url: "https://www.who.int/" }] } });
    await expect(siteGuard({ safeBrowsingKey: "k", fetch: safe([{ threatType: "MALWARE" }]) })(new URL("https://x.example/"))).rejects.toThrow(BLOCKED_UNSAFE);
    await expect(siteGuard({ safeBrowsingKey: "k", fetch: safe("down") })(new URL("https://x.example/"))).rejects.toThrow(/couldn't be checked/);
  });

  it("reads the rules from the deployment's settings", () => {
    expect(siteRulesFromEnv({ WEBSITE_SOURCE_DOMAINS: "who.int, https://www.nhs.uk/, *.gov.in, nonsense", WEBSITE_BLOCKED_DOMAINS: "piracy.example", SAFE_BROWSING_API_KEY: " key " })).toEqual({
      allow: ["who.int", "www.nhs.uk", "gov.in"],
      block: ["piracy.example"],
      safeBrowsingKey: "key",
    });
    expect(siteRulesFromEnv({})).toEqual({ allow: [], block: [], safeBrowsingKey: undefined });
  });
});
