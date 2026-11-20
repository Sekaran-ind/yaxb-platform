// Journey summaries (docs/specs/05-journeys-and-forms.md, JRN-20..22): what a journey does, built
// from its definition so it is always current, and what a finished run did.
import { LANGUAGES } from "../schemas/index.js";
import { afterTasks, isMediaRef, journeyRolesNeeded, journeyTasks, progressOf, type Field, type Journey, type MediaRef, type RunState, type Step } from "./index.js";

/** Where a service's work happens, for the visitor. */
/** `account`: Anjal's account service (sign-in and spaces, 15-identity.md), never the AI assistant. */
/** outside: a connector (CNX-7), an API the business uses, called by the server with its secret. */
export type ServiceWhere = "device" | "assistant" | "notebook" | "account" | "outside";

/** What a handler is: a built-in one, or a connector's operation (an outside service). */
export function serviceInfo(name: string): ServiceInfo {
  const known = SERVICE_INFO[name];
  if (known) return known;
  const m = /^connector\.([a-z][a-z0-9-]*)\.([a-z][a-z0-9-]*)$/.exec(name);
  if (m) return { label: `${m[1]!.replace(/-/g, " ")} (an outside service)`, where: "outside" };
  return { label: name, where: "assistant" };
}
export type ServiceInfo = { label: string; where: ServiceWhere };

/** Every service a journey may use (content JOURNEY_SERVICES), described for visitors. */
export const SERVICE_INFO: Record<string, ServiceInfo> = {
  "agent.ask": { label: "the AI assistant", where: "assistant" },
  "offline.summarize": { label: "an on-device summariser", where: "device" },
  "offline.translate": { label: "on-device translation", where: "device" },
  "offline.answer": { label: "an on-device question answerer", where: "device" },
  "offline.classify": { label: "an on-device sentiment reader", where: "device" },
  "notebook.add": { label: "your notebook (saving a source)", where: "notebook" },
  "notebook.remember": { label: "your notebook's memory", where: "notebook" },
  "speech.speak": { label: "read-aloud", where: "device" },
  "identity.status": { label: "your account (who is signed in)", where: "account" },
  "attendance.check": { label: "this business's roster (checking your PIN, on this device)", where: "device" },
  // Media (MED-6): read or transcribed on the device; nothing leaves it.
  "media.read": { label: "reading a photo on this device (its text, or a description)", where: "device" },
  "media.transcribe": { label: "writing down a voice note on this device", where: "device" },
  "identity.whoami": { label: "who you are here (your name, how you signed in and your roles; never your email or phone)", where: "account" },
  "identity.passkey.signin": { label: "your passkey", where: "account" },
  "identity.passkey.create": { label: "your passkey and a new account", where: "account" },
  "identity.google": { label: "Google sign-in", where: "account" },
  "identity.recovery": { label: "your recovery code", where: "account" },
  "identity.space.open": { label: "your spaces", where: "account" },
  "identity.space.start": { label: "a new space for you", where: "account" },
  "identity.space.join": { label: "a join code", where: "account" },
  // Website access (SIT-5): the address goes to the kiosk's server, which checks it against the
  // approved sites and reads the page; nothing about the person goes with it.
  "web.read": { label: "reading a website (the address only, checked against the approved sites)", where: "outside" },
  "web.link-out": { label: "opening an approved website", where: "outside" },
  "web.request": { label: "asking for a website to be approved (the address and why, never who asked)", where: "outside" },
  "web.lookup": { label: "looking something up on an approved website", where: "outside" },
};

export type JourneyStepSummary = {
  id: string;
  label: string;
  kind: "ask" | "service" | "decide" | "final";
  /** Field labels the step asks for (required ones first). */
  asks: string[];
  service: (ServiceInfo & { name: string }) | null;
};

