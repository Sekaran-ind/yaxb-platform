// Kiosk profiles: a little about the visitor, what they're interested in, and a few questions
// about how they like to be helped. Modelled on clinux-diary's first run (privacy notice → the
// person → a passphrase): a profile lives on the device, encrypted with the visitor's passphrase
// (./crypto.ts); there is no server account. Deliberately little: a nickname, never an ID number,
// a date of birth or health details.
//
// The answers suggest settings (preferencesFrom): how questions are answered, web search, voice,
// layout, skills, helpers, and which services to show first. Each suggestion says why, and the
// visitor applies them (or not).
//
// The activity log (activityEvent) records what happened on the profile, never what was said:
// an action, a time and a few short facts.
import { z } from "zod";
import { DEFAULT_LANGUAGE, LANGUAGES, type AgentSettings, type LanguageCode } from "../schemas/index.js";

export const NOTICE_VERSION = "2026-11-12";
export const NOTICE_POINTS = [
  "Your profile stays on this device, locked with your passphrase. Nothing about it is sent to a server.",
  "It holds only what you tell us here: a nickname, an age range, your language, your interests and how you like to be helped. Never ID numbers or health details.",
  "Your activity log records what you did (for example, that a question was asked), never what you said.",
  "Without the passphrase nobody can open the profile, including us. If you forget it, the profile can only be erased.",
  "You can change, export or erase everything at any time from your profile.",
] as const;

export const MIN_PASSPHRASE = 8;

export const AGE_RANGES = [
  { value: "under-18", label: "Under 18" },
  { value: "18-29", label: "18–29" },
  { value: "30-44", label: "30–44" },
  { value: "45-59", label: "45–59" },
  { value: "60-74", label: "60–74" },
  { value: "75-plus", label: "75 or over" },
] as const;

/** What a visitor can say they're interested in. */
export const INTEREST_DOMAINS = [
  { id: "health-topics", label: "Health topics", description: "Conditions, symptoms and staying well" },
  { id: "medicines", label: "Medicines and pharmacy", description: "Prescriptions and how to take them" },
  { id: "nutrition", label: "Food and nutrition", description: "Diet, meals and supplements" },
  { id: "reports", label: "Reports and test results", description: "Understanding diagnostic and health reports" },
  { id: "visits", label: "Visits and appointments", description: "Checking in and getting around" },
  { id: "documents", label: "My own documents", description: "Reading, summarising and asking about documents you bring" },
  { id: "policies", label: "Workplace policies", description: "Code of conduct, procedures and reporting concerns" },
  { id: "languages", label: "Translation", description: "Reading things in another language" },
] as const;
export type InterestId = (typeof INTEREST_DOMAINS)[number]["id"];

/** A few questions about how the visitor likes to be helped. Each option drives some settings. */
export const PERSONALITY_QUESTIONS = [
  {
    id: "depth",
    question: "When you ask something, what suits you best?",
    options: [
      { value: "brief", label: "A short, direct answer" },
      { value: "detailed", label: "A fuller explanation with the details" },
    ],
  },
  {
    id: "channel",
    question: "How do you prefer to use the kiosk?",
    options: [
      { value: "voice", label: "Talking and listening" },
      { value: "text", label: "Reading and typing" },
      { value: "both", label: "Both" },
    ],
  },
  {
    id: "privacy",
    question: "Where should answers come from?",
    options: [
      { value: "device", label: "Only this device and the kiosk's own information" },
      { value: "assistant", label: "The AI assistant, from the kiosk's information" },
      { value: "web", label: "The AI assistant, and the web when the kiosk doesn't know" },
    ],
  },
  {
    id: "comfort",
    question: "How comfortable are you with technology?",
    options: [
      { value: "new", label: "Keep it simple, please" },
      { value: "some", label: "I manage fine" },
      { value: "confident", label: "Show me everything" },
    ],
  },
  {
    id: "checking",
    question: "For health answers, do you want a second check before you see them?",
    options: [
      { value: "yes", label: "Yes, take a moment to check" },
      { value: "no", label: "No, answer straight away" },
    ],
  },
] as const;
export type PersonalityId = (typeof PERSONALITY_QUESTIONS)[number]["id"];

const optionValues = (id: PersonalityId) => PERSONALITY_QUESTIONS.find((q) => q.id === id)!.options.map((o) => o.value) as [string, ...string[]];

export const profileSchema = z.strictObject({
  nickname: z.string().trim().min(1, "Enter a nickname.").max(40, "Keep the nickname under 40 characters."),
  ageRange: z.enum(AGE_RANGES.map((a) => a.value) as [string, ...string[]]).optional(),
  language: z.enum(LANGUAGES.map((l) => l.code) as [LanguageCode, ...LanguageCode[]]).default(DEFAULT_LANGUAGE),
  city: z.string().trim().max(60).optional(),
  interests: z.array(z.enum(INTEREST_DOMAINS.map((d) => d.id) as [InterestId, ...InterestId[]])).max(INTEREST_DOMAINS.length).default([]),
  personality: z
    .strictObject({
      depth: z.enum(optionValues("depth")).optional(),
      channel: z.enum(optionValues("channel")).optional(),
      privacy: z.enum(optionValues("privacy")).optional(),
      comfort: z.enum(optionValues("comfort")).optional(),
      checking: z.enum(optionValues("checking")).optional(),
    })
    .default({}),
});
export type Profile = z.infer<typeof profileSchema>;

