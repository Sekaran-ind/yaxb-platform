<script setup lang="ts">
// The kiosk. Three layouts from one config (yaxb-core content/screens.yaml):
//   full  the console column and the screens side by side (the original kiosk)
//   pod   the "pod player": the console as a strip, screens below
//   mini  a compact card: orb and mic, one screen at a time
// Owns the conversation, voice, notebook and journey handlers, and passes them to the screens.
import { kioskContent } from "@sekaran-ind/yaxb-core/content";
import type { ServiceHandler } from "@sekaran-ind/yaxb-core/journeys";
import { composeLocalAnswer, EMBEDDING_MODELS, type LocalAnswer } from "@sekaran-ind/yaxb-core/knowledge/semantic";
import { LAYOUTS, resolveLayout, screensFor, type LayoutChoice } from "@sekaran-ind/yaxb-core/screens";
import { DEFAULT_LANGUAGE, type LanguageCode } from "@sekaran-ind/yaxb-core/settings";
import { Languages, Settings2, X } from "@lucide/vue";
import { computed, onBeforeUnmount, onMounted, ref, toRef } from "vue";
import { askOnce, useChat } from "@/composables/chat";
import { useNotebook } from "@/composables/notebook";
import { effectiveSelection, settings, updateSettings, useProviders } from "@/composables/settings";
import { useSpeechInput, useSpeechOutput } from "@/composables/speech";
import { useWidth } from "@/composables/width";
import { answer, classify, onOfflineProgress, summarize, translate, type OfflineProgress } from "@/lib/browser/offline";
import { modelFor, searchLocal, semanticReady, warmUp, type LocalSearch } from "@/lib/browser/semantic";
import { cn } from "@/lib/cn";
import { LANGUAGES, speechLangFor } from "@/lib/languages";
import type { KioskStatus } from "@/lib/types";
import AdaptiveNav, { type NavScreen } from "./AdaptiveNav.vue";
import KnowledgeSources from "./KnowledgeSources.vue";
import NotebookScreen from "./NotebookScreen.vue";
import PatientInfo from "./PatientInfo.vue";
import PlayerPanel from "./PlayerPanel.vue";
import SandboxPane from "./SandboxPane.vue";
import ScorecardPane from "./ScorecardPane.vue";
import ServicesScreen from "./ServicesScreen.vue";
import TranscriptPane from "./TranscriptPane.vue";
import TranslatePane from "./TranslatePane.vue";


const activeNotebook = computed({ get: () => settings.activeNotebook, set: (id) => updateSettings({ activeNotebook: id }) });
const nb = useNotebook(toRef(() => settings.agent.storage), activeNotebook, toRef(() => settings.box));
const chat = useChat(nb.store, nb.refresh);
const { data: catalog, error: catalogError } = useProviders();
const voiceOut = useSpeechOutput();
const failed = ref(false);
const screen = ref<string | null>(kioskContent.screens.defaultScreen ?? null);
const journey = ref<string | null>(null);
const journeyBusy = ref(false);
const offline = ref<OfflineProgress | null>(null);
const { el: root, width } = useWidth();
const layout = computed(() => resolveLayout(width.value, settings.layout));
const selection = computed(() => {
  const s = effectiveSelection(settings, catalog.value);
  return s ? { ...s, temperature: settings.temperature } : null;
});

let offProgress: (() => void) | null = null;
onMounted(() => (offProgress = onOfflineProgress((p) => (offline.value = p.status === "done" || p.status === "ready" ? null : p))));
onBeforeUnmount(() => offProgress?.());

// The visitor's language: speech in and out, the agent's replies, on-device answers translated.
const language = computed<LanguageCode>(() => settings.agent.language ?? DEFAULT_LANGUAGE);
function setLanguage(code: LanguageCode) {
  updateSettings({ agent: { ...settings.agent, language: code } });
}

// How questions are answered (Settings → Knowledge). Automatic falls back to the device when no
// AI provider is configured.
const answers = computed(() => {
  const a = settings.agent.knowledge?.answers ?? "agent";
  return a === "auto" && !selection.value ? "local" : a;
});
const canAsk = computed(() => !chat.busy.value && (answers.value === "local" || !!selection.value));

