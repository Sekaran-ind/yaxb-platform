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
  /** A journey running in the conversation (/journeys, /staff): kept with it, so it can be resumed. */
  journey?: JourneyTurn;
  /** A request's reference: its status, looked up whenever the conversation is open. */
  /** `open`: unfold the whole request when it is added (opened from a queue or a link). */
  request?: { ref: string; open?: boolean };
  /**
   * Context loaded into the conversation on this device (LIB-49), on both of its turns: what the
   * person picked (a journey, a request, a file) and the kiosk's reply. It is not an answer, so it
   * has no "ask a moderator"; the person's turn shows its icon.
   */
  via?: "journey" | "request" | "file";
};

/** A journey in the conversation: where it got to, and the request it became when it was handed over. */
export type JourneyTurn = {
  id: string;
  /** The catalogue entry it comes from; null for a built-in journey. */
  entry: string | null;
  title: string;
  /** The run so far (answers, results), to carry on from when the conversation is opened again. */
  run: { current: string | null; answers: Record<string, Record<string, unknown>>; steps: Record<string, unknown>; trail: { step: string; label: string; stage?: string; ok: boolean }[] } | null;
  status: "running" | "done" | "handed" | "closed";
  /** Its result, once it ended: still readable after Done folds it away. */
  result?: { title: string; text: string } | null;
  /** Handed over: the request's reference. */
  handed?: { ref: string; caseId: string };
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

/** What the conversation's context loader picked (/journeys, /staff). */
export type ContextPick = { kind: "journey"; id: string; title: string } | { kind: "request"; ref: string };