/** A friendly first problem with a profile, or null. */
export function profileProblem(input: unknown): string | null {
  const r = profileSchema.safeParse(input);
  return r.success ? null : (r.error.issues[0]?.message ?? "Check the details.");
}

// ---- preferences ----------------------------------------------------------------------------------

/** Kiosk-side preferences (not part of the agent's settings). */
export type KioskPreferences = { speakResponses?: boolean; layout?: "auto" | "mini" | "pod" | "full"; speechRate?: number };

export type Suggestion = {
  /** What it changes, for the visitor: "Answers come only from this device". */
  label: string;
  /** Why: "You chose: Only this device and the kiosk's own information". */
  because: string;
};

export type Preferences = {
  agent: Partial<Omit<AgentSettings, "knowledge" | "tools" | "subagents" | "skills">> & {
    knowledge?: Partial<AgentSettings["knowledge"]>;
    tools?: Record<string, boolean>;
    subagents?: Record<string, boolean>;
    skills?: Record<string, boolean>;
  };
  kiosk: KioskPreferences;
  /** Services (service item keys) and journeys to show first, best first. */
  highlight: string[];
  suggestions: Suggestion[];
};

const answer = (id: PersonalityId, value: string | undefined) => PERSONALITY_QUESTIONS.find((q) => q.id === id)?.options.find((o) => o.value === value)?.label;
const interestLabel = (id: InterestId) => INTEREST_DOMAINS.find((d) => d.id === id)!.label;

/** Which service items each interest brings forward (content/services keys, and catalogue items: a nested service's items are its journey ids). */
const INTEREST_HIGHLIGHTS: Record<InterestId, string[]> = {
  "health-topics": ["ask"],
  medicines: ["ask"],
  nutrition: ["ask"],
  reports: ["find", "summarise"],
  visits: ["visit-check-in"],
  documents: ["open", "summarise", "briefing", "find"],
  policies: ["ask", "sources"],
  languages: ["translate"],
};

/**
 * Settings that suit a profile. Pure: the surface shows the suggestions and applies `agent` and
 * `kiosk` only when the visitor agrees.
 */
export function preferencesFrom(profile: Profile): Preferences {
  const p = profile.personality ?? {};
  const out: Preferences = { agent: { language: profile.language }, kiosk: {}, highlight: [], suggestions: [] };
  const lang = LANGUAGES.find((l) => l.code === profile.language);
  if (lang && profile.language !== DEFAULT_LANGUAGE) out.suggestions.push({ label: `The kiosk speaks and answers in ${lang.label}`, because: `Your language: ${lang.native}` });

  // Where answers come from
  if (p.privacy === "device") {
    out.agent.knowledge = { answers: "local", web: "off" };
    out.suggestions.push({ label: "Answers come only from this device and the kiosk's own information, word for word with their source", because: `You chose: ${answer("privacy", p.privacy)}` });
  } else if (p.privacy === "assistant") {
    out.agent.knowledge = { answers: "auto", web: "off" };
    out.suggestions.push({ label: "Curated answers on this device when they match; the AI assistant otherwise, with no web search", because: `You chose: ${answer("privacy", p.privacy)}` });
  } else if (p.privacy === "web") {
    out.agent.knowledge = { answers: "agent", web: "fallback" };
    out.suggestions.push({ label: "The AI assistant answers, and searches the web when the kiosk doesn't know (citing the site)", because: `You chose: ${answer("privacy", p.privacy)}` });
  }

  // How much detail
  if (p.depth === "brief") {
    out.agent.skills = { "plain-language": true };
    out.agent.subagents = { ...out.agent.subagents, "knowledge-researcher": false };
    out.suggestions.push({ label: "Short, plain answers", because: `You chose: ${answer("depth", p.depth)}` });
  } else if (p.depth === "detailed") {
    out.agent.subagents = { ...out.agent.subagents, "knowledge-researcher": true };
    out.agent.tools = { ...out.agent.tools, planning: true };
    out.suggestions.push({ label: "Fuller answers: the research helper looks things up in more depth", because: `You chose: ${answer("depth", p.depth)}` });
  }

  // A second check for health answers
  if (p.checking === "yes") {
    out.agent.subagents = { ...out.agent.subagents, "safety-reviewer": true };
    out.suggestions.push({ label: "Health answers are checked by the safety reviewer before you see them", because: `You chose: ${answer("checking", p.checking)}` });
  } else if (p.checking === "no") {
    out.agent.subagents = { ...out.agent.subagents, "safety-reviewer": false };
  }

  // Voice or text
  if (p.channel === "voice" || p.channel === "both") {
    out.kiosk.speakResponses = true;
    if (p.channel === "voice") out.suggestions.push({ label: "Answers are read aloud", because: `You chose: ${answer("channel", p.channel)}` });
  } else if (p.channel === "text") {
    out.kiosk.speakResponses = false;
    out.suggestions.push({ label: "Answers are shown, not read aloud", because: `You chose: ${answer("channel", p.channel)}` });
  }

  // Comfort with technology, and age
  const older = profile.ageRange === "60-74" || profile.ageRange === "75-plus";
  if (p.comfort === "new") {
    out.kiosk.layout = "mini";
    out.kiosk.speechRate = 0.9;
    out.suggestions.push({ label: "A simpler screen, one thing at a time, and slower speech", because: `You chose: ${answer("comfort", p.comfort)}` });
  } else if (p.comfort === "confident") {
    out.kiosk.layout = "full";
    out.suggestions.push({ label: "The full kiosk, with every screen", because: `You chose: ${answer("comfort", p.comfort)}` });
  } else if (older && p.comfort !== "some") {
    out.kiosk.speechRate = 0.9;
    out.suggestions.push({ label: "Slightly slower speech", because: `Your age range: ${AGE_RANGES.find((a) => a.value === profile.ageRange)!.label}` });
  }

  // Interests: tools and services
  const interests = profile.interests ?? [];
  if (interests.includes("documents") || interests.includes("reports")) {
    out.agent.tools = { ...out.agent.tools, files: true };
    out.agent.skills = { ...out.agent.skills, "notebook-research": true, "summarise-document": true };
    out.suggestions.push({ label: "Notebook tools for reading, summarising and asking about your documents", because: `Your interests: ${interests.filter((i) => i === "documents" || i === "reports").map(interestLabel).join(", ")}` });
  }
  if (interests.includes("health-topics") || interests.includes("medicines") || interests.includes("nutrition")) {
    out.agent.skills = { ...out.agent.skills, "explain-health-topic": true };
  }
  const highlight = new Set<string>();
  for (const i of interests) for (const h of INTEREST_HIGHLIGHTS[i]) highlight.add(h);
  out.highlight = [...highlight];
  if (out.highlight.length) out.suggestions.push({ label: "The services that match your interests are shown first", because: `Your interests: ${interests.map(interestLabel).join(", ")}` });
  return out;
}

