<script setup lang="ts">
// The kiosk. Three layouts from one config (yaxb-core content/screens.yaml):
//   full  the console column and the screens side by side (the original kiosk)
//   pod   the "pod player": the console as a strip, screens below
//   mini  a compact card: orb and mic, one screen at a time
// Owns the conversation, voice, notebook and journey handlers, and passes them to the screens.
import { aboutKiosk, confirmText, PROFILE_FORM, profileFields, profilePatch, type CommandEffect, type CommandMatch } from "@sekaran-ind/yaxb-core/commands";
import { kioskContent } from "@sekaran-ind/yaxb-core/content";
import type { ServiceHandler } from "@sekaran-ind/yaxb-core/journeys";
import { composeLocalAnswer, composeWebAnswer, EMBEDDING_MODELS, looksLikeEmergency, type LocalAnswer } from "@sekaran-ind/yaxb-core/knowledge/semantic";
import { resolveLayout, screensFor } from "@sekaran-ind/yaxb-core/screens";
import { DEFAULT_LANGUAGE, type LanguageCode } from "@sekaran-ind/yaxb-core/settings";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, toRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { logActivity, useAccount } from "@/composables/account";
import { askOnce, useChat } from "@/composables/chat";
import { useNotebook } from "@/composables/notebook";
import { useFeedback } from "@/composables/feedback";
import { effectiveSelection, settings, updateSettings, useCapabilities, useProviders } from "@/composables/settings";
import { useSpeechInput, useSpeechOutput } from "@/composables/speech";
import { useWidth } from "@/composables/width";
import { answer, classify, onOfflineProgress, summarize, translate, type OfflineProgress } from "@/lib/browser/offline";
import { recognizeCommand, yesOrNo } from "@/lib/browser/commands";
import { modelFor, searchLocal, semanticReady, warmUp, type LocalSearch } from "@/lib/browser/semantic";
import { extractWithModel, matchOnDevice } from "@/lib/browser/slots";
import { languageLabel, speechLangFor } from "@/lib/languages";
import type { CommandCard, JourneyTurn, KioskStatus } from "@/lib/types";
import { catalogue, entryOfJourney, kioskJourneys, kioskViewer, loadCatalogue, loadIntoKiosk } from "@/composables/library";
import { startCaseNetwork } from "@/composables/cases";
import { readDocument } from "@/lib/browser/documents";
import AccountScreen from "@/components/account/AccountScreen.vue";
import { AdaptiveNav, type NavScreen } from "@sekaran-ind/yaxb-journeys/vue";
import FeedbackPrompt from "./FeedbackPrompt.vue";
import KnowledgeSources from "./KnowledgeSources.vue";
import NotebookScreen from "./NotebookScreen.vue";
import PlayerPanel from "./PlayerPanel.vue";
import ServicesScreen from "./ServicesScreen.vue";
import TranscriptPane from "./TranscriptPane.vue";
import KioskPreferences from "./KioskPreferences.vue";
import ProfileButton from "./ProfileButton.vue";
import TranslatePane from "./TranslatePane.vue";
import KioskFrame from "@/components/site/KioskFrame.vue";
import { SlidersHorizontal } from "@lucide/vue";
import { NATIVE } from "@/lib/platform";
import { endSession, restricted, sessionEnds } from "@/composables/restricted";
import { serviceDocuments } from "@/composables/notebook";
import { loadedServices } from "@/composables/library";
import ProfilePicker from "@/components/account/ProfilePicker.vue";
import RestrictedUnlock from "./RestrictedUnlock.vue";
import type { NotebookSource } from "@sekaran-ind/yaxb-core/notebook";
import type { StorageId } from "@sekaran-ind/yaxb-core/settings";
import { LogOut, Lock } from "@lucide/vue";
import { formInput } from "@/composables/form-input";

/**
 * `embedded`: only Ask Me, without the kiosk's frame, player and tabs, for another surface (the
 * Service Catalogue's Ask Me screen): the same conversation, notebook, journeys and requests.
 */
const props = defineProps<{ embedded?: boolean }>();

/** The kiosk's name, in its player and for screen readers. */
const KIOSK_NAME = "Anjal - Digital Kiosk (Your Own)";


const activeNotebook = computed({ get: () => settings.activeNotebook, set: (id) => updateSettings({ activeNotebook: id }) });
const account = useAccount();
// Notebooks are the open profile's (or this device's), and services' for staff (PRF-2). At the front
// desk (Restricted Mode) a visit keeps nothing: its notebook and conversation live in session memory.
const nbStorage = computed<StorageId>(() => (restricted.value ? "session" : settings.agent.storage));
const nbScope = computed(() => ({ owner: restricted.value ? null : account.profileId.value, staff: !restricted.value && (kioskViewer.value.member || kioskViewer.value.admin) }));
const nb = useNotebook(nbStorage, activeNotebook, toRef(() => settings.box), nbScope);
const chat = useChat(nb.store, nb.refresh);

