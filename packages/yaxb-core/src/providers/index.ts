// The provider allowlist and chat-model construction. Keys are read from the env the surface passes
// in (Worker bindings, process.env, a test object) and never leave this module.
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import catalogJson from "../data/providers.json" with { type: "json" };
import type { Selection } from "../schemas/index.js";

export type Env = Readonly<Record<string, unknown>>;

/** `harness: "lean"` runs the model with only the kiosk tools (small local models). Default "deep". */
export type CatalogModel = { id: string; label: string; temperature?: boolean; harness?: "deep" | "lean" };
/** `credential` is the key; `requires` lists other settings that must also be set (e.g. an account id). */
export type CatalogProvider = { id: string; label: string; credential: string; requires?: string[]; local?: boolean; models: CatalogModel[] };
export type Catalog = { default: { provider: string; model: string }; providers: CatalogProvider[] };

/** What a surface may show: no credentials, only whether each provider is usable. */
export type ProviderInfo = { id: string; label: string; configured: boolean; local: boolean; models: { id: string; label: string }[] };
export type ProvidersResponse = { providers: ProviderInfo[]; default: { provider: string; model: string } };

export class ProviderError extends Error {
  override name = "ProviderError";
}

export const catalog: Catalog = catalogJson as Catalog;

export const HF_ROUTER_URL = "https://router.huggingface.co/v1";
export const GEMINI_OPENAI_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
export const MISTRAL_OPENAI_URL = "https://api.mistral.ai/v1";

/** Workers AI's OpenAI-compatible API. The account id is checked before it goes into the URL. */
export function workersAiUrl(accountId: string): string {
  if (!/^[0-9a-f]{32}$/.test(accountId)) throw new ProviderError("CLOUDFLARE_ACCOUNT_ID must be the 32-character account id.");
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`;
}

function credential(env: Env, name: string): string | undefined {
  const v = env[name];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export function isConfigured(env: Env, provider: CatalogProvider): boolean {
  return [provider.credential, ...(provider.requires ?? [])].every((name) => credential(env, name) !== undefined);
}

/** The catalog default, or the first configured provider's first model when the default isn't set up. */
export function defaultSelection(env: Env, cat: Catalog = catalog): { provider: string; model: string } {
  const preferred = cat.providers.find((p) => p.id === cat.default.provider);
  if (preferred && isConfigured(env, preferred)) return cat.default;
  const first = cat.providers.find((p) => isConfigured(env, p) && p.models.length);
  return first ? { provider: first.id, model: first.models[0]!.id } : cat.default;
}

export function listProviders(env: Env, cat: Catalog = catalog): ProvidersResponse {
  return {
    default: defaultSelection(env, cat),
    providers: cat.providers.map((p) => ({
      id: p.id,
      label: p.label,
      configured: isConfigured(env, p),
      local: Boolean(p.local),
      models: p.models.map(({ id, label }) => ({ id, label })),
    })),
  };
}

/** Check a selection against the allowlist and the env. Throws ProviderError with a message safe to show users. */
export function resolveSelection(env: Env, sel: { provider: string; model: string }, cat: Catalog = catalog) {
  const provider = cat.providers.find((p) => p.id === sel.provider);
  if (!provider) throw new ProviderError(`Unknown provider "${sel.provider}".`);
  const model = provider.models.find((m) => m.id === sel.model);
  if (!model) throw new ProviderError(`Model "${sel.model}" is not offered for ${provider.label}.`);
  const key = credential(env, provider.credential);
  if (!key || !isConfigured(env, provider)) throw new ProviderError(`${provider.label} is not configured. Add its key to enable it.`);
  return { provider, model, key };
}

/**
 * Some OpenAI-compatible endpoints (Workers AI, several Hugging Face providers) accept only a
 * string as a message's `content`, while LangChain and Deep Agents send a list of content blocks
 * (the system prompt with memory and skills, cache markers). This fetch joins text blocks into one
 * string on the way out; other block types (images) are left alone.
 */
export function flattenTextContent(body: unknown): unknown {
  if (!body || typeof body !== "object" || !Array.isArray((body as { messages?: unknown }).messages)) return body;
  const b = body as { messages: { content?: unknown }[] };
  return {
    ...b,
    messages: b.messages.map((m) => {
      const c = m.content;
      if (!Array.isArray(c) || !c.every((p) => p && typeof p === "object" && (p as { type?: unknown }).type === "text")) return m;
      return { ...m, content: c.map((p) => String((p as { text?: unknown }).text ?? "")).join("\n\n") };
    }),
  };
}

export function plainTextContentFetch(base: typeof fetch = (...a) => fetch(...a)): typeof fetch {
  return async (input, init) => {
    if (init?.body && typeof init.body === "string") {
      try {
        init = { ...init, body: JSON.stringify(flattenTextContent(JSON.parse(init.body))) };
      } catch {
        /* not JSON: send as is */
      }
    }
    return base(input, init);
  };
}

/**
 * Every provider except Anthropic speaks the OpenAI Chat Completions API, so one SDK
 * (@langchain/openai) serves them all and keeps the Worker small.
 */
async function openAiCompatible(model: string, apiKey: string, temperature: number | undefined, baseURL: string) {
  const { ChatOpenAI } = await import("@langchain/openai");
  return new ChatOpenAI({
    model,
    apiKey,
    temperature,
    maxTokens: 2048,
    maxRetries: 2,
    streamUsage: false,
    configuration: { baseURL, fetch: plainTextContentFetch() },
  });
}

/** Build the chat model for a selection. Two SDKs: Anthropic's, and OpenAI's for everything else. */
export async function createChatModel(env: Env, sel: Selection, cat: Catalog = catalog): Promise<BaseChatModel> {
  const { provider, model, key } = resolveSelection(env, sel, cat);
  const temperature = model.temperature === false ? undefined : sel.temperature;
  switch (provider.id) {
    case "anthropic": {
      const { ChatAnthropic } = await import("@langchain/anthropic");
      return new ChatAnthropic({ model: model.id, apiKey: key, temperature, maxTokens: 2048, maxRetries: 2 });
    }
    case "openai": {
      const { ChatOpenAI } = await import("@langchain/openai");
      // Responses API with zero data retention: OpenAI keeps no copy of the conversation.
      return new ChatOpenAI({ model: model.id, apiKey: key, temperature, useResponsesApi: true, zdrEnabled: true, maxRetries: 2 });
    }
    case "google_genai":
      // Gemini's OpenAI-compatible endpoint.
      return openAiCompatible(model.id, key, temperature, GEMINI_OPENAI_URL);
    case "huggingface":
      // Hugging Face Inference Providers: an OpenAI-compatible router in front of Groq, Cerebras,
      // Novita and others. The model id's `:<provider>` suffix picks who serves it.
      return openAiCompatible(model.id, key, temperature, HF_ROUTER_URL);
    case "workers_ai":
      // Cloudflare Workers AI, with an API token that has Workers AI permission.
      return openAiCompatible(model.id, key, temperature, workersAiUrl(credential(env, "CLOUDFLARE_ACCOUNT_ID")!));
    case "mistralai":
      return openAiCompatible(model.id, key, temperature, MISTRAL_OPENAI_URL);
    case "ollama":
      // Ollama's OpenAI-compatible API. The credential is the base URL; Ollama ignores the key.
      return openAiCompatible(model.id, "ollama", temperature, `${key.replace(/\/+$/, "")}/v1`);
    default:
      throw new ProviderError(`No adapter for provider "${provider.id}".`);
  }
}
