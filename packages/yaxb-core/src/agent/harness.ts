// The kiosk agent, built with LangChain Deep Agents, and the translation of its stream into
// AgentEvents.
//
// Hardening on top of the Deep Agents defaults, in layers:
// 1. Filesystem tools are an allowlist (SAFE_FS_TOOLS) on the main agent and on every subagent, so
//    `execute` and `delete` are never registered. That holds for every provider and backend.
// 2. A guard middleware refuses `task` calls to any subagent not in SUBAGENTS, whatever the model
//    asks for. This also covers the general-purpose subagent on providers Deep Agents has no
//    profile for (Ollama).
// 3. A harness profile per known provider hides those tools and turns off the general-purpose
//    subagent, so the model isn't offered them in the first place.
// Files live in the default StateBackend: virtual, per-thread files in agent state, never on a disk.
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { MEMORY_PATH, SKILLS_ROOT } from "../notebook/index.js";
import type { BaseStore } from "@langchain/langgraph-checkpoint";
import { CompositeBackend, createDeepAgent, createFilesystemMiddleware, registerHarnessProfile, StateBackend, StoreBackend, type FsToolName, type SubAgent } from "deepagents";
import { createAgent, createMiddleware, todoListMiddleware } from "langchain";
import type { AgentEvent, Todo } from "../events/index.js";
import { KIOSK_LEAN_PROMPT, KIOSK_SYSTEM_PROMPT, RESEARCHER_PROMPT, SAFETY_REVIEWER_PROMPT } from "./prompts.js";
import type { buildTools } from "./tools.js";

export const AGENT_NAME = "yaxb-kiosk";

/** Virtual-file tools for scratch notes and plans. `execute` and `delete` are deliberately absent. */
export const SAFE_FS_TOOLS: readonly FsToolName[] = ["ls", "read_file", "write_file", "edit_file", "glob", "grep"];

export const SUBAGENTS = ["knowledge-researcher", "safety-reviewer"] as const;

// Deep Agents identifies a model instance's provider by class: anthropic, openai, google.
for (const key of ["anthropic", "openai", "google"]) {
  registerHarnessProfile(key, { excludedTools: ["execute", "delete"], generalPurposeSubagent: { enabled: false } });
}

/** With file tools switched off in Settings: the agent can still read the notebook, not write. */
export const READ_ONLY_FS_TOOLS: readonly FsToolName[] = ["ls", "read_file", "glob", "grep"];

/**
 * Where the agent's files live (Deep Agents backends). By default everything is in the turn's state
 * (StateBackend: virtual files the surface keeps). With a memory store, /memories/ is routed to
 * Deep Agents' StoreBackend over that LangGraph store (D1, a yaxb-box, …), namespaced per caller
 * and notebook via config.configurable.memoryNamespace.
 */
export function backendFor(memoryStore?: BaseStore) {
  if (!memoryStore) return undefined;
  const memories = new StoreBackend({
    store: memoryStore,
    namespace: (ctx) => {
      const ns = ctx.config?.configurable?.memoryNamespace;
      if (!Array.isArray(ns) || !ns.length) throw new Error("No memory namespace for this turn.");
      return ns as string[];
    },
  });
  return (runtime: ConstructorParameters<typeof StateBackend>[0]) => new CompositeBackend(new StateBackend(runtime), { "/memories/": memories });
}

const fsMiddleware = (writable: boolean, backend?: ReturnType<typeof backendFor>) =>
  createFilesystemMiddleware({ tools: writable ? SAFE_FS_TOOLS : READ_ONLY_FS_TOOLS, ...(backend ? { backend: backend as never } : {}) });

const subagentGuard = (allowed: readonly string[]) =>
  createMiddleware({
    name: "YaxbSubagentGuard",
    wrapToolCall: async (request, handler) => {
      const call = request.toolCall;
      if (call.name === "task") {
        const target = (call.args as { subagent_type?: unknown } | undefined)?.subagent_type;
        if (typeof target !== "string" || !allowed.includes(target)) {
          return new ToolMessage({
            content: allowed.length ? `No helper named "${String(target)}". Available: ${allowed.join(", ")}.` : "No helpers are available. Do the work yourself.",
            tool_call_id: call.id ?? "",
            name: "task",
            status: "error",
          });
        }
      }
      return handler(request);
    },
  });