export type JourneySummary = {
  id: string;
  title: string;
  summary: string | null;
  icon: string | null;
  category: string | null;
  /** Steps in the order a run meets them (branches followed breadth first). */
  steps: JourneyStepSummary[];
  /** Everything it may ask for, once each. */
  asks: string[];
  /** Services it uses, once each, in order. */
  uses: (ServiceInfo & { name: string })[];
  /** True when a step sends what the visitor gave to the AI assistant (agent.ask). */
  leavesDevice: boolean;
  /** One sentence for visitors: "Asks for …, uses …, and nothing leaves this device." */
  privacy: string;
};

const labelOf = (id: string, s: Step) => s.label ?? id.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
const kindOf = (s: Step): JourneyStepSummary["kind"] => (s.final ? "final" : s.ask ? "ask" : s.service ? "service" : "decide");

function order(journey: Journey): string[] {
  const seen: string[] = [];
  // A parallel journey (JRN-46): its tasks first, as listed, then on from the first other step.
  const tasks = journeyTasks(journey);
  seen.push(...tasks);
  const after = tasks.length ? afterTasks(journey) : null;
  const queue = [tasks.length ? (after ?? journey.start) : journey.start];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.includes(id) || !journey.steps[id]) continue;
    seen.push(id);
    const s = journey.steps[id]!;
    const next = typeof s.next === "string" ? [s.next] : [...(s.next ?? []), ...(s.decide ?? [])].map((b) => b.to);
    queue.push(...next);
  }
  // Steps no branch reaches (shouldn't exist in valid content) still appear, last.
  return [...seen, ...Object.keys(journey.steps).filter((id) => !seen.includes(id))];
}

const list = (items: string[]) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

/** What a journey does, from its definition (JRN-20). */
export function summarizeJourney(journey: Journey): JourneySummary {
  const steps: JourneyStepSummary[] = order(journey).map((id) => {
    const s = journey.steps[id]!;
    const fields = s.fields ?? [];
    const asks = [...fields.filter((f) => f.required), ...fields.filter((f) => !f.required)].map((f) => f.label);
    const info = s.service ? serviceInfo(s.service) : null;
    return { id, label: labelOf(id, s), kind: kindOf(s), asks, service: info && s.service ? { name: s.service, ...info } : null };
  });
  const asks = [...new Set(steps.flatMap((s) => s.asks))];
  // A guard's call (RTN-9) sends the step's answers somewhere too, so it counts like a service.
  const guards = order(journey).flatMap((id) => {
    const call = journey.steps[id]!.guard?.call;
    const info = call ? serviceInfo(call) : null;
    return call && info ? [{ name: call, ...info }] : [];
  });
  const uses = [...steps.flatMap((s) => (s.service ? [s.service] : [])), ...guards].filter((u, i, all) => all.findIndex((x) => x.name === u.name) === i);
  const toAssistant = uses.some((u) => u.where === "assistant");
  // A journey other people answer or finish is handed over: its answers are kept as a request (a case).
  const handedTo = [...new Set(journeyRolesNeeded(journey).filter((n) => n.for.includes("answer") || n.for.includes("finish")).map((n) => n.role))];
  const toAccount = uses.some((u) => u.where === "account");
  const outside = uses.filter((u) => u.where === "outside");
  const leavesDevice = toAssistant || toAccount || outside.length > 0 || handedTo.length > 0;
  const parts = [asks.length ? `Asks for ${list(asks.map((a) => a.toLowerCase()))}` : "Asks for nothing", uses.length ? `uses ${list(uses.map((u) => u.label))}` : null].filter(Boolean);
  const where = [
    toAssistant ? "What you give it is sent to the AI assistant." : null,
    toAccount ? "Signing in goes to Anjal's account service; only your passkey's public key, a hidden form of your Google id and your spaces are kept there." : null,
    handedTo.length ? "Your answers go, as a request with a reference, to whoever takes it from you." : null,
    outside.length ? `Some answers are sent to ${list(outside.map((u) => u.label.replace(" (an outside service)", "")))}, an outside service this business uses.` : null,
  ].filter(Boolean);
  const privacy = `${parts.join(", ")}. ${where.length ? where.join(" ") : "Nothing leaves this device."}`;
  return { id: journey.id, title: journey.title, summary: journey.summary ?? null, icon: journey.icon ?? null, category: journey.category ?? null, steps, asks, uses, leavesDevice, privacy };
}

