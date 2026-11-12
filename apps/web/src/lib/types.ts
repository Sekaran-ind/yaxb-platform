import type { Todo } from "@sekaran-ind/yaxb-core/events";

// Shapes shared with yaxb-core: keep one definition.
export type { AgentEvent, Todo } from "@sekaran-ind/yaxb-core/events";
export type { ProviderInfo as Provider, ProvidersResponse } from "@sekaran-ind/yaxb-core/providers";
export type { CuratedItem, KnowledgeSource } from "@sekaran-ind/yaxb-core/knowledge";
export type { ModerationItem } from "@sekaran-ind/yaxb-core/stores";

export type ToolActivity = { id: string; name: string; subagent: string | null; nested: boolean; done: boolean };

export type ChatTurn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  tools: ToolActivity[];
  todos: Todo[];
  error?: string;
  pending?: boolean;
  /** Answered on this device from the knowledge base, without the AI agent. */
  local?: boolean;
};

/** Status shown on the kiosk player panel (kept from the original kiosk). */
export type KioskStatus = "Ready" | "Listening" | "Fetching" | "Thinking" | "Playing Response" | "Paused" | "Fetch failed";

export const SETTINGS_STORAGE_KEY = "yaxb.settings.v1";
