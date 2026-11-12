// Request schemas shared by every surface. Surfaces validate at their edge; the core validates again.
// zod only: this module is safe to import in a browser bundle.
import { z } from "zod";
import { notebookSchema } from "../notebook/index.js";

export const MAX_MESSAGE_CHARS = 4000;
/** A client-held conversation (browser storage) is refused above this size. */
export const MAX_CLIENT_THREAD_CHARS = 600_000;

/** `<namespace>:<uuid>`. The surface owns the namespace (web: an HMAC of the session cookie; CLI: "cli"). */
export const THREAD_ID_PATTERN = /^[A-Za-z0-9_-]{2,64}:[0-9a-fA-F-]{36}$/;

export const selectionSchema = z.strictObject({
  provider: z.string().regex(/^[a-z_]{2,32}$/),
  model: z.string().regex(/^@?[A-Za-z0-9._:/-]{1,80}$/),
  temperature: z.number().min(0).max(1).default(0.3),
});

const KEY = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);

/**
 * Languages a visitor can choose in the kiosk: NLLB-200 codes (on-device translation), the speech
 * locale (recognition and voices) and the name the agent is told to reply in.
 */
export const LANGUAGES = [
  { code: "eng_Latn", label: "English", native: "English", speech: "en-US" },
  { code: "hin_Deva", label: "Hindi", native: "हिन्दी", speech: "hi-IN" },
  { code: "tam_Taml", label: "Tamil", native: "தமிழ்", speech: "ta-IN" },
  { code: "kan_Knda", label: "Kannada", native: "ಕನ್ನಡ", speech: "kn-IN" },
  { code: "tel_Telu", label: "Telugu", native: "తెలుగు", speech: "te-IN" },
  { code: "mal_Mlym", label: "Malayalam", native: "മലയാളം", speech: "ml-IN" },
  { code: "ben_Beng", label: "Bengali", native: "বাংলা", speech: "bn-IN" },
  { code: "fra_Latn", label: "French", native: "Français", speech: "fr-FR" },
  { code: "spa_Latn", label: "Spanish", native: "Español", speech: "es-ES" },
  { code: "deu_Latn", label: "German", native: "Deutsch", speech: "de-DE" },
  { code: "por_Latn", label: "Portuguese", native: "Português", speech: "pt-PT" },
  { code: "arb_Arab", label: "Arabic", native: "العربية", speech: "ar-SA" },
  { code: "zho_Hans", label: "Chinese (Simplified)", native: "简体中文", speech: "zh-CN" },
  { code: "jpn_Jpan", label: "Japanese", native: "日本語", speech: "ja-JP" },
] as const;
export type LanguageCode = (typeof LANGUAGES)[number]["code"];
export const DEFAULT_LANGUAGE: LanguageCode = "eng_Latn";
const LANGUAGE_CODES = LANGUAGES.map((l) => l.code) as [LanguageCode, ...LanguageCode[]];

/**
 * How questions are answered from the knowledge base.
 *   agent  the AI agent answers, grounded in the passages it retrieves (option B)
 *   local  on-device only: the closest curated answer, verbatim and cited, or "not covered" (option A)
 *   auto   local when a curated answer matches confidently, otherwise the agent
 * `semantic`: the browser runs the sentence-transformer and passes what it found to the agent.
 */
export const knowledgeSettingsSchema = z.strictObject({
  answers: z.enum(["agent", "local", "auto"]).default("agent"),
  semantic: z.boolean().default(true),
  /** The sentence-transformer (knowledge/semantic EMBEDDING_MODELS); auto picks by the kiosk language. */
  model: z.enum(["auto", "minilm", "labse"]).default("auto"),
  /**
   * Web search when the knowledge base doesn't cover a question (the deployment must configure a
   * search service). "fallback": searched automatically, re-ranked, and offered to the agent as web
   * sources; "off": the kiosk's own knowledge only.
   */
  web: z.enum(["off", "fallback"]).default("fallback"),
});
export type KnowledgeSettings = z.infer<typeof knowledgeSettingsSchema>;

