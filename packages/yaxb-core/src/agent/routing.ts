// Semantic tool routing: with many optional tools (MCP servers can bring dozens), offering all of
// them to the model makes it slow, costly and more likely to pick the wrong one. The visitor's
// message and each tool's description are embedded; only the tools that match go to the model.
// The kiosk's own tools (knowledge search, escalation) and the file tools are never routed away.
import type { StructuredToolInterface } from "@langchain/core/tools";
import { SERVER_EMBEDDING } from "../knowledge/server.js";
import { fingerprint, similarity, type Embed } from "../knowledge/semantic.js";

/** At most this many tools are offered; with this many or fewer, routing is skipped. */
export const ROUTE_LIMIT = 3;

export type RoutedTool = { name: string; score: number };

/**
 * The tools for a message: up to `k`, each at least `minScore` and within `margin` of the best.
 * Description vectors are cached in `cache` (per kiosk), keyed by name and description.
 */
export async function routeTools<T extends Pick<StructuredToolInterface, "name" | "description">>(
  message: string,
  tools: readonly T[],
  embed: Embed,
  {
    k = ROUTE_LIMIT,
    minScore = SERVER_EMBEDDING.thresholds.route as number,
    margin = SERVER_EMBEDDING.thresholds.routeMargin as number,
    cache = new Map<string, number[]>(),
  }: { k?: number; minScore?: number; margin?: number; cache?: Map<string, number[]> } = {},
): Promise<{ tools: T[]; scores: RoutedTool[] }> {
  if (tools.length <= k) return { tools: [...tools], scores: tools.map((t) => ({ name: t.name, score: 1 })) };
  const keyOf = (t: T) => `${t.name}\n${fingerprint(t.description)}`;
  const missing = tools.filter((t) => !cache.has(keyOf(t)));
  const [query, ...vectors] = await embed([message.slice(0, 1000), ...missing.map((t) => `${t.name.replace(/_/g, " ")}: ${t.description}`)]);
  missing.forEach((t, i) => cache.set(keyOf(t), vectors[i]!));
  const scored = tools.map((t) => ({ tool: t, score: Math.round(similarity(cache.get(keyOf(t))!, query!) * 1000) / 1000 })).sort((a, b) => b.score - a.score);
  const best = scored[0]?.score ?? 0;
  const kept = scored.filter((s) => s.score >= minScore && s.score >= best - margin).slice(0, k);
  return { tools: kept.map((s) => s.tool), scores: scored.map((s) => ({ name: s.tool.name, score: s.score })) };
}
