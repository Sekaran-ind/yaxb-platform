<script setup lang="ts">
import { checkOutcome, insideSite, whoChecks } from "@sekaran-ind/yaxb-core/attendance";
import { roster } from "@/composables/attendance";
import { recordEvent } from "@/composables/service-events";
import { mediaHost } from "@/composables/media";
import { isMediaRef } from "@sekaran-ind/yaxb-core/journeys";
// The kiosk. Three layouts from one config (yaxb-core content/screens.yaml):
//   full  the console column and the screens side by side (the original kiosk)
//   pod   the "pod player": the console as a strip, screens below
//   mini  a compact card: orb and mic, one screen at a time
// Owns the conversation, voice, notebook and journey handlers, and passes them to the screens.
import { aboutKiosk, confirmText, PROFILE_FORM, profileFields, profilePatch, type CommandEffect, type CommandMatch } from "@sekaran-ind/yaxb-core/commands";
import { offers } from "@/lib/surface";
import { kioskContent } from "@sekaran-ind/yaxb-core/content";
import type { ServiceHandler } from "@sekaran-ind/yaxb-core/journeys";
import { composeLocalAnswer, composeWebAnswer, EMBEDDING_MODELS, looksLikeEmergency, type LocalAnswer } from "@sekaran-ind/yaxb-core/knowledge/semantic";
import { resolveLayout, screensFor } from "@sekaran-ind/yaxb-core/screens";
import { DEFAULT_LANGUAGE, type LanguageCode } from "@sekaran-ind/yaxb-core/settings";
import { chooseSpelling } from "@sekaran-ind/yaxb-core/spell";
import { HOUSEHOLD_ENTRY } from "@sekaran-ind/yaxb-core/household";
import { checkSpelling, forgetSpelling } from "@/lib/browser/spell";
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
import type { CommandCard, DesignTurn, JourneyTurn, KioskStatus } from "@/lib/types";
import { api } from "@/lib/api";
import { NOTEBOOK_LIMITS } from "@sekaran-ind/yaxb-core/notebook";
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
import TranslatePane from "./TranslatePane.vue";
import KioskFrame from "@/components/site/KioskFrame.vue";
import { NATIVE } from "@/lib/platform";
import { endSession, restricted, sessionEnds } from "@/composables/restricted";
import { serviceDocuments } from "@/composables/notebook";
import { loadedServices, publishedConnectors } from "@/composables/library";
import ProfilePicker from "@/components/account/ProfilePicker.vue";
import SpacePicker from "@/components/account/SpacePicker.vue";
import { JOURNEY_RESTART_MS, justOpened, useIdentity } from "@/composables/identity";
import type { Membership } from "@sekaran-ind/yaxb-core/identity";
import RestrictedUnlock from "./RestrictedUnlock.vue";
import ComingUp from "./ComingUp.vue";
import { pendingScheduleText } from "@/composables/schedule";
import AskMePills from "./AskMePills.vue";
import PlayerButtons, { type PlayerButton } from "./PlayerButtons.vue";
import { Building2, Lock, LogOut, MessagesSquare, ShieldCheck, SlidersHorizontal, Square, UserRound, Users } from "@lucide/vue";
import { useChildMode } from "@/composables/child";
import type { NotebookSource } from "@sekaran-ind/yaxb-core/notebook";
import type { StorageId } from "@sekaran-ind/yaxb-core/settings";
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
// The child safety lock (CHL-2..4): the server is told, and keeps the web and outside tools away.
const childMode = useChildMode();
const agentSettings = computed(() => {
  const base = restricted.value ? { ...settings.agent, storage: "session" as const } : settings.agent;
  return childMode.on.value ? { ...base, child: true, mcp: [], knowledge: { ...base.knowledge, web: "off" as const } } : base;
});
const turnCtx = () => ({ settings: agentSettings.value, notebook: turnNotebook.value });
/** The services' journeys anyone may start: the front desk's tiles. */
const frontJourneys = computed(() =>
  loadedServices.value
    .filter((s) => settings.restricted.services.includes(s.meta.entry_id))
    .flatMap((s) => s.journeys.filter((j) => !j.roles?.initiate?.length || j.roles.initiate.includes("visitor")).map((j) => ({ id: j.id, title: j.title, summary: j.summary ?? null, service: s.meta.title }))),
);
const unlocking = ref(false);
/** The conversations drawer, opened from its pill in the tab row. */
const threadsOpen = ref(false);
// A visit ends (End session, idle, or the front desk turned on): nothing of it stays.
// A front desk session ends (STO-3): the visit's conversation, notebook, words and drafts go.
watch(sessionEnds, async () => {
  voiceOut.cancel();
  voiceIn.stop();
  chat.reset();
  forgetSpelling();
  threadsOpen.value = false;
  for (const n of nb.notebooks.value) await nb.remove(n.id).catch(() => undefined);
  screen.value = "transcript";
  // A visitor signed in by scanning (IDN-19) is signed out with the visit.
  if (restricted.value && identity.signedIn.value) await identity.signOut().catch(() => undefined);
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
const showPicker = computed(() => offers("profiles") && !props.embedded && !restricted.value && account.list.value.length > 0 && !account.profile.value && !visitorChosen.value);

// ---- the account's spaces (SPC-2, SPC-4) ----------------------------------------------------------
const identity = useIdentity();
const SPACE_LATER = "yaxb.space.later";
const readLater = () => {
  try {
    return sessionStorage.getItem(SPACE_LATER) === "1";
  } catch {
    return false;
  }
};
const spaceLater = ref(readLater());
// Opening a space starts the app again: the conversation the journey runs in is reopened after it,
// so the journey finishes where the person was (the step then sees the space open, justOpened).
const RESUME = "yaxb.resume.thread";
function keepConversation() {
  try {
    sessionStorage.setItem(RESUME, JSON.stringify({ id: chat.threadId.value, at: Date.now() }));
  } catch {
    /* private mode: a fresh conversation after the restart */
  }
}
onMounted(() => {
  try {
    const kept = JSON.parse(sessionStorage.getItem(RESUME) ?? "null") as { id?: string; at?: number } | null;
    sessionStorage.removeItem(RESUME);
    if (kept?.id && Date.now() - (kept.at ?? 0) < 5 * 60_000) {
      screen.value = "transcript";
      void chat.open(kept.id);
    }
  } catch {
    /* nothing kept */
  }
});
/** Asked for: the player's space button, or the your-account journey's "Open one of my spaces". */
const spacePickerAsked = ref(false);
/** A journey step waiting for the picker's choice (identity.space.open). */
let spacePicked: ((s: Membership | null) => void) | null = null;
const deferPick = ref(false);
async function onSpacePick(s: Membership) {
  const done = spacePicked;
  spacePicked = null;
  deferPick.value = false;
  spacePickerAsked.value = false;
  if (!done) return;
  const open = identity.me.value.signedIn && identity.me.value.space?.tenant_id === s.tenant_id;
  if (!open) {
    keepConversation();
    await identity.openSpace(s.tenant_id, s.edition, { after: JOURNEY_RESTART_MS });
  }
  done(s);
}
const mySpaces = identity.spacesHere;
// Child mode (SPC-9): an open space a child may not use is closed (the app starts again without it).
watch(
  () => [identity.childMode.value, identity.me.value.signedIn && identity.me.value.space] as const,
  ([childOn, open]) => {
    if (!childOn || !open || mySpaces.value.some((s) => s.edition === open.edition && s.tenant_id === open.tenant_id)) return;
    void identity.openSpace(null).catch(() => undefined);
  },
);
/**
 * "Where are you today?": after the person, when their account has several spaces here and none is
 * open (once per visit, unless asked for again). Never at the front desk or in another surface.
 */
const showSpacePicker = computed(
  () => !props.embedded && !restricted.value && !identity.locked.value && !showPicker.value && (spacePickerAsked.value || (mySpaces.value.length > 1 && identity.me.value.signedIn && !identity.me.value.space && !spaceLater.value)),
);
function spaceNotNow() {
  spacePicked?.(null);
  spacePicked = null;
  deferPick.value = false;
  spacePickerAsked.value = false;
  spaceLater.value = true;
  try {
    sessionStorage.setItem(SPACE_LATER, "1");
  } catch {
    /* private mode */
  }
}
const { data: catalog, error: catalogError } = useProviders();
const { data: caps } = useCapabilities();
const feedback = useFeedback();
const voiceOut = useSpeechOutput();
const failed = ref(false);
const screen = ref<string | null>(kioskContent.screens.defaultScreen ?? null);
// The conversations drawer belongs to Ask Me.
watch(screen, (sc) => sc !== "transcript" && (threadsOpen.value = false));
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
  if (a.kind !== "none" || a.emergency || settings.agent.knowledge?.web === "off" || childMode.on.value || !caps.value?.web) return a;
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
  if (childMode.on.value && e.agent?.knowledge) return;
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
      // The child safety lock (CHL-7): what the answers come from, and the web, stay as the parent set them.
      if (childMode.on.value && e.agent?.knowledge)
        return { ...base, title: "I can't do that from here.", state: "refused", text: "The child safety lock is on: a parent changes where answers come from in Preferences, with the PIN." };
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

async function runCommand(question: string, m: CommandMatch, spelling?: Spelling) {
  const ctx = turnCtx();
  const card = await cardFor(question, m);
  await chat.addCard(question, card, { ...ctx, spelling });
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
  // A household request is someone's (EDN-20): open a profile first, so it can come back to them.
  if (entryOfJourney(j.id) === HOUSEHOLD_ENTRY && !account.profileId.value) return openPrefs("profile");
  screen.value = "transcript";
  journey.value = null;
  const turn: JourneyTurn = { id: j.id, entry: entryOfJourney(j.id), title: j.title, run: null, status: "running" };
  await chat.addTurns(j.title, { journey: turn, via: "journey" }, turnCtx());
}
// A link to a journey (`?journey=<id>`), such as Preferences → Account's "Sign in step by step". A
// catalogue journey may not be loaded yet when the page opens: it starts once it is (for a while).
const linkedJourney = ref<{ id: string; until: number } | null>(null);
watch(
  () => route.query.journey,
  (j) => {
    if (typeof j !== "string" || !j) return;
    const { journey: _, ...rest } = route.query;
    void router.replace({ query: rest });
    if (kioskJourneys.value.some((x) => x.id === j)) void startJourney(j);
    else linkedJourney.value = { id: j, until: Date.now() + 15_000 };
  },
  { immediate: true },
);
watch(kioskJourneys, (list) => {
  const want = linkedJourney.value;
  if (!want) return;
  if (Date.now() > want.until) return void (linkedJourney.value = null);
  if (!list.some((x) => x.id === want.id)) return;
  linkedJourney.value = null;
  void startJourney(want.id);
});

// ---- designing a service in the conversation (LIB-64) ------------------------------------------------

type DesignSession = Extract<DesignTurn, { kind: "session" }>;
/** Start designing a new service here: the design takes the message box's words until it is stopped. */
async function startDesign(idea?: string) {
  screen.value = "transcript";
  journey.value = null;
  const design: DesignSession = { kind: "session", status: "designing", thread: null, yaml: null, run: null, title: null, entry: null, ...(idea ? { idea: idea.slice(0, 4000) } : {}) };
  await chat.addTurns("Design a new service", { design, via: "design" }, turnCtx());
}
async function onDesignUpdate(turnId: string, patch: Partial<DesignTurn>) {
  const turn = chat.turns.value.find((t) => t.id === turnId);
  if (!turn?.design) return;
  await chat.patchTurn(turnId, { design: { ...turn.design, ...patch } as DesignTurn }, turnCtx());
}
/** The first description needs a sentence or two (the designer's input is 20 to 4000 characters). */
const MIN_DESCRIPTION = 20;
/** Words for the Service Designer: its reply, with its draft, becomes a turn; the design keeps the draft. */
async function designSay(sessionId: string, text: string) {
  const session = chat.turns.value.find((t) => t.id === sessionId)?.design;
  if (session?.kind !== "session") return;
  const reply: DesignTurn = { kind: "reply", session: sessionId, pending: true, text: "", yaml: null, title: null, errors: 0, run: null };
  const replyId = await chat.addTurns(text, { design: reply, via: "design" }, turnCtx());
  const fail = (failed: string) => onDesignUpdate(replyId, { pending: false, failed });
  const first = !session.thread && !session.yaml;
  if (first && text.trim().length < MIN_DESCRIPTION) return fail("Describe the service in a sentence or two: who uses it, what they do, and who answers.");
  const sel = selection.value;
  if (!sel) return fail("The Service Designer needs an AI model: choose one in Preferences → Model.");
  try {
    const r = await api<{ yaml: string; title: string; problems: { level: string }[]; run: string; thread: string; messages: { role: string; text: string }[] }>("/api/library/design", {
      narrative: text,
      provider: sel.provider,
      model: sel.model,
      ...(session.thread ? { thread: session.thread } : {}),
      ...(session.yaml ? { current: session.yaml } : {}),
    });
    const said = r.messages.filter((m) => m.role === "assistant").at(-1)?.text ?? "Drafted the service.";
    await onDesignUpdate(replyId, { pending: false, text: said, yaml: r.yaml, title: r.title, errors: r.problems.filter((p) => p.level === "error").length, run: r.run });
    await onDesignUpdate(sessionId, { thread: r.thread, yaml: r.yaml, run: r.run, title: r.title });
  } catch (e) {
    await fail((e as Error).message);
  }
}
// The catalogue's New service opens Ask Me with a design (`?design=new`).
watch(
  () => route.query.design,
  (d) => {
    if (d !== "new") return;
    const { design: _, idea, ...rest } = route.query;
    void router.replace({ query: rest });
    void startDesign(typeof idea === "string" ? idea : undefined);
  },
  { immediate: true },
);

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
/** The Scheduler (SCH-7), from /schedule: with words, it reads them into an entry to confirm. */
function openScheduler(text: string) {
  pendingScheduleText.value = text;
  setScreen("services");
  void router.push({ path: "/kiosk", query: { screen: "services", tool: "scheduler" } });
}
/** A Quick tools item picked from /qt: a journey runs here; a screen or a staff section opens. */
function openTool(t: { journey?: string; screen?: string; staff?: string }) {
  if (t.journey) return void startJourney(t.journey);
  if (t.staff) return void router.push({ path: "/kiosk", query: { screen: "services", staff: t.staff } });
  if (t.screen === "scheduler") return openScheduler("");
  if (t.screen) setScreen(t.screen);
}
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

type Spelling = { corrected: string; notice: "acted" | "suggest" | null };

/** SPL-10: a spelling notice acted on or answered, with the language; never the words. */
function logSpelling(via: "acted" | "suggested", accepted: boolean) {
  void logActivity("spell.corrected", { language: language.value, via, accepted });
}

/** A spelling notice tapped (SPL-6): ask again with those words, without checking them again. */
function onSpelling(text: string, accepted: boolean) {
  logSpelling(accepted ? "suggested" : "acted", accepted);
  void ask(text, { unchecked: true });
}

/**
 * Ask with what the person typed or said. Typed words are spell-checked on this device (SPL-1..7):
 * commands and the on-device search run on both spellings and keep the better (SPL-3), the agent
 * gets the words typed with the correction as a hint (SPL-7). Spoken words are never checked.
 */
async function ask(question: string, { spoken = false, unchecked = false }: { spoken?: boolean; unchecked?: boolean } = {}) {
  // A form open in the conversation takes the words (LIB-56), unless the visitor chose to ask instead.
  const form = formInput.value;
  if (form) {
    screen.value = "transcript";
    return form.fill(question, { spoken });
  }
  const pendingCard = [...chat.turns.value].reverse().find((t) => t.card?.state === "confirm");
  const reply = pendingCard ? yesOrNo(question) : null;
  if (pendingCard && reply) return onCard(pendingCard.id, reply);
  const corrected = spoken || unchecked ? null : checkSpelling(question, { notebook: turnNotebook.value, services: loadedServices.value.map((s) => s.meta) }).changed;
  // A kiosk command is handled here, on this device, whatever the answer mode (CMD-1).
  let command = await recognizeCommand(question, settings.agent).catch(() => null);
  let commandSpelling: Spelling | undefined;
  if (!command && corrected) {
    command = await recognizeCommand(corrected, settings.agent).catch(() => null);
    if (command) commandSpelling = { corrected, notice: "acted" };
  }
  if (command) {
    screen.value = "transcript";
    journey.value = null;
    voiceOut.cancel();
    if (commandSpelling) logSpelling("acted", true);
    return runCommand(question, command, commandSpelling);
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
  // Both spellings searched on the device, the better kept (SPL-3); only when its model is ready.
  let spelling: Spelling | undefined = corrected ? { corrected, notice: null } : undefined;
  let asked = question;
  let picked: LocalSearch | null = null;
  const bothSpellings = async () => {
    const [mine, fixed] = await Promise.all([searchLocal(model, question, ctx.notebook), searchLocal(model, corrected!, ctx.notebook)]);
    const choice = chooseSpelling(mine.refs[0]?.score ?? null, fixed.refs[0]?.score ?? null, { strong: EMBEDDING_MODELS[model].thresholds.answer });
    spelling = { corrected: corrected!, notice: choice.notice };
    if (choice.use === "corrected") asked = corrected!;
    if (choice.notice === "acted") logSpelling("acted", true);
    return choice.use === "corrected" ? fixed : mine;
  };
  try {
    let reply: string;
    if (mode === "local") {
      if (corrected && semanticReady(model)) picked = await bothSpellings().catch(() => null);
      reply = await chat.sendLocal(question, { ...ctx, spelling }, async (signal) =>
        present(await withWeb(asked, localAnswer(asked, picked ?? (await searchLocal(model, question, ctx.notebook, { signal }))), signal), signal),
      );
    } else {
      // Search on the device first when its model is ready; never hold a question for the download.
      let found: LocalSearch | null = null;
      if (mode === "auto" || semantic) {
        if (!semanticReady(model)) warmUp(model).catch(() => undefined);
        else if (corrected) found = await bothSpellings().catch(() => null);
        else found = await searchLocal(model, question, ctx.notebook).catch(() => null);
      }
      const local = mode === "auto" && found ? localAnswer(asked, found) : null;
      if (local && local.kind !== "none") reply = await chat.sendLocal(question, { ...ctx, spelling }, (signal) => present(local, signal));
      else reply = await chat.send(question, selection.value!, { ...ctx, retrieved: semantic && found ? found.refs : [], spelling });
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
const voiceIn = useSpeechInput((said: string) => ask(said, { spoken: true }), () => speechLangFor(language.value));

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
const builtInServices: Record<string, ServiceHandler> = {
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
  // Website access (SIT-5): every site through the approved list (SIT-1..6). The server reads the
  // page (only its address goes); the notebook keeps it with its address.
  "web.read": async (input, { signal }) => {
    const url = String((input as { url?: unknown }).url ?? "").trim();
    const res = await fetch("/api/sources/web", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, follow: 0 }), signal });
    const body = (await res.json().catch(() => null)) as { pages?: { url: string; title: string; text: string; fetchedAt: string }[]; unapproved?: boolean; error?: string; ask?: boolean } | null;
    if (!res.ok || !body?.pages?.length) throw new Error(`${body?.error ?? "That page couldn't be loaded."}${body?.ask ? " Use \"Ask to add a website\"." : ""}`);
    const p = body.pages[0]!;
    await nb.addSource({ title: p.title, mime: "text/html", text: p.text.slice(0, NOTEBOOK_LIMITS.sourceChars), url: p.url, fetchedAt: p.fetchedAt });
    return { title: p.title, url: p.url, note: body.unapproved ? "This site isn't on the approved list yet: it has been asked for." : "It is in your notebook now." };
  },
  "web.link-out": async (input, { signal }) => {
    const url = String((input as { url?: unknown }).url ?? "").trim();
    let host = "";
    try {
      const u = new URL(url);
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
      host = u.host;
    } catch {
      throw new Error("That isn't a web address.");
    }
    const v = await api<{ allowed: boolean; why: string }>("/api/sites/verdict", { url, use: "link" }).catch((e: Error) => ({ allowed: false, why: e.message }));
    if (signal?.aborted) throw new Error("Stopped.");
    if (!v.allowed) throw new Error(`${v.why} Use "Ask to add a website".`);
    window.open(url, "_blank", "noopener,noreferrer");
    return { host, url };
  },
  "web.request": async (input) => {
    const i = input as { url?: unknown; use?: unknown; reason?: unknown };
    const use = i.use === "link" || i.use === "lookup" || i.use === "analyse" ? i.use : "source";
    const reason = String(i.reason ?? "").trim().slice(0, 300);
    const r = await api<{ asked: boolean; merged: boolean }>("/api/sites/requests", { url: String(i.url ?? "").trim(), use, ...(reason ? { reason } : {}) });
    return { asked: r.asked, merged: r.merged };
  },
  // Looking something up on a site (a bill, a status) waits for the sandboxed capture (WEB-30).
  "web.lookup": async () => {
    throw new Error("Looking things up on a website isn't available yet.");
  },
  // Signing in and spaces: the your-account journey (15-identity.md, SPC-2..8). Each step is safe to
  // run again: opening a space starts the app again, and the journey carries on from the conversation.
  "identity.status": async () => {
    await identity.reload();
    const m = identity.me.value;
    return m.signedIn ? { signedIn: true, name: m.account.display_name ?? "", spaces: mySpaces.value.length, open: m.space?.space_name ?? null } : { signedIn: false };
  },
  // Attendance (ATT-1, ATT-6): a check-in against this business's roster, on the device (offline at
  // the front desk). The event carries the outcome and the employee's roster id; with sites in the
  // roster, only which site it was inside (never where).
  "attendance.check": async (input, { journey }) => {
    const i = input as { kind?: unknown; pin?: unknown; qr?: unknown };
    const kind = i.kind === "out" ? "out" : "in";
    const who = await whoChecks(roster.value, { pin: typeof i.pin === "string" ? i.pin : undefined, qr: typeof i.qr === "string" ? i.qr : undefined });
    if (!who) throw new Error("That PIN isn't on the roster.");
    const at = new Date();
    const outcome = checkOutcome(roster.value, who, kind, at);
    let site: string | null = null;
    if (roster.value.sites.length && navigator.geolocation) {
      const pos = await new Promise<GeolocationPosition | null>((res) => navigator.geolocation.getCurrentPosition(res, () => res(null), { timeout: 5000, maximumAge: 60_000 }));
      if (pos) site = roster.value.sites.find((x) => insideSite(x, pos.coords.latitude, pos.coords.longitude))?.id ?? "outside";
    }
    recordEvent(entryOfJourney(journey.id), { journey: journey.id, kind: "journey.outcome", run: crypto.randomUUID(), outcome, actor: who.id, step: site ? `site:${site}` : null });
    const time = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const first = who.name.split(/\s+/)[0];
    return {
      title: kind === "out" ? `Goodbye, ${first}` : `Welcome, ${first}`,
      text: `${kind === "out" ? "Checked out" : "Checked in"} at ${time}${outcome === "attendance.late" ? ", after your shift's start" : ""}${site === "outside" ? ". This device isn't at one of your sites" : ""}.`,
    };
  },
  // Media (MED-6): read a photo or write down a voice note, on this device. Input: the field's answer.
  "media.read": async (input) => {
    const i = input as { photo?: unknown; mode?: unknown };
    const refs = (Array.isArray(i.photo) ? i.photo : [i.photo]).filter(isMediaRef);
    if (!refs.length) throw new Error("There's no photo to read.");
    const mode = i.mode === "caption" ? "caption" : "ocr";
    const texts = await Promise.all(refs.map((r) => mediaHost.read!(r, mode).catch(() => null)));
    return { text: texts.filter(Boolean).join("\n") };
  },
  "media.transcribe": async (input) => {
    const i = input as { audio?: unknown };
    const ref = (Array.isArray(i.audio) ? i.audio : [i.audio]).find(isMediaRef);
    if (!ref) throw new Error("There's no voice note to write down.");
    return { text: (await mediaHost.transcribe!(ref)) ?? "" };
  },
  // Who is here (IDN-31): the name others see, how surely they signed in, and their roles in the open
  // space. Never an email or a phone.
  "identity.whoami": async () => {
    const m = identity.me.value;
    if (!m.signedIn) return { signedIn: false, level: 0, roles: [] };
    return { signedIn: true, name: m.account.display_name ?? "", level: m.level, space: m.space?.space_name ?? null, roles: m.space?.roles ?? [] };
  },
  "identity.passkey.signin": async () => {
    if (identity.signedIn.value) return { signedIn: true };
    if (!identity.passkeys.value) throw new Error("This device or address can't use passkeys. Choose Google or a recovery code.");
    try {
      await identity.passkeySignIn();
    } catch (e) {
      throw new Error(/NotAllowed|cancel|abort/i.test(String((e as Error).name) + (e as Error).message) ? "The passkey wasn't used. Choose how to sign in again." : (e as Error).message);
    }
    return { signedIn: true };
  },
  "identity.passkey.create": async (input) => {
    if (identity.signedIn.value) return { signedIn: true };
    // A child's profile sits under a guardian's account (IDN-5): a child doesn't make one.
    if (identity.childMode.value) throw new Error("A parent makes the account. Ask a parent.");
    const i = input as { name?: unknown; consent?: unknown };
    if (i.consent !== true && i.consent !== "true") throw new Error("Tick \u201cI've read this\u201d to make your account.");
    if (!identity.passkeys.value) throw new Error("This device or address can't make passkeys. Choose Google instead.");
    try {
      await identity.passkeyCreate({ name: String(i.name ?? "").trim() || undefined, consent: true });
    } catch (e) {
      throw new Error(/NotAllowed|cancel|abort/i.test(String((e as Error).name) + (e as Error).message) ? "The passkey wasn't made. Choose how to sign in again." : (e as Error).message);
    }
    return { signedIn: true };
  },
  "identity.google": async () => {
    if (identity.signedIn.value) return { signedIn: true };
    if (identity.childMode.value) throw new Error("A child doesn't sign in with Google. Ask a parent.");
    if (!identity.config.value?.google) throw new Error("Sign in with Google isn't set up on this site yet. Choose a passkey.");
    keepConversation();
    identity.google(`${location.pathname}${location.search}`);
    // Google takes over the page; the journey carries on when it brings the person back.
    return new Promise(() => undefined);
  },
  "identity.recovery": async (input) => {
    if (identity.signedIn.value) return { signedIn: true };
    await identity.recovery(String((input as { code?: unknown }).code ?? ""));
    return { signedIn: true };
  },
  "identity.space.open": async () => {
    const m = identity.me.value;
    if (!m.signedIn) throw new Error("Sign in first.");
    if (justOpened() && m.space) return { space: m.space.space_name };
    if (!mySpaces.value.length) throw new Error(identity.childMode.value ? "There's no space for you here yet. Ask a parent." : "You don't have a space here yet. Start one, or join one with a code.");
    if (mySpaces.value.length === 1) {
      const only = mySpaces.value[0]!;
      if (m.space?.tenant_id === only.tenant_id) return { space: only.space_name };
      keepConversation();
      await identity.openSpace(only.tenant_id, only.edition, { after: JOURNEY_RESTART_MS });
      return { space: only.space_name };
    }
    // Several: the picker, then the journey reaches its ending before the app restarts in the space.
    spacePickerAsked.value = true;
    deferPick.value = true;
    const s = await new Promise<Membership | null>((resolve) => (spacePicked = resolve));
    if (!s) throw new Error("No space chosen. Choose again, or Not now.");
    return { space: s.space_name };
  },
  "identity.space.start": async (input) => {
    if (identity.childMode.value) throw new Error("A parent starts a space. Ask a parent.");
    const i = input as { kind?: unknown; name?: unknown };
    if (justOpened() && identity.me.value.signedIn && identity.me.value.space) return { space: identity.me.value.space.space_name };
    keepConversation();
    const started = await identity.startSpace(String(i.kind ?? ""), String(i.name ?? ""), { after: JOURNEY_RESTART_MS });
    return { space: started.space_name };
  },
  "identity.space.join": async (input) => {
    if (identity.childMode.value) throw new Error("A parent adds you to a space. Ask a parent.");
    if (justOpened() && identity.me.value.signedIn && identity.me.value.space) return { space: identity.me.value.space.space_name, pending: false };
    keepConversation();
    const r = await identity.joinSpace(String((input as { code?: unknown }).code ?? ""), { after: JOURNEY_RESTART_MS });
    if (r.pending) return { pending: true, space: r.space_name ?? "The space" };
    return { space: r.space?.space_name ?? "", pending: false };
  },
  "speech.speak": async (input) => {
    const i = input as { text?: unknown; language?: unknown };
    await voiceOut.speak(String(i.text ?? ""), { lang: speechLangFor(String(i.language ?? "eng_Latn")) });
    return {};
  },
};
/**
 * A published connector's operation (CNX-2): `connector.<id>.<operation>` goes to the server, which
 * adds the secret and calls the API; the browser never sees the secret. The answer is data from
 * outside, kept as the step's result for later screens (never instructions).
 */
const connectorCall: ServiceHandler = async (input, { step, signal, guard }) => {
  const [, id, op] = String(guard ? step.guard?.call : step.service).split(".");
  const path = `/connectors/${encodeURIComponent(id ?? "")}/${encodeURIComponent(op ?? "")}`;
  // A box connector (CNX-4) reaches the office network: only the office box calls it.
  const onBox = publishedConnectors.value.find((c) => c.id === id)?.where === "box";
  if (onBox && !(settings.box.url && settings.box.token)) throw new Error("This step needs the office box: connect it in Preferences → Storage.");
  const res = await fetch(onBox ? `${settings.box.url.replace(/\/+$/, "")}/v1${path}` : `/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(onBox ? { Authorization: `Bearer ${settings.box.token}` } : {}) },
    body: JSON.stringify({ input: input ?? {} }),
    signal,
  });
  const out = (await res.json().catch(() => null)) as { ok?: boolean; status?: number; data?: unknown; error?: string } | null;
  if (!res.ok || !out) throw new Error(out?.error ?? "The connected service couldn't be reached.");
  if (!out.ok) throw new Error(`The connected service said no (${out.status}).`);
  return { data: out.data, text: typeof out.data === "string" ? out.data : JSON.stringify(out.data).slice(0, 2000) };
};
/** The handlers journeys use: the built-in ones, and any connector operation (checked when published). */
const services: Record<string, ServiceHandler> = new Proxy(builtInServices, {
  get: (t, p) => (typeof p === "string" && p.startsWith("connector.") ? connectorCall : t[p as string]),
  has: (t, p) => (typeof p === "string" && p.startsWith("connector.")) || p in t,
  getOwnPropertyDescriptor: (t, p) =>
    typeof p === "string" && p.startsWith("connector.") ? { value: connectorCall, writable: false, enumerable: true, configurable: true } : Object.getOwnPropertyDescriptor(t, p),
});

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

const initialsOf = (n: string) =>
  n
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

/**
 * The person's controls in the player (PLY-2): the profile, conversations, contacts (members: the
 * team; never with the child lock, PLY-4), the child lock when on, and the preferences. At the front
 * desk: End session and the staff lock.
 */
const playerButtons = computed<PlayerButton[]>(() => {
  if (restricted.value)
    return [
      { id: "end", label: "End session", icon: LogOut },
      { id: "staff", label: "Staff", icon: Lock },
    ];
  const nickname = account.profile.value?.nickname ?? null;
  const out: PlayerButton[] = [];
  const me = identity.me.value;
  if (offers("profiles")) out.push(nickname ? { id: "profile", label: nickname, initials: initialsOf(nickname), accent: true } : { id: "profile", label: "Sign in", icon: UserRound });
  // Without profiles (Business), the account is the person's button: sign in, or their space (SPC-4).
  else if (identity.config.value?.enabled)
    out.push(me.signedIn ? { id: "account", label: me.space?.space_name ?? me.account.display_name ?? "Account", initials: initialsOf(me.account.display_name ?? "A"), accent: true } : { id: "account", label: "Sign in", icon: UserRound });
  // With profiles, the space is a button of its own once the account has more than one (SPC-4).
  if (offers("profiles") && me.signedIn && mySpaces.value.length > 1) out.push({ id: "spaces", label: me.space?.space_name ?? "Spaces", icon: Building2 });
  out.push({ id: "conversations", label: "Conversations", icon: MessagesSquare, badge: nb.threads.value.length || undefined, pressed: threadsOpen.value });
  if (kioskViewer.value.member && !childMode.on.value) out.push({ id: "contacts", label: "Contacts", icon: Users });
  if (childMode.on.value) out.push({ id: "child", label: "Child lock", icon: ShieldCheck, accent: true });
  out.push({ id: "prefs", label: "Preferences", icon: SlidersHorizontal, pressed: prefsOpen.value });
  return out;
});

function onPlayerButton(id: string) {
  if (id === "end") return void endSession();
  if (id === "staff") return void (unlocking.value = true);
  if (id === "profile") return openPrefs("profile");
  if (id === "account") {
    const me = identity.me.value;
    // Signed in with several spaces: choose one; otherwise the guided journey.
    if (me.signedIn && mySpaces.value.length > 1 && !identity.locked.value) return void (spacePickerAsked.value = true);
    return void startJourney("your-account");
  }
  if (id === "spaces") return identity.locked.value ? openPrefs("account") : void (spacePickerAsked.value = true);
  if (id === "child") return openPrefs("child");
  if (id === "prefs") return prefsOpen.value ? closePrefs() : openPrefs("language");
  if (id === "contacts") return void router.push({ path: "/kiosk", query: { screen: "services", staff: "team" } });
  if (id === "conversations") {
    if (prefsOpen.value) closePrefs();
    screen.value = "transcript";
    threadsOpen.value = !threadsOpen.value;
  }
}

/** PLY-5: while an answer is read aloud and the message box isn't on screen, a chip stops it. */
const stopChip = computed(() => voiceOut.speaking.value && (screen.value !== "transcript" || prefsOpen.value || showPicker.value));

const playerVariant = computed(() => (layout.value === "full" ? "full" : layout.value === "pod" ? "strip" : "mini"));
/** Full and Mini have a fixed height: the screen's navigation stays put and the screen scrolls inside. */
const fixedHeight = computed(() => true);
</script>

<template>
  <!-- Measure the full available width (not the mini card), so Auto can grow back out of mini. -->
  <!-- Embedded (the catalogue's Ask Me): the conversation alone; its host gives it a height. -->
  <div v-if="embedded" class="flex h-full min-h-0 flex-col gap-2">
    <!-- Its New and Conversations join the catalogue's pills (the catalogue has its own sign-in and
         Preferences), so there is one row of controls. -->
    <Teleport defer to="#catalogue-ask-pills"><AskMePills
      conversation-only
      :on-ask-me="screen === 'transcript' || props.embedded"
      :can-new="chat.turns.value.length > 0"
      :threads="nb.threads.value.length"
      :drawer-open="threadsOpen"
      @new="chat.reset"
      @conversations="(screen = 'transcript'), (threadsOpen = !threadsOpen)"
    /></Teleport>
    <TranscriptPane
      :turns="chat.turns.value"
      :busy="chat.busy.value"
      :listening="voiceIn.listening.value"
      :voice-supported="voiceIn.supported.value && (!restricted || settings.restricted.mic)"
      height-class="h-full"
      @mic="onMic"
      :speaking="voiceOut.speaking.value"
      :paused="voiceOut.paused.value"
      @pause-resume="onPauseResume"
      @stop="onStop"
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
      @spelling="onSpelling"
      @reset="chat.reset"
      :services="services"
      :notebook="nb.notebook.value"
      :member="kioskViewer.member && !childMode.on.value"
      @journey="(id) => startJourney(id)"
      @request="(ref, open) => showRequest(ref, open)"
      @attach="attachFiles"
      @journey-update="onJourneyUpdate"
      @design-say="designSay"
      @design-update="onDesignUpdate"
      @journey-done="(id) => void logActivity('journey.completed', { journey: id })"
      @speak="(t) => voiceOut.speak(t)"
      :threads="nb.threads.value"
                v-model:drawer="threadsOpen"
      :restricted="restricted"
      :front-services="settings.restricted.services"
      :allow-attach="!restricted || settings.restricted.attach"
      :active-thread-id="chat.threadId.value"
      @open-thread="(id) => chat.open(id)"
      @schedule="openScheduler"
      @tool="openTool"
    >
      <!-- The front desk starts with its services. -->
      <template #empty>
                  <ComingUp v-if="!restricted && !embedded" @open="openScheduler('')" />
        <ul v-if="restricted && frontJourneys.length" class="mx-auto mt-6 grid max-w-xl gap-2 text-left @lg:grid-cols-2">
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
          :listening="voiceIn.listening.value"
          :interim="voiceIn.interim.value"
          :voice-supported="voiceIn.supported.value && (!restricted || settings.restricted.mic)"
        >
          <template #actions><PlayerButtons :buttons="playerButtons" :variant="playerVariant" @pick="onPlayerButton" /></template>
          <template #meta>
            <template v-if="restricted">Front desk · {{ frontDocs.length }} document{{ frontDocs.length === 1 ? "" : "s" }}</template>
            <template v-else-if="nb.notebook.value">{{ nb.notebook.value.title }} · {{ sourceCount }} source{{ sourceCount === 1 ? "" : "s" }}</template>
            <span v-if="offline" class="block text-brand">Loading on-device model{{ offline.progress ? ` ${Math.round(offline.progress)}%` : "…" }}</span>
          </template>
        </PlayerPanel>
      </template>
      <template #default="{ width: screensWidth }">
      <button v-if="stopChip" type="button" class="fixed bottom-6 left-1/2 z-40 inline-flex -translate-x-1/2 items-center gap-2 rounded-full bg-console px-4 py-2.5 text-sm font-medium text-white shadow-lg ring-1 ring-white/15" @click="onStop">
        <Square class="size-4 text-brand" aria-hidden="true" /> Stop reading aloud
      </button>
      <KioskPreferences v-if="prefsOpen" :nickname="account.profile.value?.nickname ?? null" :fill="fixedHeight" @close="closePrefs" />
      <ProfilePicker v-else-if="showPicker" @visitor="chooseVisitor" @add="openPrefs('profile')" />
      <SpacePicker v-else-if="showSpacePicker" :defer="deferPick" @pick="onSpacePick" @later="spaceNotNow" @more="(spaceNotNow(), startJourney('your-account'))" />
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
            <!-- The kiosk's own controls, as pills at the end of the tab row. -->
            <template #trail>
              <AskMePills
                :on-ask-me="(screen === 'transcript' || props.embedded) && !restricted"
                :can-new="chat.turns.value.length > 0"
                :threads="nb.threads.value.length"
                :drawer-open="threadsOpen"
                @new="chat.reset"
              />
            </template>
            <template v-for="s in navScreens" :key="s.id" #[s.id]>
              <TranscriptPane
                v-if="componentOf(s.id) === 'transcript'"
                :turns="chat.turns.value"
                :busy="chat.busy.value"
                :listening="voiceIn.listening.value"
                :voice-supported="voiceIn.supported.value && (!restricted || settings.restricted.mic)"
                :height-class="fixedHeight ? 'h-full' : undefined"
                @mic="onMic"
                :speaking="voiceOut.speaking.value"
                :paused="voiceOut.paused.value"
                @pause-resume="onPauseResume"
                @stop="onStop"
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
                @spelling="onSpelling"
                @reset="chat.reset"
                :services="services"
                :notebook="nb.notebook.value"
                :member="kioskViewer.member && !childMode.on.value"
                @journey="(id) => startJourney(id)"
                @request="(ref, open) => showRequest(ref, open)"
                @attach="attachFiles"
                @journey-update="onJourneyUpdate"
      @design-say="designSay"
      @design-update="onDesignUpdate"
                @journey-done="(id) => void logActivity('journey.completed', { journey: id })"
                @speak="(t) => voiceOut.speak(t)"
                :threads="nb.threads.value"
                v-model:drawer="threadsOpen"
                :restricted="restricted"
                :front-services="settings.restricted.services"
                :allow-attach="!restricted || settings.restricted.attach"
                :active-thread-id="chat.threadId.value"
                @open-thread="(id) => chat.open(id)"
                @schedule="openScheduler"
                @tool="openTool"
              >
                <!-- The front desk starts with its services. -->
                <template #empty>
                  <ComingUp v-if="!restricted" @open="openScheduler('')" />
                  <ul v-if="restricted && frontJourneys.length" class="mx-auto mt-6 grid max-w-xl gap-2 text-left @lg:grid-cols-2">
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
  <!-- Staff leaving the front desk: over everything. -->
  <RestrictedUnlock v-if="unlocking" @close="unlocking = false" @unlocked="unlocking = false" />
</template>
