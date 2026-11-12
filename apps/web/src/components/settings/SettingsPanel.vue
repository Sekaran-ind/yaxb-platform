<script setup lang="ts">
// The deep agent's settings: model, agent, tools, MCP servers, memory and skills, storage, layout and voice.
import { LAYOUTS, type LayoutChoice } from "@sekaran-ind/yaxb-core/screens";
import { EMBEDDING_MODELS, embeddingModelFor } from "@sekaran-ind/yaxb-core/knowledge/semantic";
import type { AgentSettings, LanguageCode } from "@sekaran-ind/yaxb-core/settings";
import { Check, Lock, ServerCrash } from "@lucide/vue";
import { computed, ref } from "vue";
import AdaptiveNav from "@/components/kiosk/AdaptiveNav.vue";
import { effectiveSelection, settings, updateSettings, useCapabilities, useProviders } from "@/composables/settings";
import { useSpeechOutput } from "@/composables/speech";
import { useWidth } from "@/composables/width";
import { storeFor } from "@/lib/browser/store";
import { cn } from "@/lib/cn";
import { LANGUAGES } from "@/lib/languages";
import BoxConnection from "./BoxConnection.vue";
import ChoiceGrid from "./ChoiceGrid.vue";
import ToggleRow from "./ToggleRow.vue";

const SECTIONS = [
  { id: "model", label: "Model", icon: "brain" },
  { id: "agent", label: "Agent", icon: "layout-grid" },
  { id: "knowledge", label: "Knowledge", icon: "search" },
  { id: "language", label: "Language", icon: "languages" },
  { id: "tools", label: "Tools", icon: "wrench" },
  { id: "mcp", label: "MCP servers", icon: "library" },
  { id: "memory", label: "Memory & skills", icon: "notebook" },
  { id: "storage", label: "Storage", icon: "file-text" },
  { id: "kiosk", label: "Layout & voice", icon: "message-square" },
];

const section = ref("model");
const { el, width } = useWidth();
const { data: catalog, error: catalogError } = useProviders();
const { data: caps, error: capsError } = useCapabilities();
const voice = useSpeechOutput();
const cleared = ref<string | null>(null);
const active = computed(() => effectiveSelection(settings, catalog.value));
const activeModels = computed(() => catalog.value?.providers.find((p) => p.id === active.value?.provider)?.models ?? []);
const agent = computed(() => settings.agent);
const on = (map: Record<string, boolean>, id: string) => map[id] !== false;
const setAgent = (patch: Partial<AgentSettings>) => updateSettings({ agent: { ...settings.agent, ...patch } });
const layoutLabel = (l: LayoutChoice) => (l === "pod" ? "Pod player" : l === "full" ? "Full kiosk" : l);
const layoutChoices: LayoutChoice[] = ["auto", ...LAYOUTS];
const knowledge = computed(() => settings.agent.knowledge);
const activeEmbedding = computed<{ label: string; sizeMb: number; languages: readonly string[] }>(() => EMBEDDING_MODELS[embeddingModelFor(knowledge.value.model, settings.agent.language)]);
// The voices that speak the kiosk language (en-US -> "en"), from what the browser has installed.
const kioskLanguage = computed(() => LANGUAGES.find((l) => l.code === settings.agent.language) ?? LANGUAGES[0]);
const languageVoices = computed(() => voice.voices.value.filter((v) => v.lang.toLowerCase().startsWith(kioskLanguage.value.speech.slice(0, 2).toLowerCase())));
const setKnowledge = (patch: Partial<AgentSettings["knowledge"]>) => setAgent({ knowledge: { ...knowledge.value, ...patch } });

async function clearBrowser() {
  if (!confirm("Delete every notebook, source, memory and conversation kept in this browser?")) return;
  await storeFor("indexeddb").clear();
  await storeFor("session").clear();
  cleared.value = "Cleared everything this browser kept.";
}
</script>