// ---- the front desk (Restricted Mode, RST-1..6) ----------------------------------------------------
/** The chosen services' documents and SOPs: what the front desk answers from. */
const frontDocs = shallowRef<NotebookSource[]>([]);
watch(
  [restricted, () => settings.restricted.services.join()],
  async () => {
    frontDocs.value = restricted.value ? await serviceDocuments(settings.restricted.services, settings.agent.storage, settings.box) : [];
  },
  { immediate: true },
);
/** The notebook a turn goes with: at the front desk, the services' documents and what the visitor attached. */
const turnNotebook = computed(() => {
  const n = nb.notebook.value;
  if (!n || !restricted.value) return n;
  return { ...n, title: "Front desk", sources: [...frontDocs.value, ...n.sources] };
});
/** At the front desk nothing is kept on the server either. */
const agentSettings = computed(() => (restricted.value ? { ...settings.agent, storage: "session" as const } : settings.agent));
const turnCtx = () => ({ settings: agentSettings.value, notebook: turnNotebook.value });
/** The services' journeys anyone may start: the front desk's tiles. */
const frontJourneys = computed(() =>
  loadedServices.value
    .filter((s) => settings.restricted.services.includes(s.meta.entry_id))
    .flatMap((s) => s.journeys.filter((j) => !j.roles?.initiate?.length || j.roles.initiate.includes("visitor")).map((j) => ({ id: j.id, title: j.title, summary: j.summary ?? null, service: s.meta.title }))),
);
const unlocking = ref(false);
// A visit ends (End session, idle, or the front desk turned on): nothing of it stays.
watch(sessionEnds, async () => {
  voiceOut.cancel();
  chat.reset();
  for (const n of nb.notebooks.value) await nb.remove(n.id).catch(() => undefined);
  screen.value = "transcript";
});

// ---- profiles (PRF-1): who is using the kiosk ---------------------------------------------------------
const VISITOR_KEY = "yaxb.visitor";
const visitorChosen = ref(readVisitor());
function readVisitor() {
  try {
    return sessionStorage.getItem(VISITOR_KEY) === "1";
  } catch {
    return false;
  }
}
function chooseVisitor() {
  visitorChosen.value = true;
  try {
    sessionStorage.setItem(VISITOR_KEY, "1");
  } catch {
    /* private mode */
  }
}
// A profile that locks (by hand or after 10 quiet minutes) brings the picker back.
watch(
  () => account.profile.value,
  (p, before) => {
    if (before && !p) {
      visitorChosen.value = false;
      try {
        sessionStorage.removeItem(VISITOR_KEY);
      } catch {
        /* private mode */
      }
    }
  },
);
const showPicker = computed(() => !props.embedded && !restricted.value && account.list.value.length > 0 && !account.profile.value && !visitorChosen.value);
const { data: catalog, error: catalogError } = useProviders();
const { data: caps } = useCapabilities();
const feedback = useFeedback();
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
// Journeys and requests run in the conversation: the catalogue (and requests kept on devices) load with the kiosk.
onMounted(async () => {
  await loadCatalogue();
  // The catalogue's "Open in a kiosk" (/kiosk?load=<entry>) adds its service to this kiosk.
  const load = route.query.load;
  if (typeof load === "string" && catalogue.value.some((s) => s.entry_id === load)) {
    loadIntoKiosk(load);
    const { load: _, ...query } = route.query;
    void router.replace({ path: route.path, query });
  }
  startCaseNetwork();
});
onBeforeUnmount(() => offProgress?.());

// The visitor's language: speech in and out, the agent's replies, on-device answers translated.
const language = computed<LanguageCode>(() => settings.agent.language ?? DEFAULT_LANGUAGE);

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

/**
 * Kiosk only (no AI model), KNW-45: a question the device couldn't answer gets the web's top
 * results, quoted as found with their addresses, when this deployment has web search and the
 * visitor hasn't turned it off. Never for a possible emergency.
 */