/** Escalations from on-device answers reach the moderators like the agent's. */
function flag(f: NonNullable<LocalAnswer["flag"]>) {
  void fetch("/api/agent/flag", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) }).catch(() => undefined);
}

/** The answer from on-device matches, with the thresholds calibrated for the model that found them. */
function localAnswer(question: string, found: LocalSearch) {
  const t = EMBEDDING_MODELS[found.model].thresholds;
  return composeLocalAnswer(question, found, { threshold: t.answer, notebookThreshold: t.notebook });
}

/** An on-device answer, translated on the device when the visitor chose another language. */
async function present(a: LocalAnswer, signal: AbortSignal) {
  if (a.flag) flag(a.flag);
  const sources = a.text.slice(a.body.length);
  if (language.value === "eng_Latn") return { text: a.text, spoken: a.body };
  try {
    const body = await translate(a.body, language.value, { signal });
    return { text: `${body}\n\nTranslated on this device from English.${sources}`, spoken: body };
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    return { text: `${a.body}\n\nTranslation is unavailable, so this is in English.${sources}`, spoken: a.body };
  }
}

async function ask(question: string) {
  const mode = answers.value;
  if (mode !== "local" && !selection.value) return;
  screen.value = "transcript";
  journey.value = null;
  failed.value = false;
  voiceOut.cancel();
  const ctx = { settings: settings.agent, notebook: nb.notebook.value };
  const semantic = settings.agent.knowledge?.semantic !== false;
  const model = modelFor(settings.agent, question);
  try {
    let reply: string;
    if (mode === "local") {
      reply = await chat.sendLocal(question, ctx, async (signal) => present(localAnswer(question, await searchLocal(model, question, ctx.notebook, { signal })), signal));
    } else {
      // Search on the device first when its model is ready; never hold a question for the download.
      let found: LocalSearch | null = null;
      if (mode === "auto" || semantic) {
        if (semanticReady(model)) found = await searchLocal(model, question, ctx.notebook).catch(() => null);
        else warmUp(model).catch(() => undefined);
      }
      const local = mode === "auto" && found ? localAnswer(question, found) : null;
      if (local && local.kind !== "none") reply = await chat.sendLocal(question, ctx, (signal) => present(local, signal));
      else reply = await chat.send(question, selection.value!, { ...ctx, retrieved: semantic && found ? found.refs : [] });
    }
    if (settings.speakResponses && reply) await voiceOut.speak(reply, { voiceName: settings.voiceName, rate: settings.speechRate, lang: speechLangFor(language.value) });
  } catch {
    failed.value = true;
  }
}
const voiceIn = useSpeechInput(ask, () => speechLangFor(language.value));

// Journey handlers: they read the current notebook, model and settings when they run.
const text = (v: unknown) => String((v as { text?: unknown })?.text ?? "");
async function busy<T>(work: () => Promise<T>): Promise<T> {
  journeyBusy.value = true;
  try {
    return await work();
  } finally {
    journeyBusy.value = false;
  }
}
const services: Record<string, ServiceHandler> = {
  "agent.ask": (input, { signal }) =>
    busy(async () => {
      if (!selection.value) throw new Error("No AI provider is configured. Choose one in Settings.");
      const notebook = await nb.latest();
      return { text: await askOnce(String((input as { message?: unknown }).message ?? ""), selection.value, { settings: settings.agent, notebook, store: nb.store.value }, signal) };
    }),
  "offline.summarize": (input, { signal }) => busy(async () => ({ text: await summarize(text(input), signal) })),
  "offline.translate": (input, { signal }) => busy(async () => ({ text: await translate(text(input), String((input as { language?: unknown }).language ?? "eng_Latn"), { signal }) })),
  "offline.answer": (input, { signal }) =>
    busy(async () => {
      const i = input as { question?: unknown; context?: unknown };
      return answer(String(i.question ?? ""), String(i.context ?? ""), signal);
    }),
  "offline.classify": (input, { signal }) => busy(async () => classify(text(input), signal)),
  "notebook.add": async (input) => {
    const i = input as { title?: unknown; text?: unknown };
    if (!String(i.text ?? "").trim()) throw new Error("There's nothing to save.");
    await nb.addSource({ title: String(i.title ?? "Note").slice(0, 200), mime: "text/plain", text: String(i.text) });
    return { saved: true };
  },
  "notebook.remember": async (input) => {
    await nb.remember(text(input));
    return { saved: true };
  },
  "speech.speak": async (input) => {
    const i = input as { text?: unknown; language?: unknown };
    await voiceOut.speak(String(i.text ?? ""), { lang: speechLangFor(String(i.language ?? "eng_Latn")) });
    return {};
  },
};