/** Apply preferences on top of the current settings (nested maps merged, not replaced). */
export function applyPreferences(settings: AgentSettings, prefs: Preferences): AgentSettings {
  const a = prefs.agent;
  return {
    ...settings,
    ...(a.language ? { language: a.language } : {}),
    knowledge: { ...settings.knowledge, ...a.knowledge },
    tools: { ...settings.tools, ...a.tools },
    subagents: { ...settings.subagents, ...a.subagents },
    skills: { ...settings.skills, ...a.skills },
  };
}

// ---- activity log ---------------------------------------------------------------------------------

export const ACTIVITY_ACTIONS = {
  "account.created": "Profile created",
  "account.unlocked": "Signed in",
  "account.locked": "Signed out",
  "account.auto_locked": "Signed out after a quiet spell",
  "account.updated": "Profile changed",
  "account.passphrase_changed": "Passphrase changed",
  "account.exported": "Profile exported",
  "preferences.applied": "Suggested settings applied",
  "preferences.undone": "Suggested settings undone",
  "question.asked": "Question asked",
  "question.escalated": "Question passed to the moderators",
  "web.searched": "The web was searched",
  "feedback.given": "Feedback given",
  "answer.sent_for_review": "Answer sent to the moderators to check",
  "command.used": "Kiosk command used",
  "journey.completed": "Service used",
  "notebook.source_added": "Document added to the notebook",
  "notebook.source_removed": "Document removed from the notebook",
  "notebook.memory_updated": "Notebook memory changed",
} as const;
export type ActivityAction = keyof typeof ACTIVITY_ACTIONS;

/** Facts an event may carry: short labels and counts, never what the visitor said or wrote. */
const DETAIL_KEYS = new Set(["command", "rating", "mode", "language", "journey", "via", "count", "fields", "provider", "model", "harness", "sources"]);

export type ActivityEvent = { id: string; at: string; action: ActivityAction; details?: Record<string, string | number | boolean> };

/** A log entry: unknown actions refused, details limited to known keys and short values. */
export function activityEvent(action: ActivityAction, details: Record<string, unknown> = {}, now = new Date()): ActivityEvent {
  if (!(action in ACTIVITY_ACTIONS)) throw new Error(`Unknown activity: ${action}`);
  const clean: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(details)) {
    if (!DETAIL_KEYS.has(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) clean[k] = v;
    else if (typeof v === "boolean") clean[k] = v;
    else if (typeof v === "string" && v.trim()) clean[k] = v.trim().slice(0, 60);
  }
  return { id: crypto.randomUUID(), at: now.toISOString(), action, ...(Object.keys(clean).length ? { details: clean } : {}) };
}

/** Newest first, at most `max` entries. */
export function appendActivity(log: readonly ActivityEvent[], event: ActivityEvent, max = 500): ActivityEvent[] {
  return [event, ...log].slice(0, max);
}
