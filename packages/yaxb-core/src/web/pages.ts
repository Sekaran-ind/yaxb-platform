// Websites as notebook sources (docs/specs/03-knowledge.md KNW-20..24, 09 SEC-4): the server fetches
// a page the visitor names and keeps its readable text. The fetch must never become a way into the
// kiosk's own network, so:
//   - http(s) only, standard ports only;
//   - no private, local, link-local, carrier-grade NAT, multicast or metadata addresses, in any
//     spelling (dotted, decimal, hex, octal, IPv6, IPv4-mapped IPv6);
//   - host names are resolved first (DNS over HTTPS) and refused if any address is private;
//   - redirects are followed by hand and every hop is checked again;
//   - at most 2 MB and 10 seconds; HTML and plain text only.
// The page text is untrusted data, like any document (OVR-6).

export const PAGE_LIMITS = { maxBytes: 2_000_000, timeoutMs: 10_000, maxRedirects: 5, maxChars: 400_000, maxLinked: 5 } as const;

export class PageError extends Error {}

/** Resolves a host name to its IP addresses. */
export type Resolve = (host: string) => Promise<string[]>;

// ---- addresses ---------------------------------------------------------------------------------------

/** "2130706433", "0x7f.1", "0177.0.0.1" -> [127, 0, 0, 1], or null if it isn't an IPv4 literal. */
export function parseIPv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length < 1 || parts.length > 4) return null;
  const nums: number[] = [];
  for (const p of parts) {
    if (!/^(0x[0-9a-f]+|0[0-7]*|[1-9][0-9]*)$/i.test(p)) return null;
    nums.push(p.toLowerCase().startsWith("0x") ? parseInt(p, 16) : p.length > 1 && p.startsWith("0") ? parseInt(p, 8) : parseInt(p, 10));
  }
  // The last part fills the remaining bytes (inet_aton): "127.1" is 127.0.0.1, "2130706433" is too.
  const last = nums.pop()!;
  const bytes = [...nums];
  const room = 4 - nums.length;
  if (nums.some((n) => n > 255) || last >= 256 ** room) return null;
  for (let i = room - 1; i >= 0; i--) bytes.push(Math.floor(last / 256 ** i) % 256);
  return bytes;
}

function privateIPv4([a = 0, b = 0]: number[]): boolean {
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 || // this network, private, loopback, multicast and reserved
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, including cloud metadata (169.254.169.254)
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) || // IETF protocol assignments
    (a === 198 && (b === 18 || b === 19)) // benchmarking
  );
}

/** True for an address the kiosk must never fetch from (IPv4 or IPv6 literal). */
export function isPrivateAddress(address: string): boolean {
  const host = address.replace(/^\[|\]$/g, "").toLowerCase();
  if (host.includes(":")) {
    if (host === "::" || host === "::1") return true;
    const mapped = host.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/) ?? host.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mapped) {
      const v4 = mapped.length === 2 ? parseIPv4(mapped[1]!) : [parseInt(mapped[1]!, 16) >> 8, parseInt(mapped[1]!, 16) & 255, parseInt(mapped[2]!, 16) >> 8, parseInt(mapped[2]!, 16) & 255];
      return !v4 || privateIPv4(v4);
    }
    const first = parseInt(host.split(":")[0] || "0", 16);
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00; // unique local, link-local, multicast
  }
  const v4 = parseIPv4(host);
  return v4 ? privateIPv4(v4) : false;
}

const LOCAL_NAMES = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain|home\.arpa)$/i;

/** Why a URL may not be fetched, or null. Doesn't resolve names (see checkResolved). */
export function urlProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "That isn't a web address.";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "Only http and https addresses can be added.";
  if (url.username || url.password) return "Addresses with a user name or password can't be added.";
  const host = url.hostname.replace(/\.$/, "");
  if (!host.includes(".") && !host.includes(":")) return "That address is on a local network, which the kiosk can't fetch from.";
  if (LOCAL_NAMES.test(host) || isPrivateAddress(host)) return "That address is on a local network, which the kiosk can't fetch from.";
  if (url.port && !["80", "443", "8080", "8443"].includes(url.port)) return "That port can't be used.";
  return null;
}

/** Resolve a host and refuse it if any of its addresses is private (rebinding to the local network). */
export async function checkResolved(host: string, resolve?: Resolve): Promise<void> {
  if (!resolve || isPrivateAddress(host) || parseIPv4(host) || host.includes(":")) return;
  const addresses = await resolve(host).catch(() => {
    throw new PageError("That website's address couldn't be found.");
  });
  if (!addresses.length) throw new PageError("That website's address couldn't be found.");
  if (addresses.some(isPrivateAddress)) throw new PageError("That address is on a local network, which the kiosk can't fetch from.");
}

/** DNS over HTTPS (Cloudflare's resolver): A and AAAA records. */
export function dohResolver(fetchImpl: typeof fetch = (i, o) => fetch(i, o)): Resolve {
  return async (host) => {
    const ask = async (type: "A" | "AAAA") => {
      const r = await fetchImpl(`https://cloudflare-dns.com/dns-query?${new URLSearchParams({ name: host, type })}`, { headers: { Accept: "application/dns-json" } });
      if (!r.ok) throw new Error(`DNS ${r.status}`);
      const body = (await r.json()) as { Answer?: { type: number; data: string }[] };
      return (body.Answer ?? []).filter((a) => a.type === (type === "A" ? 1 : 28)).map((a) => a.data);
    };
    const [a, aaaa] = await Promise.all([ask("A"), ask("AAAA").catch(() => [])]);
    return [...a, ...aaaa];
  };
}

