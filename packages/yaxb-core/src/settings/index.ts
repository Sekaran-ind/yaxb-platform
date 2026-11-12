// Agent settings: what the Settings page configures, beyond the model. The surface stores them
// (localStorage on the web) and sends them with every turn; the core checks them against what this
// deployment offers (`capabilities`) and builds the agent to match.
import { kioskContent } from "../content/index.js";
import { EMBEDDING_MODEL_IDS, EMBEDDING_MODELS } from "../knowledge/semantic.js";
import { mcpServerInfo, parseMcpServers, type McpServerInfo } from "../mcp/index.js";
import { webSearchFromEnv } from "../web/index.js";
import { feedbackRate } from "../feedback/index.js";
import { siteRulesFromEnv } from "../web/pages.js";
import type { Env } from "../providers/index.js";

export const STORAGE_OPTIONS = [
  {
    id: "indexeddb",
    label: "This browser (IndexedDB)",
    description: "Notebooks, conversations and memory stay in this browser and survive a reload. Nothing is kept on the server.",
  },
  {
    id: "session",
    label: "This session only",
    description: "Kept in memory until the page closes. Best for a shared, public kiosk.",
  },
  {
    id: "box",
    label: "Local box (yaxb-box)",
    description: "Notebooks, conversations and memory on your yaxb-box (a Raspberry Pi with SQLite, backed up by Litestream) on this network.",
  },
  {
    id: "server",
    label: "Server (Cloudflare D1)",
    description: "Conversations kept on the server for 30 days; the agent's memory in its long-term store (Deep Agents StoreBackend). Notebook sources stay in this browser.",
  },
] as const;
export type StorageId = (typeof STORAGE_OPTIONS)[number]["id"];

/** Tools a visitor may switch off. `locked` tools are always on (safety). */
export const TOOL_OPTIONS = [
  { id: "search_knowledge_base", label: "Knowledge search", description: "Search the curated knowledge base and the notebook's sources." },
  { id: "list_knowledge_sources", label: "Knowledge sources", description: "List what the kiosk's knowledge comes from." },
  { id: "flag_for_moderation", label: "Escalation", description: "Send a question to the human moderators. Always on.", locked: true },
  { id: "files", label: "File tools", description: "Read, search and write files in the notebook (ls, read_file, grep, glob, write_file, edit_file). Off = read only." },
  { id: "planning", label: "Planning", description: "Plan multi-step requests as a visible checklist (write_todos)." },
] as const;

export const SUBAGENT_OPTIONS = [
  { id: "knowledge-researcher", label: "Knowledge researcher", description: "Researches a question across the knowledge base and returns a cited brief." },
  { id: "safety-reviewer", label: "Safety reviewer", description: "Checks a health answer for safety before it's given." },
] as const;

export const HARNESS_OPTIONS = [
  { id: "auto", label: "Automatic", description: "The full deep agent for capable models; the lean agent for small local ones." },
  { id: "deep", label: "Deep agent", description: "Planning, files, subagents, memory and skills." },
  { id: "lean", label: "Lean agent", description: "Only the kiosk tools. For small models that get lost with many tools." },
] as const;

export const ANSWER_OPTIONS = [
  {
    id: "agent",
    label: "AI agent, grounded",
    description: "The AI model answers from the knowledge base and your notebook only, states facts with their sources, and gives no opinions. Needs a provider.",
  },
  {
    id: "local",
    label: "On this device only",
    description: "No AI model: the sentence-transformer in this browser finds the closest curated answer and shows it word for word with its source, or says it isn't covered.",
  },
  {
    id: "auto",
    label: "Automatic",
    description: "The curated answer on this device when one matches confidently; the grounded AI agent otherwise.",
  },
] as const;

/** Sentence-transformer choices for Settings → Knowledge. */
export const EMBEDDING_OPTIONS = [
  {
    id: "auto",
    label: "Automatic",
    description: "Multilingual MiniLM for the languages it knows; LaBSE for Tamil, Telugu, Kannada, Malayalam and Bengali.",
  },
  ...EMBEDDING_MODEL_IDS.map((id) => ({ id, label: EMBEDDING_MODELS[id].label, description: EMBEDDING_MODELS[id].description })),
] as const satisfies readonly { id: string; label: string; description: string }[];

export { agentSettingsSchema, DEFAULT_LANGUAGE, LANGUAGES, type AgentSettings, type KnowledgeSettings, type LanguageCode } from "../schemas/index.js";
import { agentSettingsSchema, LANGUAGES, type AgentSettings } from "../schemas/index.js";

/** The language's English name ("Hindi"), for the agent's prompt. */
export const languageName = (code: string) => LANGUAGES.find((l) => l.code === code)?.label ?? "English";

export const DEFAULT_AGENT_SETTINGS: AgentSettings = agentSettingsSchema.parse({});

export const isOn = (map: Record<string, boolean>, id: string) => map[id] !== false;

/** Settings resolved against what's available: unknown MCP ids dropped, locked tools forced on. */
export function effectiveSettings(settings: AgentSettings, available: { mcp: readonly string[] }): AgentSettings {
  const tools = { ...settings.tools };
  for (const t of TOOL_OPTIONS) if ("locked" in t && t.locked) tools[t.id] = true;
  return { ...settings, tools, mcp: settings.mcp.filter((id) => available.mcp.includes(id)) };
}

export type Capabilities = {
  storage: typeof STORAGE_OPTIONS;
  harness: typeof HARNESS_OPTIONS;
  tools: typeof TOOL_OPTIONS;
  subagents: typeof SUBAGENT_OPTIONS;
  answers: typeof ANSWER_OPTIONS;
  embeddingModels: typeof EMBEDDING_OPTIONS;
  /** The web search this deployment configured for the fallback (no keys), or null. */
  web: { provider: "tavily" | "brave"; domains: readonly string[] } | null;
  /** How often sessions are asked for feedback: 0 (never) to 1 (every session). FEEDBACK_RATE. */
  feedback: { rate: number };
  /** Websites as sources: the trusted-site list (empty = any public site) and whether Safe Browsing checks them. */
  websites: { allow: string[]; safeBrowsing: boolean };
  languages: typeof LANGUAGES;
  skills: { name: string; description: string }[];
  mcp: McpServerInfo[];
  journeys: { id: string; title: string; summary?: string }[];
  defaults: AgentSettings;
};

/** What Settings may offer on this deployment. No secrets: MCP servers show label and host only. */
export function capabilities(env: Env): Capabilities {
  return {
    storage: STORAGE_OPTIONS,
    harness: HARNESS_OPTIONS,
    tools: TOOL_OPTIONS,
    subagents: SUBAGENT_OPTIONS,
    answers: ANSWER_OPTIONS,
    embeddingModels: EMBEDDING_OPTIONS,
    feedback: { rate: feedbackRate(env) },
    websites: (() => {
      const r = siteRulesFromEnv(env);
      return { allow: r.allow, safeBrowsing: Boolean(r.safeBrowsingKey) };
    })(),
    web: (() => {
      const w = webSearchFromEnv(env);
      return w ? { provider: w.provider, domains: w.domains } : null;
    })(),
    languages: LANGUAGES,
    skills: kioskContent.skills.map(({ name, description }) => ({ name, description })),
    mcp: parseMcpServers(env.MCP_SERVERS).servers.map(mcpServerInfo),
    journeys: kioskContent.journeys.map(({ id, title, summary }) => ({ id, title, summary })),
    defaults: DEFAULT_AGENT_SETTINGS,
  };
}