/** All journeys, as lines for the assistant's prompt (JRN-21): "Title: summary (asks …; uses …)". */
export function journeysText(journeys: readonly Journey[]): string {
  return journeys
    .map(summarizeJourney)
    .map((j) => `- ${j.title}${j.summary ? `: ${j.summary}` : ""} (${j.privacy})`)
    .join("\n");
}

// ---- a finished run (JRN-22) -----------------------------------------------------------------------

export type RunSummary = {
  title: string;
  /** Steps passed, in order, and whether each went well. */
  steps: { label: string; ok: boolean }[];
  /** The answers as the visitor saw them. */
  answers: { step: string; field: string; value: string; media?: MediaRef[] }[];
  result: { title: string; text: string } | null;
  /** The whole run as Markdown, to save to the notebook. */
  markdown: string;
};

function display(field: Field, value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  switch (field.type) {
    case "boolean":
      return value === true ? "Yes" : value === false ? "No" : "";
    case "select":
      return field.options?.find((o) => o.value === value)?.label ?? String(value);
    case "language":
      return LANGUAGES.find((l) => l.code === value)?.label ?? String(value);
    case "source":
      return String((value as { title?: unknown } | null)?.title ?? "");
    case "password":
      return "••••••";
    case "photo": {
      // Never the photo itself (MED-1): how many, and what was read from them (MED-3).
      const list = Array.isArray(value) ? (value as { text?: string }[]) : [];
      if (!list.length) return "";
      const read = list.map((p) => p.text?.trim()).filter(Boolean).join(" · ");
      return `${list.length} photo${list.length === 1 ? "" : "s"}${read ? `: ${read}` : ""}`;
    }
    case "location": {
      // A place: its coordinates, rounded to about 100 m in summaries.
      const v = value as { latitude?: number; longitude?: number } | null;
      return v && typeof v.latitude === "number" && typeof v.longitude === "number" ? `A place on the map (${v.latitude.toFixed(3)}, ${v.longitude.toFixed(3)})` : "";
    }
    case "area":
      return value ? "An area drawn on the map" : "";
    case "audio": {
      const list = Array.isArray(value) ? (value as { text?: string }[]) : [];
      if (!list.length) return "";
      const said = list[0]?.text?.trim();
      return `A voice note${said ? `: “${said}”` : ""}`;
    }
    default:
      return String(value).trim();
  }
}

/** What a finished run did, from its state, to show and save (JRN-22). */
export function summarizeRun(journey: Journey, state: RunState): RunSummary {
  // Decisions are the journey's own workings, and the result is shown on its own (progressOf).
  const steps = progressOf(journey, state.trail).map((t) => ({ label: t.label, ok: t.ok }));
  const answers: RunSummary["answers"] = [];
  for (const t of state.trail) {
    const step = journey.steps[t.step];
    for (const f of step?.fields ?? []) {
      const value = state.answers[t.step]?.[f.id];
      const v = display(f, value);
      // Photos go by reference (MED-1): the screen shows them from this device or the box.
      if (v) answers.push({ step: t.label, field: f.label, value: v, ...((f.type === "photo" || f.type === "audio") && Array.isArray(value) ? { media: value.filter(isMediaRef) } : {}) });
    }
  }
  const result = state.result ? { title: state.result.title, text: state.result.text } : null;
  const md = [
    `# ${journey.title}`,
    "",
    `Completed ${new Date().toISOString().slice(0, 10)}.`,
    "",
    "## Steps",
    ...steps.map((s) => `- ${s.ok ? "✓" : "✗"} ${s.label}`),
    ...(answers.length ? ["", "## Your answers", ...answers.map((a) => `- **${a.field}**: ${a.value.replace(/\n+/g, " ")}`)] : []),
    ...(result ? ["", `## ${result.title}`, "", result.text] : []),
  ];
  return { title: journey.title, steps, answers, result, markdown: md.join("\n") };
}