async function withWeb(question: string, a: LocalAnswer, signal: AbortSignal): Promise<LocalAnswer> {
  if (a.kind !== "none" || a.emergency || settings.agent.knowledge?.web === "off" || !caps.value?.web) return a;
  try {
    const res = await fetch("/api/agent/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }), signal });
    if (!res.ok) return a;
    const { results } = (await res.json()) as { results: { title: string; url: string; snippet: string }[] };
    const web = composeWebAnswer(question, results);
    if (web) void logActivity("web.searched");
    return web ?? a;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    return a;
  }
}

/** An on-device answer, translated on the device when the visitor chose another language. */
async function present(a: LocalAnswer, signal: AbortSignal) {
  if (a.flag) {
    flag(a.flag);
    void logActivity("question.escalated", { via: "device" });
  }
  const sources = a.text.slice(a.body.length);
  // Read aloud without the list marks.
  const spoken = a.body.replace(/\*\*/g, "").replace(/^- /gm, "");
  if (language.value === "eng_Latn") return { text: a.text, spoken };
  try {
    const body = await translate(a.body, language.value, { signal });
    return { text: `${body}\n\nTranslated on this device from English.${sources}`, spoken: body };
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    return { text: `${a.body}\n\nTranslation is unavailable, so this is in English.${sources}`, spoken: a.body };
  }
}

// ---- kiosk commands (CMD-1..6, 10, 11): a card in the conversation, handled on this device ----------
const router = useRouter();
const route = useRoute();

// Preferences (profile, language, layout, theme, voice, knowledge, model…) open inside the kiosk,
// in place of its screens: /kiosk?prefs=<section>. There's no separate settings page.
const prefsOpen = computed(() => !restricted.value && typeof route.query.prefs === "string");
// Preferences open inside whichever surface this is (the kiosk, or the catalogue's Ask Me).
const openPrefs = (section = "profile") => void router.push({ path: props.embedded ? route.path : "/kiosk", query: props.embedded ? { ...route.query, prefs: section } : { prefs: section } });
const closePrefs = () => {
  const { prefs: _, ...query } = route.query;
  void router.push({ path: props.embedded ? route.path : "/kiosk", query: props.embedded ? query : {} });
};
const ANSWER_LABELS: Record<string, string> = { agent: "AI agent, grounded", local: "This device only", auto: "Automatic" };
const LAYOUT_NAMES: Record<string, string> = { auto: "Automatic", mini: "Simple (one thing at a time)", pod: "Pod", full: "Full" };
const clampRate = (r: number) => Math.round(Math.min(1.6, Math.max(0.6, r)) * 10) / 10;
const yesNo = (b: boolean) => (b ? "Yes" : "No");

/** What a settings command will change, now and after. */
function settingsChanges(e: Extract<CommandEffect, { type: "settings" }>) {
  const out: { label: string; from: string; to: string }[] = [];
  const k = settings.agent.knowledge;
  if (e.agent?.language) out.push({ label: "Language", from: languageLabel(settings.agent.language), to: languageLabel(e.agent.language) });
  if (e.agent?.knowledge?.answers) out.push({ label: "Answers come from", from: ANSWER_LABELS[k.answers] ?? k.answers, to: ANSWER_LABELS[e.agent.knowledge.answers] ?? e.agent.knowledge.answers });
  if (e.agent?.knowledge?.web) out.push({ label: "Web search", from: k.web === "off" ? "Off" : "On", to: e.agent.knowledge.web === "off" ? "Off" : "On" });
  if (e.kiosk?.speakResponses !== undefined) out.push({ label: "Read answers aloud", from: yesNo(settings.speakResponses), to: yesNo(e.kiosk.speakResponses) });
  if (e.kiosk?.layout) out.push({ label: "Layout", from: LAYOUT_NAMES[settings.layout] ?? settings.layout, to: LAYOUT_NAMES[e.kiosk.layout] ?? e.kiosk.layout });
  if (e.kiosk?.speechRateDelta) out.push({ label: "Speaking rate", from: `${settings.speechRate.toFixed(1)}×`, to: `${clampRate(settings.speechRate + e.kiosk.speechRateDelta).toFixed(1)}×` });
  return out.filter((c) => c.from !== c.to);
}

function applySettings(e: Extract<CommandEffect, { type: "settings" }>) {
  if (e.agent) updateSettings({ agent: { ...settings.agent, ...(e.agent.language ? { language: e.agent.language } : {}), knowledge: { ...settings.agent.knowledge, ...e.agent.knowledge } } });
  const k = e.kiosk ?? {};
  updateSettings({
    ...(k.speakResponses !== undefined ? { speakResponses: k.speakResponses } : {}),
    ...(k.layout ? { layout: k.layout } : {}),
    ...(k.speechRateDelta ? { speechRate: clampRate(settings.speechRate + k.speechRateDelta) } : {}),
  });
}

/** The visitor's words after "update my profile …", for slot filling. */
const profileWords = (text: string) => text.replace(/^.*?\bprofile\b[\s:,.-]*(?:with\s+|to\s+say\s+)?/i, "").trim();

/** Read the words into the profile's fields: the card's changes, or "nothing found". */
async function profileCard(match: CommandMatch, said: string): Promise<Partial<CommandCard>> {
  const current = account.profile.value!;
  const fills = said ? (await matchOnDevice(profileFields(), said, settings.agent).catch(() => null))?.fills ?? [] : [];
  const { profile, changes } = profilePatch(current, fills);
  return changes.length
    ? { title: `${match.command.label}?`, changes, profile, said, canAskAssistant: true }
    : { title: said ? "I couldn't tell what to change from that on this device." : "What would you like to change in your profile?", changes: [], profile: undefined, said, canAskAssistant: Boolean(said) };
}

async function cardFor(question: string, m: CommandMatch): Promise<CommandCard> {
  const e = m.effect;
  const base = { command: m.command.id, effect: e };
  if (m.command.needsProfile && !account.profile.value) return { ...base, title: `${m.command.label}: please sign in to your profile first.`, state: "needs-profile" };
  switch (e.type) {
    case "open-screen":
      setScreen(e.screen);
      return { ...base, title: `${m.command.label}.`, state: "done" };
    case "open-settings":
      openPrefs(e.section);
      return { ...base, title: `${m.command.label}.`, state: "done" };
    case "about":
      return { ...base, title: m.command.label, state: "info", text: aboutKiosk(e.topic, { journeys: kioskContent.journeys, webSearch: Boolean(caps.value?.web) && settings.agent.knowledge.web !== "off" }) };
    case "journey":
      return { ...base, title: `${m.command.label}: here is what it does.`, state: "info", journey: e.journey };
    case "refuse":
      return { ...base, title: "I can't do that from here.", state: "refused", text: e.reason };
    case "settings": {
      const changes = settingsChanges(e);
      return changes.length ? { ...base, title: confirmText(m), state: "confirm", changes } : { ...base, title: "That's already how the kiosk is set.", state: "done" };
    }
    case "profile":
      if (e.action === "open") {
        openPrefs("profile");
        return { ...base, title: `${m.command.label}.`, state: "done" };
      }
      if (e.action === "sign-out") return { ...base, title: `${m.command.label}?`, state: "confirm" };
      return { ...base, state: "confirm", ...(await profileCard(m, profileWords(question))) } as CommandCard;
  }
}

async function runCommand(question: string, m: CommandMatch) {
  const ctx = turnCtx();
  const card = await cardFor(question, m);
  await chat.addCard(question, card, ctx);
  if (card.state === "done" || card.state === "info") void logActivity("command.used", { command: m.command.id });
  if (settings.speakResponses) {
    const spoken = [card.title, card.state === "confirm" && card.changes?.length ? "Say yes or no." : "", card.text ?? ""].filter(Boolean).join(" ");
    void voiceOut.speak(spoken, { voiceName: settings.voiceName, rate: settings.speechRate, lang: speechLangFor(language.value) });
  }
}

/** A command card's button, or a spoken yes / no. */
/** Send an answer for the moderators to check (MOD-10): only on request, with the question and the notebook's name. */
async function reviewAnswer(turnId: string) {
  const turns = chat.turns.value;
  const i = turns.findIndex((t) => t.id === turnId);
  const turn = turns[i];
  const question = turns.slice(0, i).reverse().find((t) => t.role === "user")?.text;
  if (!turn || !question || turn.review === "sending" || turn.review === "sent") return;
  turn.review = "sending";
  const n = nb.notebook.value;
  try {
    const res = await fetch("/api/agent/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: question.slice(0, 1000), answer: turn.text.slice(0, 8000), notebook: n ? { id: n.id, title: n.title.slice(0, 120) || "Untitled notebook" } : null, mode: turn.local ? "local" : "agent", language: language.value }),
    });
    turn.review = res.ok ? "sent" : "failed";
    if (res.ok) void logActivity("answer.sent_for_review");
  } catch {
    turn.review = "failed";
  }
}

