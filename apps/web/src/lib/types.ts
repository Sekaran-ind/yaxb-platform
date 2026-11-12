import type { Profile } from "@sekaran-ind/yaxb-core/accounts";
import type { CommandEffect } from "@sekaran-ind/yaxb-core/commands";
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
  /** A kiosk command, shown as a card in the conversation (CMD-1..6). */
  card?: CommandCard;
  /** Sent to the moderators to check (MOD-10), on this screen only. */
  review?: "sending" | "sent" | "failed";
};

/**
 * A command card: an "AI cover" (what the kiosk understood and will do) around the content, with
 * a confirmation when it changes something. JSON only: it's kept with the conversation.
 */
export type CommandCard = {
  command: string;
  /** The cover line: "Turn off web search?", "Opened the model settings." */
  title: string;
  state: "confirm" | "done" | "cancelled" | "refused" | "info" | "needs-profile";
  effect: CommandEffect;
  /** The kiosk's answer about itself (about.*), or a refusal's reason. */
  text?: string;
  /** What will change (settings and profile updates). */
  changes?: { label: string; from: string; to: string }[];
  /** A journey this command starts. */
  journey?: string;
  /** Profile update: the profile after the change, applied on Yes. */
  profile?: Profile;
  /** Profile update with nothing read on the device: the assistant can try. */
  canAskAssistant?: boolean;
  /** The visitor's words after the command (profile update). */
  said?: string;
};

/** Status shown on the kiosk player panel (kept from the original kiosk). */
export type KioskStatus = "Ready" | "Listening" | "Fetching" | "Thinking" | "Playing Response" | "Paused" | "Fetch failed";

export const SETTINGS_STORAGE_KEY = "yaxb.settings.v1";