/** How the agent is built: the parts of the settings that change the graph. */
export type HarnessOptions = {
  /** Kiosk tool ids on (search_knowledge_base, list_knowledge_sources, flag_for_moderation, web_search). */
  tools: readonly string[];
  /** Write tools on (write_file, edit_file); off leaves read-only file tools. */
  files: boolean;
  planning: boolean;
  subagents: readonly string[];
  memory: boolean;
  skills: boolean;
  /** Extra tools, e.g. from MCP servers. */
  extraTools?: StructuredToolInterface[];
  /** Appended to the system prompt (notebook, memory, offerings). */
  promptAddendum?: string;
  /** Keep /memories/ in this LangGraph store (Deep Agents StoreBackend) instead of the turn's state. */
  memoryStore?: BaseStore;
};

export const DEFAULT_HARNESS: HarnessOptions = {
  tools: ["search_knowledge_base", "list_knowledge_sources", "flag_for_moderation"],
  files: true,
  planning: true,
  subagents: SUBAGENTS,
  memory: false,
  skills: false,
};

function kioskTools(tools: ReturnType<typeof buildTools>, on: readonly string[]) {
  // web_search is in `on` only for turns the kiosk's knowledge may not cover (planTurn).
  const all = [tools.listKnowledgeSources, tools.searchKnowledgeBase, tools.flagForModeration, tools.webSearch];
  // flag_for_moderation is always present: escalation is a safety rule, not a preference.
  return all.filter((t) => on.includes(t.name) || t.name === "flag_for_moderation");
}

export function createKioskAgent(model: BaseChatModel, tools: ReturnType<typeof buildTools>, options: HarnessOptions = DEFAULT_HARNESS) {
  const backend = backendFor(options.memoryStore);
  const researchTools = [tools.searchKnowledgeBase, tools.listKnowledgeSources, tools.webSearch].filter((t) => options.tools.includes(t.name));
  const subagents: SubAgent[] = [
    {
      name: "knowledge-researcher",
      description:
        "Researches a question in the kiosk knowledge base and the visitor's notebook and returns a cited brief. Use for any factual or policy question.",
      systemPrompt: RESEARCHER_PROMPT,
      tools: researchTools,
      middleware: [fsMiddleware(false, backend)],
    },
    {
      name: "safety-reviewer",
      description:
        "Reviews a draft answer to a health-related question for safety before it is given to the visitor. Pass the question and the draft.",
      systemPrompt: SAFETY_REVIEWER_PROMPT,
      tools: [],
      middleware: [fsMiddleware(false, backend)],
    },
  ].filter((s) => options.subagents.includes(s.name));

  return createDeepAgent({
    model,
    tools: [...kioskTools(tools, options.tools), ...(options.extraTools ?? [])],
    systemPrompt: KIOSK_SYSTEM_PROMPT + (options.promptAddendum ?? ""),
    subagents,
    middleware: [fsMiddleware(options.files, backend), ...(options.planning ? [todoListMiddleware()] : []), subagentGuard(subagents.map((s) => s.name))],
    ...(backend ? { backend: backend as never } : {}),
    // Deep Agents' memory and skills features, read from the virtual filesystem the turn supplies.
    ...(options.memory ? { memory: [MEMORY_PATH] } : {}),
    ...(options.skills ? { skills: [SKILLS_ROOT] } : {}),
    name: AGENT_NAME,
  });
}

/**
 * The lean harness, for small local models that get lost among a deep agent's tools: only the kiosk
 * tools, no planning, files, subagents, memory or skills. Same safety rules and event stream.
 */