async function onCard(turnId: string, action: "yes" | "no" | "start" | "sign-in" | "ask-assistant") {
  const ctx = turnCtx();
  const card = chat.turns.value.find((t) => t.id === turnId)?.card;
  if (!card) return;
  if (action === "no") return chat.updateCard(turnId, { state: "cancelled" }, ctx);
  if (action === "sign-in") return openPrefs("profile");
  if (action === "start" && card.journey) {
    void logActivity("command.used", { command: card.command });
    return startJourney(card.journey);
  }
  if (action === "ask-assistant" && card.said && selection.value && account.profile.value) {
    try {
      const fills = await extractWithModel(PROFILE_FORM.journey, PROFILE_FORM.step, card.said, selection.value);
      const { profile, changes } = profilePatch(account.profile.value, fills);
      await chat.updateCard(turnId, changes.length ? { title: "Update your profile?", changes, profile, canAskAssistant: false } : { title: "The assistant found nothing to change either.", canAskAssistant: false }, ctx);
    } catch (e) {
      await chat.updateCard(turnId, { text: (e as Error).message }, ctx);
    }
    return;
  }
  if (action !== "yes" || card.state !== "confirm") return;
  const e = card.effect;
  if (e.type === "settings") applySettings(e);
  else if (e.type === "profile" && e.action === "sign-out") await account.lock();
  else if (e.type === "profile" && e.action === "update") {
    if (!card.profile) return;
    await account.update(card.profile);
  }
  void logActivity("command.used", { command: card.command });
  await chat.updateCard(turnId, { state: "done" }, ctx);
}