/** Agent settings from the Settings page. See `/settings` for what each option means. */
export const agentSettingsSchema = z.strictObject({
  harness: z.enum(["auto", "deep", "lean"]).default("auto"),
  /** Tool id -> on/off. Missing = on. */
  tools: z.record(KEY, z.boolean()).default({}),
  /** Subagent id -> on/off. Missing = on. */
  subagents: z.record(KEY, z.boolean()).default({}),
  memory: z.boolean().default(true),
  /** Skill name -> on/off. Missing = on. */
  skills: z.record(KEY, z.boolean()).default({}),
  /** MCP server ids to use. Only servers the deployment configured are honoured. */
  mcp: z.array(KEY).max(10).default([]),
  storage: z.enum(["indexeddb", "session", "box", "server"]).default("indexeddb"),
  /** The language the visitor chose: the agent replies in it. */
  language: z.enum(LANGUAGE_CODES).default(DEFAULT_LANGUAGE),
  knowledge: knowledgeSettingsSchema.default({ answers: "agent", semantic: true, model: "auto", web: "fallback" }),
});
export type AgentSettings = z.infer<typeof agentSettingsSchema>;

/**
 * A conversation held by the client (browser storage). Untrusted: only human, ai and tool messages
 * (a client can't add system messages), and a size cap.
 */
export const clientThreadSchema = z
  .strictObject({
    messages: z
      .array(z.object({ type: z.enum(["human", "ai", "tool"]), data: z.looseObject({ content: z.unknown() }) }))
      .max(200),
    todos: z
      .array(z.strictObject({ content: z.string().max(500), status: z.enum(["pending", "in_progress", "completed"]) }))
      .max(50)
      .default([]),
    files: z.record(z.string().max(300), z.unknown()).default({}),
  })
  .refine((t) => JSON.stringify(t).length <= MAX_CLIENT_THREAD_CHARS, { message: "This conversation is too long. Start a new one." });

/**
 * What the browser's sentence-transformer found for this turn's question: references only, never
 * text. `curated:<id>` names a curated Q&A item; `notebook:<source id>#<part>` a part of the
 * notebook sent with the turn (semanticChunks). The core looks the text up itself, so a client
 * can't pass off its own words as the knowledge base.
 */
export const retrievedRefSchema = z.strictObject({
  ref: z.string().regex(/^(curated:[A-Za-z0-9_-]{1,64}|notebook:[A-Za-z0-9_-]{1,64}#\d{1,5})$/),
  score: z.number().min(-1).max(1),
});
export type RetrievedRef = z.infer<typeof retrievedRefSchema>;

export const clientStateSchema = z.strictObject({
  thread: clientThreadSchema.nullable().default(null),
  notebook: notebookSchema.nullable().default(null),
  retrieved: z.array(retrievedRefSchema).max(12).default([]),
});

/** What a browser or device sends: a client-generated conversation id, never a full thread id. */
export const chatRequestSchema = z.strictObject({
  threadId: z.uuid(),
  message: z.string().trim().min(1, "Please enter a question.").max(MAX_MESSAGE_CHARS),
  provider: selectionSchema.shape.provider,
  model: selectionSchema.shape.model,
  temperature: selectionSchema.shape.temperature,
  settings: agentSettingsSchema.default(agentSettingsSchema.parse({})),
  client: clientStateSchema.optional(),
});

/** What the core's `ask` accepts. */
export const askSchema = z.strictObject({
  threadId: z.string().regex(THREAD_ID_PATTERN),
  message: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
  selection: selectionSchema,
  settings: agentSettingsSchema.default(agentSettingsSchema.parse({})),
  client: clientStateSchema.optional(),
});

export type Selection = z.infer<typeof selectionSchema>;
export type ChatRequest = z.infer<typeof chatRequestSchema>;
export type AskInput = z.input<typeof askSchema>;
export type ClientState = z.infer<typeof clientStateSchema>;

/**
 * Slot filling's model pass (POST /api/agent/extract): which journey step, and what the visitor
 * said. The fields are looked up in the kiosk's own content, never taken from the request.
 */
export const extractRequestSchema = z.strictObject({
  journey: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  step: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  text: z.string().trim().min(1, "Please say or type something.").max(2000),
  provider: selectionSchema.shape.provider,
  model: selectionSchema.shape.model,
});
export const extractSchema = z.strictObject({
  journey: extractRequestSchema.shape.journey,
  step: extractRequestSchema.shape.step,
  text: extractRequestSchema.shape.text,
  selection: selectionSchema,
});
export type ExtractInput = z.input<typeof extractSchema>;