// ---- fetching ----------------------------------------------------------------------------------------

export type FetchedPage = { url: string; title: string; text: string; language: string | null; links: string[]; fetchedAt: string };

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new PageError("That page is too large (over 2 MB).");
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new PageError("That page is too large (over 2 MB).");
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  const charset = /charset=([\w-]+)/i.exec(res.headers.get("content-type") ?? "")?.[1] ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(all);
  } catch {
    return new TextDecoder("utf-8").decode(all);
  }
}

/** Fetch one page safely (see the header) and extract its readable text. */
export async function fetchPage(raw: string, { fetch: fetchImpl = (i, o) => fetch(i, o), resolve, limits = PAGE_LIMITS }: { fetch?: typeof fetch; resolve?: Resolve; limits?: typeof PAGE_LIMITS } = {}): Promise<FetchedPage> {
  let url = raw.trim();
  const signal = AbortSignal.timeout(limits.timeoutMs);
  for (let hop = 0; ; hop++) {
    const problem = urlProblem(url);
    if (problem) throw new PageError(problem);
    await checkResolved(new URL(url).hostname, resolve);
    let res: Response;
    try {
      res = await fetchImpl(url, { redirect: "manual", signal, headers: { Accept: "text/html,application/xhtml+xml,text/plain;q=0.8", "User-Agent": "YAXB-Kiosk/1.0 (+notebook source)" } });
    } catch (e) {
      throw new PageError(signal.aborted ? "That page took too long to load." : `That page couldn't be loaded (${(e as Error).message}).`);
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location || hop >= limits.maxRedirects) throw new PageError("That page redirects too many times.");
      url = new URL(location, url).toString();
      continue;
    }
    if (!res.ok) throw new PageError(`That page couldn't be loaded (HTTP ${res.status}).`);
    const type = (res.headers.get("content-type") ?? "").toLowerCase();
    const isHtml = type.includes("text/html") || type.includes("application/xhtml");
    if (!isHtml && !type.startsWith("text/plain") && !type.startsWith("text/markdown")) throw new PageError("Only web pages and plain text can be added (that is a different kind of file).");
    const body = await readCapped(res, limits.maxBytes);
    const page = isHtml ? readableText(body, url) : { title: new URL(url).pathname.split("/").pop() || new URL(url).hostname, text: body, language: null, links: [] };
    if (!page.text.trim()) throw new PageError("That page has no readable text.");
    return { url, ...page, text: page.text.slice(0, limits.maxChars), fetchedAt: new Date().toISOString() };
  }
}

// ---- readable text -------------------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", copy: "©", reg: "®", trade: "™", middot: "·", bull: "•" };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** A page's title, main text (headings as Markdown), language and same-site links. */
export function readableText(html: string, pageUrl: string): { title: string; text: string; language: string | null; links: string[] } {
  const title = decodeEntities(
    (/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i.exec(html)?.[1] ?? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? new URL(pageUrl).hostname).replace(/\s+/g, " ").trim(),
  ).slice(0, 200);
  const language = /<html[^>]*\slang=["']?([a-z]{2,3}(?:-[a-z0-9]+)?)/i.exec(html)?.[1] ?? null;
  let body = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<head\b[\s\S]*?<\/head>/i, " ");
  // Prefer the page's main content when it marks it.
  const main = /<main\b[\s\S]*?<\/main>/i.exec(body)?.[0] ?? /<article\b[\s\S]*?<\/article>/i.exec(body)?.[0];
  if (main) body = main;
  // Links on the same site, for "include linked pages" (KNW-22), before the markup goes.
  const site = new URL(pageUrl);
  const links = [
    ...new Set(
      [...body.matchAll(/<a\b[^>]*href=["']([^"'#]+)/gi)]
        .map((m) => {
          try {
            const u = new URL(decodeEntities(m[1]!), pageUrl);
            u.hash = "";
            return u.hostname === site.hostname && /^https?:$/.test(u.protocol) && u.toString() !== site.toString() ? u.toString() : null;
          } catch {
            return null;
          }
        })
        .filter((u): u is string => Boolean(u)),
    ),
  ].slice(0, 50);
  body = body
    .replace(/<(script|style|noscript|template|svg|canvas|iframe|object|embed|form|nav|header|footer|aside|button|select)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n: string, t: string) => `\n\n${"#".repeat(Number(n))} ${t.replace(/<[^>]+>/g, " ").trim()}\n\n`)
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/(p|div|section|tr|table|ul|ol|blockquote|pre|dl|dt|dd|figcaption)>/gi, "\n\n")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<[^>]+>/g, " ");
  const text = decodeEntities(body)
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title, text, language, links };
}

/** A page and, optionally, up to `follow` pages it links to on the same site (KNW-22). */
export async function fetchSite(raw: string, follow: number, opts: Parameters<typeof fetchPage>[1] = {}): Promise<{ pages: FetchedPage[]; skipped: number }> {
  const first = await fetchPage(raw, opts);
  const pages = [first];
  let skipped = 0;
  for (const link of first.links.slice(0, Math.min(follow, PAGE_LIMITS.maxLinked))) {
    try {
      pages.push(await fetchPage(link, opts));
    } catch {
      skipped++;
    }
  }
  return { pages, skipped };
}