// ---- context in the conversation (LIB-49): journeys, requests and files -------------------------

/** Run a journey in the conversation (from /journeys, /staff, the notebook's services or Services). */
async function startJourney(id: string) {
  const j = kioskJourneys.value.find((x) => x.id === id);
  if (!j) return;
  screen.value = "transcript";
  journey.value = null;
  const turn: JourneyTurn = { id: j.id, entry: entryOfJourney(j.id), title: j.title, run: null, status: "running" };
  await chat.addTurns(j.title, { journey: turn, via: "journey" }, turnCtx());
}
/** A request's reference, kept in the conversation: its status shows whenever the conversation is open. */
async function showRequest(ref: string, open = false) {
  screen.value = "transcript";
  await chat.addTurns(ref, { request: { ref, ...(open ? { open } : {}) }, via: "request" }, turnCtx());
}
async function onJourneyUpdate(turnId: string, patch: Partial<JourneyTurn>) {
  const turn = chat.turns.value.find((t) => t.id === turnId);
  if (!turn?.journey) return;
  await chat.patchTurn(turnId, { journey: { ...turn.journey, ...patch } }, turnCtx());
}
// A link to a request (/kiosk?case=<id or reference>: shared in team chat, the old Services address)
// opens it in the conversation.
watch(
  () => route.query.case,
  (key) => {
    if (typeof key !== "string" || !key) return;
    const { case: _, ...query } = route.query;
    void router.replace({ path: route.path, query: { ...query, screen: "transcript" } });
    void showRequest(key.trim(), true);
  },
  { immediate: true },
);
/** Files attached in the conversation become notebook sources, which answers can then cite. */
async function attachFiles(files: File[]) {
  screen.value = "transcript";
  // The person's turn names the files, as they would read it in a chat app.
  const names = files.map((f) => f.name).join(", ");
  const added: string[] = [];
  const problems: string[] = [];
  for (const file of files) {
    try {
      const doc = await readDocument(file);
      await nb.addSource({ title: doc.title, mime: doc.mime, text: doc.text });
      added.push(doc.title);
    } catch (e) {
      problems.push(`${file.name} couldn't be added: ${(e as Error).message}`);
    }
  }
  const one = added.length === 1;
  const text = [added.length ? `Added ${added.map((t) => `“${t}”`).join(", ")} to the notebook. Ask about ${one ? "it" : "them"}, and answers will cite ${one ? "it" : "them"}.` : null, ...problems].filter(Boolean).join(" ");
  await chat.addTurns(names, { text, via: "file" }, turnCtx());
}

