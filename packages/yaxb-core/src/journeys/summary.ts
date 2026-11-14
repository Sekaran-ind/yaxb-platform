// Journey summaries (docs/specs/05-journeys-and-forms.md, JRN-20..22): what a journey does, built
// from its definition so it is always current, and what a finished run did.
import { LANGUAGES } from "../schemas/index.js";
import { journeyRolesNeeded, progressOf, type Field, type Journey, type RunState, type Step } from "./index.js";

/** Where a service's work happens, for the visitor. */
export type ServiceWhere = "device" | "assistant" | "notebook";
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
  const queue = [journey.start];
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
    const info = s.service ? (SERVICE_INFO[s.service] ?? { label: s.service, where: "assistant" as const }) : null;
    return { id, label: labelOf(id, s), kind: kindOf(s), asks, service: info && s.service ? { name: s.service, ...info } : null };
  });
  const asks = [...new Set(steps.flatMap((s) => s.asks))];
  const uses = steps.flatMap((s) => (s.service ? [s.service] : [])).filter((u, i, all) => all.findIndex((x) => x.name === u.name) === i);
  const toAssistant = uses.some((u) => u.where === "assistant");
  // A journey other people answer or finish is handed over: its answers are kept as a request (a case).
  const handedTo = [...new Set(journeyRolesNeeded(journey).filter((n) => n.for.includes("answer") || n.for.includes("finish")).map((n) => n.role))];
  const leavesDevice = toAssistant || handedTo.length > 0;
  const parts = [asks.length ? `Asks for ${list(asks.map((a) => a.toLowerCase()))}` : "Asks for nothing", uses.length ? `uses ${list(uses.map((u) => u.label))}` : null].filter(Boolean);
  const where = [
    toAssistant ? "What you give it is sent to the AI assistant." : null,
    handedTo.length ? "Your answers go, as a request with a reference, to the staff who take it from you." : null,
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
  answers: { step: string; field: string; value: string }[];
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
      const v = display(f, state.answers[t.step]?.[f.id]);
      if (v) answers.push({ step: t.label, field: f.label, value: v });
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