<template>
  <div ref="el" class="mx-auto max-w-5xl space-y-6">
    <AdaptiveNav v-model:active="section" :screens="SECTIONS" mode="sidebar" storage-key="settings" :width="width">
      <template #model>
        <section class="card p-5">
          <h2 class="text-lg font-semibold text-ink">Model</h2>
          <p class="mt-1 text-sm text-gray-500">API keys are held on the server and never sent to your browser. Providers without a key are shown but can't be selected.</p>
          <p v-if="catalogError" role="alert" class="mt-4 flex items-center gap-2 rounded-md bg-danger/10 px-4 py-3 text-sm text-red-800"><ServerCrash class="size-4" /> Could not load providers: {{ catalogError }}.</p>
          <p v-else-if="!catalog" class="mt-4 text-sm text-gray-500">Loading providers…</p>
          <template v-else>
            <fieldset class="mt-4 grid gap-3 sm:grid-cols-2">
              <legend class="sr-only">Provider</legend>
              <label
                v-for="p in catalog.providers"
                :key="p.id"
                :class="cn('relative flex cursor-pointer flex-col rounded-lg border-2 p-3', active?.provider === p.id ? 'border-brand bg-brand/5' : 'border-gray-200 bg-white hover:border-gray-300', !p.configured && 'cursor-not-allowed opacity-60')"
              >
                <input type="radio" name="provider" :value="p.id" class="sr-only" :checked="active?.provider === p.id" :disabled="!p.configured" @change="updateSettings({ provider: p.id, model: p.models[0]?.id ?? null })" />
                <span class="flex items-center justify-between text-sm font-medium text-ink">
                  {{ p.label }}
                  <Check v-if="active?.provider === p.id" class="size-5 text-brand" aria-label="Selected" />
                  <Lock v-if="!p.configured" class="size-4 text-gray-400" aria-hidden="true" />
                </span>
                <span class="mt-1 text-xs text-gray-500">{{ p.configured ? `${p.models.length} models${p.local ? " · local network" : ""}` : "Not configured on this server" }}</span>
              </label>
            </fieldset>
            <div v-if="active" class="mt-5 grid gap-6 sm:grid-cols-2">
              <div>
                <label for="model" class="block text-sm font-medium text-ink">Model</label>
                <select id="model" class="input mt-1" :value="active.model" @change="updateSettings({ provider: active.provider, model: ($event.target as HTMLSelectElement).value })">
                  <option v-for="m in activeModels" :key="m.id" :value="m.id">{{ m.label }}</option>
                </select>
              </div>
              <div>
                <label for="temperature" class="block text-sm font-medium text-ink">Creativity <span class="text-gray-500">({{ settings.temperature.toFixed(1) }})</span></label>
                <input id="temperature" v-model.number="settings.temperature" type="range" min="0" max="1" step="0.1" class="mt-3 w-full accent-brand" />
                <p class="text-xs text-gray-500">Lower is more factual. Some models ignore this.</p>
              </div>
            </div>
          </template>
        </section>
      </template>

      <template #agent>
        <p v-if="!caps" class="text-sm text-gray-500">{{ capsError ?? "Loading…" }}</p>
        <div v-else class="space-y-4">
          <section class="card p-5">
            <h2 class="text-lg font-semibold text-ink">Agent</h2>
            <p class="mt-1 mb-4 text-sm text-gray-500">How the assistant is built. The deep agent plans, reads files, delegates to helpers, and uses memory and skills.</p>
            <ChoiceGrid name="harness" :options="caps.harness" :value="agent.harness" @change="(harness) => setAgent({ harness })" />
          </section>
          <section class="card p-5">
            <h2 class="text-lg font-semibold text-ink">Subagents</h2>
            <p class="mt-1 mb-3 text-sm text-gray-500">Helpers the deep agent can delegate to.</p>
            <ToggleRow v-for="s in caps.subagents" :key="s.id" :label="s.label" :description="s.description" :checked="on(agent.subagents, s.id)" @change="(v) => setAgent({ subagents: { ...agent.subagents, [s.id]: v } })" />
          </section>
        </div>
      </template>

      <template #knowledge>
        <p v-if="!caps" class="text-sm text-gray-500">{{ capsError ?? "Loading…" }}</p>
        <div v-else class="space-y-4">
          <section class="card p-5">
            <h2 class="text-lg font-semibold text-ink">How questions are answered</h2>
            <p class="mt-1 mb-4 text-sm text-gray-500">
              Answers come only from the kiosk's knowledge base and your notebook, as facts with their sources and no opinions. A sentence-transformer running in this browser finds the passages
              that match a question, in any of the kiosk's languages. The first use downloads it (about 120 MB); after that it works offline.
            </p>
            <ChoiceGrid name="answers" :options="caps.answers" :value="knowledge.answers" @change="(answers) => setKnowledge({ answers })" />
          </section>
          <section class="card p-5">
            <h2 class="text-lg font-semibold text-ink">Sentence-transformer</h2>
            <p class="mt-1 mb-4 text-sm text-gray-500">
              The model that matches questions with the knowledge base on this device. For {{ kioskLanguage.label }} it uses
              <strong class="font-medium text-ink">{{ activeEmbedding.label }}</strong> (about {{ activeEmbedding.sizeMb }} MB, downloaded once).
              <span v-if="!activeEmbedding.languages.includes(kioskLanguage.code)" class="text-red-800">It wasn't trained on {{ kioskLanguage.label }}: choose LaBSE or Automatic.</span>
            </p>
            <ChoiceGrid name="embedding-model" :options="caps.embeddingModels" :value="knowledge.model" @change="(model) => setKnowledge({ model })" />
          </section>
          <section class="card p-5">
            <h2 class="text-lg font-semibold text-ink">Web search fallback</h2>
            <p class="mt-1 text-sm text-gray-500">
              When the knowledge base and your notebook don't cover a question, the kiosk can search the web, re-rank the results by meaning, and give the AI agent the best ones to answer
              from, cited by site. The question is sent to the search service, so possible emergencies are never searched.
            </p>
            <p v-if="!caps.web" class="mt-3 rounded-lg bg-mist px-3 py-3 text-sm text-gray-600">
              Not set up on this server. An administrator adds <code>TAVILY_API_KEY</code> or <code>BRAVE_SEARCH_API_KEY</code> (and optionally <code>WEB_SEARCH_DOMAINS</code> to limit it to trusted sites).
            </p>
            <template v-else>
              <ToggleRow
                class="mt-3"
                label="Search the web when the knowledge base doesn't cover a question"
                :description="`Uses ${caps.web.provider === 'tavily' ? 'Tavily' : 'Brave Search'}${caps.web.domains.length ? `, limited to ${caps.web.domains.join(', ')}` : ''}. Answers say which site they come from.`"
                :checked="knowledge.web !== 'off'"
                @change="(v) => setKnowledge({ web: v ? 'fallback' : 'off' })"
              />
            </template>
          </section>
          <section class="card p-5">
            <h2 class="text-lg font-semibold text-ink">On-device search for the agent</h2>
            <ToggleRow
              class="mt-3"
              label="Search on this device and pass the matches to the agent"
              description="The question is searched in this browser and only the matching entries' ids go with it; the server looks up their text itself. Off: the agent uses keyword search."
              :checked="knowledge.semantic"
              @change="(semantic) => setKnowledge({ semantic })"
            />
          </section>
        </div>
      </template>

      <template #language>
        <section class="card p-5">
          <h2 class="text-lg font-semibold text-ink">Language</h2>
          <p class="mt-1 mb-4 text-sm text-gray-500">
            The language visitors speak and read. Voice input and read-aloud use it, the AI agent replies in it, and answers given on this device are translated into it on this device. You can also
            change it on the kiosk screen.
          </p>
          <label for="language" class="block text-sm font-medium text-ink">Kiosk language</label>
          <select id="language" class="input mt-1 max-w-sm" :value="agent.language" @change="setAgent({ language: ($event.target as HTMLSelectElement).value as LanguageCode })">
            <option v-for="l in LANGUAGES" :key="l.code" :value="l.code" :lang="l.speech">{{ l.native === l.label ? l.label : `${l.native} · ${l.label}` }}</option>
          </select>
        </section>
      </template>

      <template #tools>
        <p v-if="!caps" class="text-sm text-gray-500">{{ capsError ?? "Loading…" }}</p>
        <section v-else class="card p-5">
          <h2 class="text-lg font-semibold text-ink">Tools</h2>
          <p class="mt-1 mb-3 text-sm text-gray-500">What the assistant may use. Escalation to a human is always on.</p>
          <ToggleRow
            v-for="t in caps.tools"
            :key="t.id"
            :label="t.label"
            :description="t.description"
            :locked="'locked' in t && t.locked"
            :checked="('locked' in t && t.locked) || on(agent.tools, t.id)"
            @change="(v) => setAgent({ tools: { ...agent.tools, [t.id]: v } })"
          />
        </section>
      </template>

      <template #mcp>
        <p v-if="!caps" class="text-sm text-gray-500">{{ capsError ?? "Loading…" }}</p>
        <section v-else class="card p-5">
          <h2 class="text-lg font-semibold text-ink">MCP servers</h2>
          <p class="mt-1 mb-3 text-sm text-gray-500">Model Context Protocol servers give the assistant more tools. Only servers this site's administrator configured (<code>MCP_SERVERS</code>) are offered; their results are treated as untrusted data.</p>
          <p v-if="!caps.mcp.length" class="rounded-lg bg-mist px-3 py-3 text-sm text-gray-600">No MCP servers are configured on this server.</p>
          <ToggleRow
            v-for="s in caps.mcp"
            :key="s.id"
            :label="s.label"
            :description="`${s.description ? `${s.description} · ` : ''}${s.host}`"
            :checked="agent.mcp.includes(s.id)"
            @change="(v) => setAgent({ mcp: v ? [...agent.mcp, s.id] : agent.mcp.filter((x) => x !== s.id) })"
          />
        </section>
      </template>

      <template #memory>
        <p v-if="!caps" class="text-sm text-gray-500">{{ capsError ?? "Loading…" }}</p>
        <div v-else class="space-y-4">
          <section class="card p-5">
            <h2 class="text-lg font-semibold text-ink">Memory</h2>
            <p class="mt-1 mb-3 text-sm text-gray-500">Each notebook keeps a memory file the assistant reads every turn and updates when you state a lasting preference. You can edit it on the Notebook screen.</p>
            <ToggleRow label="Use and update notebook memory" :checked="agent.memory" @change="(memory) => setAgent({ memory })" />
          </section>
          <section class="card p-5">
            <h2 class="text-lg font-semibold text-ink">Skills</h2>
            <p class="mt-1 mb-3 text-sm text-gray-500">Playbooks the deep agent reads before doing a task. They come with the kiosk and are reviewed like its content.</p>
            <ToggleRow v-for="s in caps.skills" :key="s.name" :label="s.name" :description="s.description" :checked="on(agent.skills, s.name)" @change="(v) => setAgent({ skills: { ...agent.skills, [s.name]: v } })" />
          </section>
        </div>
      </template>

      <template #storage>
        <p v-if="!caps" class="text-sm text-gray-500">{{ capsError ?? "Loading…" }}</p>
        <section v-else class="card p-5">
          <h2 class="text-lg font-semibold text-ink">Storage</h2>
          <p class="mt-1 mb-4 text-sm text-gray-500">Where notebooks, conversations and memory are kept. Switching doesn't move what's already stored.</p>
          <ChoiceGrid name="storage" :options="caps.storage" :value="agent.storage" @change="(storage) => setAgent({ storage })" />
          <BoxConnection v-if="agent.storage === 'box'" />
          <div class="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" class="btn-light text-red-800" @click="clearBrowser">Clear this browser's kiosk data</button>
            <span v-if="cleared" role="status" class="text-sm text-gray-600">{{ cleared }}</span>
          </div>
        </section>
      </template>

      <template #kiosk>
        <div class="space-y-4">
          <section class="card p-5">
            <h2 class="text-lg font-semibold text-ink">Layout</h2>
            <p class="mt-1 mb-3 text-sm text-gray-500">Auto picks Mini, Pod or Full from the screen size. You can also switch on the kiosk screen.</p>
            <div role="radiogroup" aria-label="Kiosk layout" class="flex flex-wrap gap-2">
              <button v-for="l in layoutChoices" :key="l" type="button" role="radio" :aria-checked="settings.layout === l" :class="cn('rounded-full px-4 py-1.5 text-sm capitalize', settings.layout === l ? 'bg-brand text-white' : 'bg-mist text-gray-700 hover:text-ink')" @click="updateSettings({ layout: l })">{{ layoutLabel(l) }}</button>
            </div>
          </section>
          <section class="card p-5">
            <h2 class="text-lg font-semibold text-ink">Voice</h2>
            <ToggleRow class="mt-3" label="Read answers aloud" :checked="settings.speakResponses" @change="(v) => updateSettings({ speakResponses: v })" />
            <div class="mt-3 grid gap-6 sm:grid-cols-2">
              <div>
                <label for="voice" class="block text-sm font-medium text-ink">Voice</label>
                <select id="voice" class="input mt-1" :value="settings.voiceName ?? ''" @change="updateSettings({ voiceName: ($event.target as HTMLSelectElement).value || null })">
                  <option value="">Browser default</option>
                  <option v-for="v in languageVoices" :key="v.name" :value="v.name">{{ v.name }} ({{ v.lang }})</option>
                </select>
                <p class="mt-1 text-xs text-gray-500">Voices for {{ kioskLanguage.label }}, installed in this browser and system.</p>
                <p v-if="!languageVoices.length" role="status" class="mt-2 rounded-md bg-warning/30 px-3 py-2 text-xs text-ink">
                  No {{ kioskLanguage.label }} voice is installed here, so answers in {{ kioskLanguage.label }} are shown but may not be read aloud. Install one in the system's language settings
                  (Windows: Settings → Time &amp; Language → Language → add {{ kioskLanguage.label }} with speech), or use Microsoft Edge, which offers online voices for every kiosk language.
                </p>
              </div>
              <div>
                <label for="rate" class="block text-sm font-medium text-ink">Speaking rate <span class="text-gray-500">({{ settings.speechRate.toFixed(1) }}×)</span></label>
                <input id="rate" v-model.number="settings.speechRate" type="range" min="0.6" max="1.6" step="0.1" class="mt-3 w-full accent-brand" />
              </div>
            </div>
            <button type="button" class="btn-light mt-4" @click="voice.speak('Hello, I am YAXB. How may I help you?', { voiceName: settings.voiceName, rate: settings.speechRate })">Test voice</button>
          </section>
        </div>
      </template>
    </AdaptiveNav>
    <p class="text-center text-sm text-gray-500">Settings are saved in this browser automatically. <RouterLink to="/kiosk" class="font-medium text-brand-dark underline">Open the kiosk</RouterLink></p>
  </div>
</template>
