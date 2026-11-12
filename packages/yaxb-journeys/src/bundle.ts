// A bundle: services, journeys and questionnaires in one YAML file, separated by `---` lines,
// compiled together so references between them are checked (Service → Journey → Questionnaire).
// The studio edits one; a deployment may also ship its content this way.
//
//   kind: service          items open journeys …
//   ---
//   kind: journey          ask steps may use `questionnaire: <id>` …
//   ---
//   kind: questionnaire    sections of fields …
//
// Documents can come in any order. Each problem names its document and the line it starts on,
// so an editor can point at it.
import { load } from "js-yaml";
import { compileJourney, type Journey, type ServiceHandler } from "./journeys.js";
import { compileQuestionnaire, type Questionnaire } from "./questionnaires.js";
import { VISITOR_ROLE } from "./roles.js";
import { compileService, type Service } from "./services.js";

export const BUNDLE_KINDS = ["service", "journey", "questionnaire"] as const;
export type BundleKind = (typeof BUNDLE_KINDS)[number];

/** Larger sources are refused before parsing, so an editor stays responsive. */
export const MAX_BUNDLE_BYTES = 256 * 1024;

export type BundleProblem = {
  level: "error" | "warning";
  message: string;
  /** 1-based line where the document (or, for a YAML error, the mistake) is. */
  line: number;
  kind?: string;
  id?: string;
};

export type BundleDocument = { kind?: string; id?: string; line: number; ok: boolean };

export type Bundle = {
  services: Service[];
  journeys: Journey[];
  questionnaires: Questionnaire[];
  documents: BundleDocument[];
  problems: BundleProblem[];
  /** No errors (warnings allowed). */
  ok: boolean;
};

export type BundleOptions = {
  /** Handler names journeys may use; any dotted name is accepted when absent. */
  services?: readonly string[];
  /** Screen ids that service items may open; not checked when absent. */
  screens?: readonly string[];
  /** Role ids that exist (a library's catalogue); any well-formed id is accepted when absent. */
  roles?: readonly string[];
};

type Chunk = { text: string; line: number };

/**
 * The line a problem is about, inside its document: the last 'quoted' name in the message that
 * appears there as a whole word ("step 'intake': no questionnaire 'visit-intak'" → the line with
 * visit-intak). Falls back to the document's first line.
 */
export function problemLine(chunk: Chunk, message: string): number {
  const names = [...message.matchAll(/'([^'\n]{1,80})'/g)].map((m) => m[1]!).reverse();
  const lines = chunk.text.split("\n");
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const word = new RegExp(`(^|[^\\w-])${escaped}($|[^\\w-])`);
    const i = lines.findIndex((l) => !l.trimStart().startsWith("#") && word.test(l));
    if (i >= 0) return chunk.line + i;
  }
  return chunk.line;
}

/** Split on `---` lines (YAML document markers), keeping each document's first line. */
export function splitDocuments(source: string): Chunk[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const chunks: Chunk[] = [];
  let start = 0;
  const flush = (end: number) => {
    const text = lines.slice(start, end).join("\n");
    // A document of only comments and blank lines isn't one.
    if (text.split("\n").some((l) => l.trim() && !l.trim().startsWith("#"))) chunks.push({ text, line: start + 1 });
  };
  lines.forEach((l, i) => {
    if (/^---(\s|$)/.test(l) || /^\.\.\.\s*$/.test(l)) {
      flush(i);
      start = i + 1;
    }
  });
  flush(lines.length);
  return chunks;
}

