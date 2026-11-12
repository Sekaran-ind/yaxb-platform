// Web search, as a fallback when the kiosk's own knowledge doesn't cover a question.
//
// The deployment opts in with a search API key (the visitor can still switch it off in Settings):
//   TAVILY_API_KEY          Tavily (https://tavily.com), built for LLM retrieval
//   BRAVE_SEARCH_API_KEY    Brave Search API (https://brave.com/search/api/)
//   WEB_SEARCH_DOMAINS      optional allowlist, e.g. "who.int,nhs.uk,medlineplus.gov,mohfw.gov.in"
//
// The visitor's question is sent to that service, so it never runs for a possible emergency, and
// results are untrusted data: they reach the agent as passages, never as instructions.
import type { Env } from "../providers/index.js";

export type WebResult = { title: string; url: string; snippet: string; published?: string };

export interface WebSearch {
  /** Which service: shown in Settings. */
  readonly provider: "tavily" | "brave";
  /** Sites the search is restricted to ([] = the whole web). */
  readonly domains: readonly string[];
  search(query: string, opts?: { count?: number; signal?: AbortSignal }): Promise<WebResult[]>;
}

const str = (env: Env, key: string) => (typeof env[key] === "string" && (env[key] as string).trim() ? (env[key] as string).trim() : undefined);

/** "who.int, nhs.uk" -> ["who.int", "nhs.uk"]; anything that isn't a host name is dropped. */
export function parseDomains(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[\s,]+/)
    .map((d) => d.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
    .filter((d) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d))
    .slice(0, 20);
}

const plainText = (s: unknown) =>
  String(s ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:quot|#39|amp|lt|gt);/g, (m) => ({ "&quot;": '"', "&#39;": "'", "&amp;": "&", "&lt;": "<", "&gt;": ">" })[m]!)
    .replace(/\s+/g, " ")
    .trim();

function clean(results: WebResult[], count: number): WebResult[] {
  const seen = new Set<string>();
  return results
    .filter((r) => /^https?:\/\//.test(r.url) && r.snippet && !seen.has(r.url) && seen.add(r.url))
    .slice(0, count)
    .map((r) => ({ ...r, title: plainText(r.title).slice(0, 200), snippet: plainText(r.snippet).slice(0, 1500) }));
}

export function createTavilySearch({ apiKey, domains = [], fetch: fetchImpl = (input, init) => fetch(input, init) }: { apiKey: string; domains?: string[]; fetch?: typeof fetch }): WebSearch {
  return {
    provider: "tavily",
    domains,
    async search(query, { count = 8, signal } = {}) {
      const res = await fetchImpl("https://api.tavily.com/search", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.slice(0, 400), max_results: count, search_depth: "basic", ...(domains.length ? { include_domains: domains } : {}) }),
        signal,
      });
      if (!res.ok) throw new Error(`Tavily search failed: HTTP ${res.status}`);
      const data = (await res.json()) as { results?: { title?: string; url?: string; content?: string; published_date?: string }[] };
      return clean(
        (data.results ?? []).map((r) => ({ title: r.title ?? "", url: r.url ?? "", snippet: r.content ?? "", ...(r.published_date ? { published: r.published_date } : {}) })),
        count,
      );
    },
  };
}

export function createBraveSearch({ apiKey, domains = [], fetch: fetchImpl = (input, init) => fetch(input, init) }: { apiKey: string; domains?: string[]; fetch?: typeof fetch }): WebSearch {
  return {
    provider: "brave",
    domains,
    async search(query, { count = 8, signal } = {}) {
      const sites = domains.length ? ` (${domains.map((d) => `site:${d}`).join(" OR ")})` : "";
      const url = `https://api.search.brave.com/res/v1/web/search?${new URLSearchParams({ q: query.slice(0, 350) + sites, count: String(Math.min(count, 20)) })}`;
      const res = await fetchImpl(url, { headers: { Accept: "application/json", "X-Subscription-Token": apiKey }, signal });
      if (!res.ok) throw new Error(`Brave search failed: HTTP ${res.status}`);
      const data = (await res.json()) as { web?: { results?: { title?: string; url?: string; description?: string; extra_snippets?: string[]; age?: string }[] } };
      return clean(
        (data.web?.results ?? []).map((r) => ({
          title: r.title ?? "",
          url: r.url ?? "",
          snippet: [r.description, ...(r.extra_snippets ?? [])].filter(Boolean).join(" "),
          ...(r.age ? { published: r.age } : {}),
        })),
        count,
      );
    },
  };
}

/** The web search this deployment configured, or null. Tavily wins when both keys are set. */
export function webSearchFromEnv(env: Env, fetchImpl?: typeof fetch): WebSearch | null {
  const domains = parseDomains(str(env, "WEB_SEARCH_DOMAINS"));
  const tavily = str(env, "TAVILY_API_KEY");
  if (tavily) return createTavilySearch({ apiKey: tavily, domains, fetch: fetchImpl });
  const brave = str(env, "BRAVE_SEARCH_API_KEY");
  if (brave) return createBraveSearch({ apiKey: brave, domains, fetch: fetchImpl });
  return null;
}

/** "https://www.who.int/news/..." -> "who.int" */
export const siteOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};
