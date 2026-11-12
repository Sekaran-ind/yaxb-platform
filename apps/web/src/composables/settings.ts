// Per-browser preferences: which server-configured provider and model to use, how the deep agent
// is set up, the kiosk layout, voice, and the yaxb-box connection. No secrets except the box token,
// which stays in this browser and is never sent with a chat turn. API keys stay in the Worker.
import type { LayoutChoice } from "@sekaran-ind/yaxb-core/screens";
import { DEFAULT_AGENT_SETTINGS, type AgentSettings, type Capabilities } from "@sekaran-ind/yaxb-core/settings";
import { reactive, ref, watch } from "vue";
import { SETTINGS_STORAGE_KEY, type ProvidersResponse } from "@/lib/types";

export type KioskSettings = {
  provider: string | null;
  model: string | null;
  temperature: number;
  speakResponses: boolean;
  voiceName: string | null;
  speechRate: number;
  /** Deep agent settings: tools, subagents, memory, skills, MCP servers, storage. */
  agent: AgentSettings;
  /** Kiosk layout: auto picks mini, pod or full from the space available. */
  layout: LayoutChoice;
  activeNotebook: string | null;
  /** yaxb-box connection for Storage: Box. Stays in this browser; never sent with a chat turn. */
  box: { url: string; token: string };
};

const DEFAULTS: KioskSettings = {
  provider: null,
  model: null,
  temperature: 0.3,
  speakResponses: true,
  voiceName: null,
  speechRate: 1,
  agent: DEFAULT_AGENT_SETTINGS,
  layout: "auto",
  activeNotebook: null,
  box: { url: "", token: "" },
};

function load(): KioskSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? "{}") as Partial<KioskSettings>;
    return { ...DEFAULTS, ...saved, agent: { ...DEFAULT_AGENT_SETTINGS, ...saved.agent, knowledge: { ...DEFAULT_AGENT_SETTINGS.knowledge, ...saved.agent?.knowledge } }, box: { ...DEFAULTS.box, ...saved.box } };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

/** One reactive settings object for the whole app, saved to localStorage on every change. */
export const settings = reactive<KioskSettings>(load());
watch(
  settings,
  (s) => {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(s));
    } catch {
      /* storage unavailable (private mode): keep in memory */
    }
  },
  { deep: true },
);

export function updateSettings(patch: Partial<KioskSettings>) {
  Object.assign(settings, patch);
}

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? "Unavailable");
  return (await r.json()) as T;
}

/** Fetch once and share: the same answer for every component. */
function shared<T>(path: string) {
  const data = ref<T | null>(null);
  const error = ref<string | null>(null);
  let started = false;
  return () => {
    if (!started) {
      started = true;
      getJson<T>(path)
        .then((d) => (data.value = d as never))
        .catch((e: Error) => {
          error.value = e.message;
          started = false;
        });
    }
    return { data, error };
  };
}

/** Provider catalog from the Worker (which providers have keys). */
export const useProviders = shared<ProvidersResponse>("/api/agent/providers");
/** What this deployment's agent can do (tools, subagents, skills, MCP servers, storage). */
export const useCapabilities = shared<Capabilities>("/api/agent/capabilities");

/** The selection to send with a chat request: saved choice if still valid, else the server default. */
export function effectiveSelection(s: KioskSettings, catalog: ProvidersResponse | null) {
  if (!catalog) return null;
  const provider = catalog.providers.find((p) => p.id === s.provider && p.configured);
  const model = provider?.models.find((m) => m.id === s.model);
  if (provider && model) return { provider: provider.id, model: model.id };
  return catalog.default;
}