async function ask(question: string) {
  // A form open in the conversation takes the words (LIB-56), unless the visitor chose to ask instead.
  const form = formInput.value;
  if (form) {
    screen.value = "transcript";
    return form.fill(question);
  }
  const pendingCard = [...chat.turns.value].reverse().find((t) => t.card?.state === "confirm");
  const reply = pendingCard ? yesOrNo(question) : null;
  if (pendingCard && reply) return onCard(pendingCard.id, reply);
  // A kiosk command is handled here, on this device, whatever the answer mode (CMD-1).
  const command = await recognizeCommand(question, settings.agent).catch(() => null);
  if (command) {
    screen.value = "transcript";
    journey.value = null;
    voiceOut.cancel();
    return runCommand(question, command);
  }
  const mode = answers.value;
  if (mode !== "local" && !selection.value) return;
  screen.value = "transcript";
  journey.value = null;
  failed.value = false;
  voiceOut.cancel();
  const ctx = turnCtx();
  const semantic = settings.agent.knowledge?.semantic !== false;
  const model = modelFor(settings.agent, question);
  try {
    let reply: string;
    if (mode === "local") {
      reply = await chat.sendLocal(question, ctx, async (signal) => present(await withWeb(question, localAnswer(question, await searchLocal(model, question, ctx.notebook, { signal })), signal), signal));
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
    // The activity log: that a question was asked and how it was answered, never the question.
    const tools = chat.turns.value[chat.turns.value.length - 1]?.tools ?? [];
    void logActivity("question.asked", { mode: tools.some((t) => t.name === "local_search") ? "device" : "agent", language: language.value });
    if (tools.some((t) => t.name === "web_search")) void logActivity("web.searched");
    if (tools.some((t) => t.name === "flag_for_moderation")) void logActivity("question.escalated", { via: "agent" });
    if (settings.speakResponses && reply) await voiceOut.speak(reply, { voiceName: settings.voiceName, rate: settings.speechRate, lang: speechLangFor(language.value) });
    // Session feedback, once in a while (FBK-2): only now, after the answer and its read-aloud.
    feedback.consider({
      answers: chat.turns.value.filter((t) => t.role === "assistant" && t.text && !t.error).length,
      rate: caps.value?.feedback?.rate ?? 0,
      busy: chat.busy.value,
      journeyOpen: journey.value !== null,
      speaking: voiceOut.speaking.value,
      emergency: looksLikeEmergency(question),
      profile: Boolean(account.profile.value),
    });
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
  screensFor(kioskContent.screens, layout.value)
    // The front desk is Ask Me alone.
    .filter((s) => !restricted.value || s.component === "transcript")
    .map((s) => ({
    id: s.id,
    label: s.label,
    icon: s.icon,
    badge: s.id === "notebook" && sourceCount.value ? String(sourceCount.value) : undefined,
  })),
);
/**
 * The kiosk keeps one height whatever screen it shows (SET-18): the device's height less the site's
 * navbar, the page padding and the player, so Mini fills a phone, Pod a tablet and Full a desktop
 * window, and every screen scrolls inside. It never shrinks below a usable height. (The native app
 * has no site navbar.)
 */
const MINI_HEIGHT = computed(() => (NATIVE || restricted.value ? "h-[max(26rem,calc(100dvh-10.5rem))]" : "h-[max(26rem,calc(100dvh-14rem))]"));
const POD_HEIGHT = computed(() => (NATIVE || restricted.value ? "h-[max(28rem,calc(100dvh-11rem))]" : "h-[max(28rem,calc(100dvh-14.5rem))]"));
const MINI_BODY = "overflow-y-auto [scrollbar-width:thin]";
const componentOf = (id: string) => kioskContent.screens.screens.find((s) => s.id === id)?.component;
// A link may open a screen (/kiosk?screen=services&staff=team): the old staff pages redirect here.
watch(
  () => route.query.screen,
  (id) => {
    if (typeof id === "string" && navScreens.value.some((s) => s.id === id)) screen.value = id;
  },
  { immediate: true },
);
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

const playerVariant = computed(() => (layout.value === "full" ? "full" : layout.value === "pod" ? "strip" : "mini"));
/** Full and Mini have a fixed height: the screen's navigation stays put and the screen scrolls inside. */
const fixedHeight = computed(() => true);
</script>

<template>
  <!-- Measure the full available width (not the mini card), so Auto can grow back out of mini. -->
  <!-- Embedded (the catalogue's Ask Me): the conversation alone; its host gives it a height. -->
  <div v-if="embedded" class="h-full min-h-0">
    <TranscriptPane
      :turns="chat.turns.value"
      :busy="chat.busy.value"
      :listening="voiceIn.listening.value"
      :voice-supported="voiceIn.supported.value && (!restricted || settings.restricted.mic)"
      height-class="h-full"
      @mic="onMic"
      :selection="selection"
      :can-ask="canAsk"
      :answers="answers"
      :has-assistant="!!selection"
      @card="onCard"
      @review="reviewAnswer"
      :catalog="catalog"
      :catalog-error="catalogError"
      :notebook-title="nb.notebook.value?.title ?? null"
      :source-count="sourceCount"
      @ask="ask"
      @reset="chat.reset"
      :services="services"
      :notebook="nb.notebook.value"
      :member="kioskViewer.member"
      @journey="(id) => startJourney(id)"
      @request="(ref, open) => showRequest(ref, open)"
      @attach="attachFiles"
      @journey-update="onJourneyUpdate"
      @journey-done="(id) => void logActivity('journey.completed', { journey: id })"
      @speak="(t) => voiceOut.speak(t)"
      :threads="nb.threads.value"
      :restricted="restricted"
      :front-services="settings.restricted.services"
      :allow-attach="!restricted || settings.restricted.attach"
      :active-thread-id="chat.threadId.value"
      @open-thread="(id) => chat.open(id)"
    >
      <!-- Beside Conversations: the visitor's profile (sign in) and the kiosk's preferences. -->
      <template #actions>
        <!-- The front desk: end the visit, and (staff) leave Restricted Mode. -->
        <template v-if="restricted">
          <button type="button" class="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm text-ink ring-1 ring-gray-200 hover:bg-mist" @click="endSession">
            <LogOut class="size-4" aria-hidden="true" /> End session
          </button>
          <button type="button" class="grid size-9 place-items-center rounded-full text-gray-400 hover:bg-mist hover:text-ink" aria-label="Staff: leave the front desk" title="Staff" @click="unlocking = true">
            <Lock class="size-4" aria-hidden="true" />
          </button>
          <RestrictedUnlock v-if="unlocking" @close="unlocking = false" @unlocked="unlocking = false" />
        </template>
        <template v-else>
          <ProfileButton tone="light" :nickname="account.profile.value?.nickname ?? null" :open="false" @toggle="openPrefs('profile')" />
          <button type="button" class="grid size-9 place-items-center rounded-full text-gray-500 ring-1 ring-gray-200 hover:bg-mist hover:text-ink" aria-label="Preferences" title="Preferences" @click="openPrefs('language')">
            <SlidersHorizontal class="size-4" aria-hidden="true" />
          </button>
        </template>
      </template>
      <!-- The front desk starts with its services. -->
      <template v-if="restricted && frontJourneys.length" #empty>
        <ul class="mx-auto mt-6 grid max-w-xl gap-2 text-left @lg:grid-cols-2">
          <li v-for="j in frontJourneys" :key="j.id">
            <button type="button" class="card flex min-h-16 w-full flex-col items-start p-4 text-left transition hover:border-gray-300" @click="startJourney(j.id)">
              <span class="text-base font-medium text-ink">{{ j.title }}</span>
              <span v-if="j.summary" class="text-sm text-gray-600">{{ j.summary }}</span>
            </button>
          </li>
        </ul>
      </template>
    </TranscriptPane>
  </div>
  <div v-else ref="root" class="w-full">
    <!-- The kiosk: one frame holding the player (with the kiosk's controls) and its screens. -->
    <KioskFrame :layout="layout" :mini-height="MINI_HEIGHT" :pod-height="POD_HEIGHT" :chromeless="restricted">
      <template #before>
        <FeedbackPrompt class="mb-3" />
        <h1 class="sr-only">{{ KIOSK_NAME }}</h1>
      </template>
      <template #panel>
        <PlayerPanel
          :variant="playerVariant"
          :status="status"
          :title="KIOSK_NAME"
          :is-playing="voiceOut.speaking.value && !voiceOut.paused.value"
          :speaking="voiceOut.speaking.value"
          :listening="voiceIn.listening.value"
          :interim="voiceIn.interim.value"
          :voice-supported="voiceIn.supported.value && (!restricted || settings.restricted.mic)"
          :can-ask="canAsk"
          @mic="onMic"
          @pause-resume="onPauseResume"
          @stop="onStop"
        >
          <template #meta>
            <template v-if="restricted">Front desk · {{ frontDocs.length }} document{{ frontDocs.length === 1 ? "" : "s" }}</template>
            <template v-else-if="nb.notebook.value">{{ nb.notebook.value.title }} · {{ sourceCount }} source{{ sourceCount === 1 ? "" : "s" }}</template>
            <span v-if="offline" class="block text-brand">Loading on-device model{{ offline.progress ? ` ${Math.round(offline.progress)}%` : "…" }}</span>
          </template>
        </PlayerPanel>
      </template>
      <template #default="{ width: screensWidth }">
      <KioskPreferences v-if="prefsOpen" :nickname="account.profile.value?.nickname ?? null" :fill="fixedHeight" @close="closePrefs" />
      <ProfilePicker v-else-if="showPicker" @visitor="chooseVisitor" @add="openPrefs('profile')" />
      <AdaptiveNav
        v-else
        :screens="navScreens"
        :mode="kioskContent.screens.nav?.[layout]"
        :storage-key="`kiosk-${layout}`"
        label="Kiosk screens"
        :active="screen"
        :width="screensWidth"
        :fill="fixedHeight"
        :body-class="fixedHeight ? MINI_BODY : ''"
        @update:active="setScreen"
      >
            <template v-for="s in navScreens" :key="s.id" #[s.id]>
              <TranscriptPane
                v-if="componentOf(s.id) === 'transcript'"
                :turns="chat.turns.value"
                :busy="chat.busy.value"
                :listening="voiceIn.listening.value"
                :voice-supported="voiceIn.supported.value && (!restricted || settings.restricted.mic)"
                :height-class="fixedHeight ? 'h-full' : undefined"
                @mic="onMic"
                :selection="selection"
                :can-ask="canAsk"
                :answers="answers"
                :has-assistant="!!selection"
                @card="onCard"
                @review="reviewAnswer"
                :catalog="catalog"
                :catalog-error="catalogError"
                :notebook-title="nb.notebook.value?.title ?? null"
                :source-count="sourceCount"
                @ask="ask"
                @reset="chat.reset"
                :services="services"
                :notebook="nb.notebook.value"
                :member="kioskViewer.member"
                @journey="(id) => startJourney(id)"
                @request="(ref, open) => showRequest(ref, open)"
                @attach="attachFiles"
                @journey-update="onJourneyUpdate"
                @journey-done="(id) => void logActivity('journey.completed', { journey: id })"
                @speak="(t) => voiceOut.speak(t)"
                :threads="nb.threads.value"
                :restricted="restricted"
                :front-services="settings.restricted.services"
                :allow-attach="!restricted || settings.restricted.attach"
                :active-thread-id="chat.threadId.value"
                @open-thread="(id) => chat.open(id)"
              >
                <!-- Beside Conversations: the visitor's profile (sign in) and the kiosk's preferences. -->
                <template #actions>
                  <!-- The front desk: end the visit, and (staff) leave Restricted Mode. -->
                  <template v-if="restricted">
                    <button type="button" class="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm text-ink ring-1 ring-gray-200 hover:bg-mist" @click="endSession">
                      <LogOut class="size-4" aria-hidden="true" /> End session
                    </button>
                    <button type="button" class="grid size-9 place-items-center rounded-full text-gray-400 hover:bg-mist hover:text-ink" aria-label="Staff: leave the front desk" title="Staff" @click="unlocking = true">
                      <Lock class="size-4" aria-hidden="true" />
                    </button>
                    <RestrictedUnlock v-if="unlocking" @close="unlocking = false" @unlocked="unlocking = false" />
                  </template>
                  <template v-else>
                    <ProfileButton tone="light" :nickname="account.profile.value?.nickname ?? null" :open="false" @toggle="openPrefs('profile')" />
                    <button type="button" class="grid size-9 place-items-center rounded-full text-gray-500 ring-1 ring-gray-200 hover:bg-mist hover:text-ink" aria-label="Preferences" title="Preferences" @click="openPrefs('language')">
                      <SlidersHorizontal class="size-4" aria-hidden="true" />
                    </button>
                  </template>
                </template>
                <!-- The front desk starts with its services. -->
                <template v-if="restricted && frontJourneys.length" #empty>
                  <ul class="mx-auto mt-6 grid max-w-xl gap-2 text-left @lg:grid-cols-2">
                    <li v-for="j in frontJourneys" :key="j.id">
                      <button type="button" class="card flex min-h-16 w-full flex-col items-start p-4 text-left transition hover:border-gray-300" @click="startJourney(j.id)">
                        <span class="text-base font-medium text-ink">{{ j.title }}</span>
                        <span v-if="j.summary" class="text-sm text-gray-600">{{ j.summary }}</span>
                      </button>
                    </li>
                  </ul>
                </template>
              </TranscriptPane>
              <ServicesScreen
                v-else-if="componentOf(s.id) === 'services'"
                :layout="layout"
                :services="services"
                :notebook="nb.notebook.value"
                :highlight="account.profile.value ? (account.preferences.value?.highlight ?? []) : []"
                @open-journey="startJourney"
                @request="(ref) => showRequest(ref, true)"
                @open-screen="setScreen"
                @speak="(t) => voiceOut.speak(t)"
              />
              <AccountScreen v-else-if="componentOf(s.id) === 'account'" />
              <NotebookScreen
                v-else-if="componentOf(s.id) === 'notebook'"
                :nb="nb"
                :active-thread-id="chat.threadId.value"
                @open-thread="(id) => (chat.open(id), (screen = 'transcript'))"
                @new-thread="() => (chat.reset(), (screen = 'transcript'))"
                @start-journey="startJourney"
              />
              <KnowledgeSources v-else-if="componentOf(s.id) === 'records'" />
              <TranslatePane v-else-if="componentOf(s.id) === 'translate'" :initial-text="lastAnswer" @speak="(t, lang) => voiceOut.speak(t, { lang })" />
            </template>
      </AdaptiveNav>
      </template>
    </KioskFrame>
  </div>
</template>