const status = computed<KioskStatus>(() => {
  const last = chat.turns.value[chat.turns.value.length - 1];
  if (voiceIn.listening.value) return "Listening";
  if (chat.busy.value) return last?.tools.some((t) => !t.done) ? "Thinking" : "Fetching";
  if (journeyBusy.value) return "Thinking";
  if (voiceOut.paused.value) return "Paused";
  if (voiceOut.speaking.value) return "Playing Response";
  if (failed.value) return "Fetch failed";
  return "Ready";
});

const sourceCount = computed(() => nb.notebook.value?.sources.length ?? 0);
const navScreens = computed<NavScreen[]>(() =>
  screensFor(kioskContent.screens, layout.value).map((s) => ({
    id: s.id,
    label: s.label,
    icon: s.icon,
    badge: s.id === "notebook" && sourceCount.value ? String(sourceCount.value) : undefined,
  })),
);
const componentOf = (id: string) => kioskContent.screens.screens.find((s) => s.id === id)?.component;
const lastAnswer = computed(() => [...chat.turns.value].reverse().find((t) => t.role === "assistant" && t.text)?.text);

function setScreen(id: string) {
  screen.value = id;
  if (id !== "services") journey.value = null;
}
function onMic() {
  if (voiceIn.listening.value) voiceIn.stop();
  else voiceIn.start();
}
function onPauseResume() {
  if (voiceOut.paused.value) voiceOut.resume();
  else voiceOut.pause();
}
function onStop() {
  voiceOut.cancel();
  chat.stop();
}

const LAYOUT_LABELS: Record<LayoutChoice, string> = { auto: "Auto", mini: "Mini", pod: "Pod", full: "Full" };
const layoutChoices: LayoutChoice[] = ["auto", ...LAYOUTS];
const playerVariant = computed(() => (layout.value === "full" ? "full" : layout.value === "pod" ? "strip" : "mini"));
const navWidth = computed(() => (layout.value === "full" ? (width.value * 2) / 3 : width.value));
</script>