export function compileBundle(source: string | string[], options: BundleOptions = {}): Bundle {
  const text = Array.isArray(source) ? source.join("\n---\n") : source;
  const empty = (problem: BundleProblem): Bundle => ({ services: [], journeys: [], questionnaires: [], documents: [], problems: [problem], ok: false });
  if (new TextEncoder().encode(text).length > MAX_BUNDLE_BYTES) {
    return empty({ level: "error", line: 1, message: `The YAML is larger than ${MAX_BUNDLE_BYTES / 1024} KB. Split it into smaller files.` });
  }

  const problems: BundleProblem[] = [];
  const parsed: { doc: Record<string, unknown>; line: number; chunk: Chunk; meta: BundleDocument }[] = [];
  const documents: BundleDocument[] = [];
  for (const chunk of splitDocuments(text)) {
    let doc: unknown;
    try {
      doc = load(chunk.text);
    } catch (e) {
      const err = e as Error & { mark?: { line?: number } };
      const line = chunk.line + (err.mark?.line ?? 0);
      problems.push({ level: "error", line, message: `YAML: ${err.message.split("\n")[0]}` });
      documents.push({ line: chunk.line, ok: false });
      continue;
    }
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
      problems.push({ level: "error", line: chunk.line, message: "Each document is a mapping with a kind (service, journey or questionnaire)." });
      documents.push({ line: chunk.line, ok: false });
      continue;
    }
    const d = doc as Record<string, unknown>;
    const meta: BundleDocument = { kind: typeof d.kind === "string" ? d.kind : undefined, id: typeof d.id === "string" ? d.id : undefined, line: chunk.line, ok: true };
    documents.push(meta);
    if (!(BUNDLE_KINDS as readonly string[]).includes(String(d.kind))) {
      problems.push({ level: "error", line: chunk.line, id: meta.id, message: `kind must be one of ${BUNDLE_KINDS.join(", ")}` });
      meta.ok = false;
      continue;
    }
    parsed.push({ doc: d, line: chunk.line, chunk, meta });
  }
  if (!documents.length) problems.push({ level: "error", line: 1, message: "Nothing to compile yet: add a service, a journey or a questionnaire." });

  const fail = (p: (typeof parsed)[number], messages: string[]) => {
    p.meta.ok = false;
    for (const message of messages) problems.push({ level: "error", line: problemLine(p.chunk, message), kind: p.meta.kind, id: p.meta.id, message });
  };
  const ofKind = (kind: BundleKind) => parsed.filter((p) => p.doc.kind === kind);
  const unique = (kind: BundleKind) => {
    const seen = new Set<string>();
    return ofKind(kind).filter((p) => {
      if (!p.meta.id || !seen.has(p.meta.id)) {
        if (p.meta.id) seen.add(p.meta.id);
        return true;
      }
      fail(p, [`another ${kind} already has the id '${p.meta.id}'`]);
      return false;
    });
  };

  // Questionnaires first: journeys refer to them, services refer to journeys.
  const questionnaires: Questionnaire[] = [];
  for (const p of unique("questionnaire")) {
    const r = compileQuestionnaire(p.doc);
    if (r.ok) questionnaires.push(r.questionnaire);
    else fail(p, r.problems);
  }

  const journeys: Journey[] = [];
  const journeyDocs = unique("journey");
  for (const p of journeyDocs) {
    const r = compileJourney(p.doc, { services: options.services, questionnaires, roles: options.roles });
    if (r.ok) journeys.push(r.journey);
    else fail(p, r.problems);
  }

  // A service may name a journey that failed to compile: that journey's own errors say why.
  const journeyIds = journeyDocs.flatMap((p) => (p.meta.id ? [p.meta.id] : []));
  const services: Service[] = [];
  for (const p of unique("service")) {
    const r = compileService(p.doc, { journeys: journeyIds, screens: options.screens, roles: options.roles });
    if (r.ok) services.push(r.service);
    else fail(p, r.problems);
  }

  // Warnings: things that compile but nobody reaches.
  const linked = new Set(services.flatMap((s) => s.items.flatMap((i) => (i.journey ? [i.journey] : []))));
  const used = new Set(journeys.flatMap((j) => Object.values(j.steps).flatMap((s) => (s.questionnaire ? [s.questionnaire] : []))));
  for (const p of journeyDocs) {
    if (p.meta.ok && p.meta.id && services.length && !linked.has(p.meta.id))
      problems.push({ level: "warning", line: p.line, kind: "journey", id: p.meta.id, message: "no service item opens this journey" });
  }
  for (const p of ofKind("questionnaire")) {
    if (p.meta.ok && p.meta.id && !used.has(p.meta.id))
      problems.push({ level: "warning", line: p.line, kind: "questionnaire", id: p.meta.id, message: "no journey step uses this questionnaire" });
  }

  // A journey's roles should take part in every service that opens it (when the service lists roles).
  for (const s of services) {
    if (!s.roles?.length) continue;
    for (const item of s.items) {
      const j = item.journey ? journeys.find((x) => x.id === item.journey) : undefined;
      const p = j && journeyDocs.find((d) => d.meta.id === j.id);
      if (!j || !p) continue;
      const missing = [...new Set([...(j.roles?.initiate ?? []), ...(j.roles?.complete ?? [])])].filter((r) => r !== VISITOR_ROLE && !s.roles!.includes(r));
      for (const r of missing)
        problems.push({ level: "warning", line: problemLine(p.chunk, `'${r}'`), kind: "journey", id: j.id, message: `role '${r}' doesn't take part in service '${s.id}'` });
    }
  }

  problems.sort((a, b) => a.line - b.line || (a.level === b.level ? 0 : a.level === "error" ? -1 : 1));
  return { services, journeys, questionnaires, documents, problems, ok: !problems.some((p) => p.level === "error") };
}

/** Every handler name the bundle's journeys call. */
export const serviceNamesOf = (journeys: Journey[]): string[] => [...new Set(journeys.flatMap((j) => Object.values(j.steps).flatMap((s) => (s.service ? [s.service] : []))))].sort();

/**
 * Stand-in handlers for a preview: each waits a moment and answers with what it was given, so a
 * journey runs end to end without the kiosk's models or notebook. Real handlers passed in win.
 */
export function previewHandlers(journeys: Journey[], real: Record<string, ServiceHandler> = {}, { delayMs = 350 } = {}): Record<string, ServiceHandler> {
  const out: Record<string, ServiceHandler> = {};
  for (const name of serviceNamesOf(journeys)) {
    out[name] = Object.hasOwn(real, name)
      ? real[name]!
      : async (input, { signal }) => {
          await new Promise<void>((resolve, reject) => {
            const t = setTimeout(resolve, delayMs);
            signal?.addEventListener("abort", () => (clearTimeout(t), reject(new Error("Stopped."))), { once: true });
          });
          const given = input && typeof input === "object" ? JSON.stringify(input) : String(input ?? "");
          return { text: `(Preview) ${name} would run here with ${given.length > 160 ? `${given.slice(0, 160)}…` : given}`, preview: true };
        };
  }
  return out;
}

export { EXAMPLE_BUNDLE } from "./example.js";

/**
 * Check one document in the context of others (a library entry among the rest of its library).
 * Returns the bundle and just this document's problems, with lines counted in `yaml` itself.
 * The document must be a single document (no `---` inside).
 */
export function checkDocument(yaml: string, others: readonly string[], options: BundleOptions = {}): { bundle: Bundle; problems: BundleProblem[] } {
  if (splitDocuments(yaml).length > 1) {
    const bundle = compileBundle(yaml, options);
    return { bundle, problems: [{ level: "error", line: 1, message: "One document per entry: remove the --- lines and save the others as their own entries." }] };
  }
  // This document first, so its lines are the bundle's first lines.
  const bundle = compileBundle([yaml, ...others], options);
  const lines = yaml.replace(/\r\n?/g, "\n").split("\n").length;
  return { bundle, problems: bundle.problems.filter((p) => p.line <= lines) };
}