export function createLeanKioskAgent(model: BaseChatModel, tools: ReturnType<typeof buildTools>, options: Pick<HarnessOptions, "tools" | "promptAddendum"> = DEFAULT_HARNESS) {
  return createAgent({
    model,
    tools: kioskTools(tools, options.tools),
    systemPrompt: KIOSK_LEAN_PROMPT + (options.promptAddendum ?? ""),
    name: AGENT_NAME,
  });
}

export type Harness = "deep" | "lean";

/** Both harnesses expose the same stream() used by createKiosk. */
export type KioskAgent = { stream: (input: never, config: never) => Promise<AsyncIterable<unknown>> };

// ---- stream translation -------------------------------------------------------------------------

type StreamPart = [namespace: string[], mode: string, data: unknown];

/** The final top-level state the run reached (from the `values` stream). */
export type FinalState = { messages: BaseMessage[]; todos?: Todo[]; files?: Record<string, unknown> };

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (part && typeof part === "object" && (part as { type?: unknown }).type === "text" ? String((part as { text?: unknown }).text ?? "") : ""))
    .join("");
}

/** Node updates can be a plain object, a Command-like `{ update }`, or a list of either. */
function updatesOf(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(updatesOf);
  if (!value || typeof value !== "object") return [];
  const update = (value as { update?: unknown }).update;
  if (update && typeof update === "object" && !("messages" in value)) return updatesOf(update);
  return [value as Record<string, unknown>];
}

function messageType(msg: unknown): string | undefined {
  const m = msg as { _getType?: () => string; getType?: () => string; type?: string } | null;
  return m?.getType?.() ?? m?._getType?.() ?? m?.type;
}

function subagentOf(args: unknown): string | null {
  let a = args;
  if (typeof a === "string") {
    try {
      a = JSON.parse(a);
    } catch {
      return null;
    }
  }
  const t = (a as { subagent_type?: unknown } | null)?.subagent_type;
  return typeof t === "string" ? t : null;
}

/**
 * Map LangGraph stream parts (streamMode messages + updates + values, subgraphs on) to AgentEvents.
 * Only the top-level agent's text is streamed as answer tokens; subagent work shows as tool events.
 * The last top-level `values` part is reported through `onFinal`.
 */
export async function* translate(stream: AsyncIterable<unknown>, onFinal: (state: FinalState) => void): AsyncGenerator<AgentEvent> {
  const started = new Set<string>();
  for await (const raw of stream) {
    const [namespace, mode, data] = raw as StreamPart;
    const topLevel = namespace.length === 0;
    if (mode === "values") {
      if (topLevel) onFinal(data as FinalState);
    } else if (mode === "messages") {
      const [chunk] = data as [unknown, unknown];
      const type = messageType(chunk);
      if (topLevel && (type === "ai" || type === "AIMessageChunk")) {
        const text = textOf((chunk as { content?: unknown }).content);
        if (text) yield { type: "token", text };
      }
    } else if (mode === "updates" && data && typeof data === "object") {
      for (const nodeValue of Object.values(data as Record<string, unknown>)) {
        for (const update of updatesOf(nodeValue)) {
          if (topLevel && Array.isArray(update.todos)) yield { type: "todos", todos: update.todos as Todo[] };
          const messages = Array.isArray(update.messages) ? update.messages : [];
          for (const msg of messages) {
            const calls = (msg as { tool_calls?: { id?: string; name: string; args?: unknown }[] }).tool_calls ?? [];
            for (const call of calls) {
              const id = call.id ?? `${call.name}-${started.size}`;
              if (started.has(id)) continue;
              started.add(id);
              yield {
                type: "tool_start",
                id,
                name: call.name,
                subagent: call.name === "task" ? subagentOf(call.args) : null,
                nested: !topLevel,
              };
            }
            if (messageType(msg) === "tool") {
              const tm = msg as { tool_call_id?: string; name?: string };
              yield { type: "tool_end", id: tm.tool_call_id ?? "", name: tm.name ?? "", nested: !topLevel };
            }
          }
        }
      }
    }
  }
}