<template>
  <!-- Measure the full available width (not the mini card), so Auto can grow back out of mini. -->
  <div ref="root" class="w-full">
    <div :class="cn('mx-auto px-2 py-4 sm:px-4', layout === 'mini' ? 'max-w-md' : 'max-w-7xl')">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div class="min-w-0">
          <h1 :class="cn('font-bold tracking-tight text-ink', layout === 'mini' ? 'text-xl' : 'text-2xl')">YAXB AI Kiosk!</h1>
          <p v-if="nb.notebook.value" class="truncate text-xs text-gray-500">
            Notebook: {{ nb.notebook.value.title }} · {{ sourceCount }} source{{ sourceCount === 1 ? "" : "s" }}
            <span v-if="offline" class="ml-2 text-info">· Loading on-device model{{ offline.progress ? ` ${Math.round(offline.progress)}%` : "…" }}</span>
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="Kiosk layout" class="flex rounded-full bg-mist p-1 text-xs">
            <button
              v-for="l in layoutChoices"
              :key="l"
              type="button"
              role="radio"
              :aria-checked="settings.layout === l"
              :title="l === 'auto' ? `Automatic (now ${LAYOUT_LABELS[layout]})` : undefined"
              :class="cn('rounded-full px-2.5 py-1 font-medium', settings.layout === l ? 'bg-white text-ink shadow-sm' : 'text-gray-600 hover:text-ink')"
              @click="updateSettings({ layout: l })"
            >
              {{ LAYOUT_LABELS[l] }}
            </button>
          </div>
          <label class="flex items-center gap-1.5 rounded-full bg-mist py-1 pr-1 pl-3 text-xs text-gray-600">
            <Languages class="size-4" aria-hidden="true" />
            <span class="sr-only">Language</span>
            <select
              class="rounded-full border-0 bg-white py-1 pr-7 pl-2 text-xs font-medium text-ink shadow-sm"
              :value="language"
              aria-label="Language"
              @change="setLanguage(($event.target as HTMLSelectElement).value as LanguageCode)"
            >
              <option v-for="l in LANGUAGES" :key="l.code" :value="l.code" :lang="l.speech">{{ l.native === l.label ? l.label : `${l.native} · ${l.label}` }}</option>
            </select>
          </label>
          <RouterLink to="/settings" class="btn-light px-3 py-2" aria-label="Settings"><Settings2 class="size-4" aria-hidden="true" /></RouterLink>
          <RouterLink to="/" class="btn bg-warning px-3 py-2 text-ink hover:brightness-95"><X class="size-4" aria-hidden="true" /> Close</RouterLink>
        </div>
      </div>

      <div :class="cn(layout === 'full' ? 'grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]' : layout === 'pod' ? 'space-y-3' : 'space-y-2')">
        <PlayerPanel
          :variant="playerVariant"
          :status="status"
          title="CA Health Kiosk"
          :is-playing="voiceOut.speaking.value && !voiceOut.paused.value"
          :speaking="voiceOut.speaking.value"
          :listening="voiceIn.listening.value"
          :interim="voiceIn.interim.value"
          :voice-supported="voiceIn.supported.value"
          :can-ask="canAsk"
          @mic="onMic"
          @pause-resume="onPauseResume"
          @stop="onStop"
        />
        <div
          :class="
            cn(
              'rounded-2xl bg-white shadow-sm ring-1 ring-gray-100',
              layout === 'full' && 'h-[600px] overflow-y-auto p-4 [scrollbar-width:thin]',
              layout === 'pod' && 'min-h-[520px] p-4',
              layout === 'mini' && 'p-3',
            )
          "
        >
          <AdaptiveNav
            :screens="navScreens"
            :mode="kioskContent.screens.nav?.[layout]"
            :storage-key="`kiosk-${layout}`"
            :active="screen"
            :width="navWidth"
            :body-class="layout === 'mini' ? 'max-h-[70vh] overflow-y-auto [scrollbar-width:thin]' : ''"
            @update:active="setScreen"
          >
            <template v-for="s in navScreens" :key="s.id" #[s.id]>
              <TranscriptPane
                v-if="componentOf(s.id) === 'transcript'"
                :turns="chat.turns.value"
                :busy="chat.busy.value"
                :selection="selection"
                :can-ask="canAsk"
                :answers="answers"
                :catalog="catalog"
                :catalog-error="catalogError"
                :notebook-title="nb.notebook.value?.title ?? null"
                :source-count="sourceCount"
                @ask="ask"
                @reset="chat.reset"
              />
              <ServicesScreen
                v-else-if="componentOf(s.id) === 'services'"
                :layout="layout"
                :open-journey="journey"
                :services="services"
                :notebook="nb.notebook.value"
                @open-journey="(id) => (journey = id)"
                @open-screen="setScreen"
                @speak="(t) => voiceOut.speak(t)"
              />
              <NotebookScreen
                v-else-if="componentOf(s.id) === 'notebook'"
                :nb="nb"
                :active-thread-id="chat.threadId.value"
                @open-thread="(id) => (chat.open(id), (screen = 'transcript'))"
                @new-thread="() => (chat.reset(), (screen = 'transcript'))"
              />
              <PatientInfo v-else-if="componentOf(s.id) === 'patient-info'" />
              <KnowledgeSources v-else-if="componentOf(s.id) === 'records'" />
              <ScorecardPane v-else-if="componentOf(s.id) === 'scorecard'" />
              <TranslatePane v-else-if="componentOf(s.id) === 'translate'" :initial-text="lastAnswer" @speak="(t, lang) => voiceOut.speak(t, { lang })" />
              <SandboxPane v-else-if="componentOf(s.id) === 'sandbox'" />
            </template>
          </AdaptiveNav>
        </div>
      </div>
    </div>
  </div>
</template>
