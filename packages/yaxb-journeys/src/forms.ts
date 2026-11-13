// Forms for services and journeys, converted to and from YAML. The YAML stays the source of truth.
// A form is a plain object that a UI can bind to. formToService and formToJourney build the
// document (keys in the documented order, empty values dropped), and toYaml writes it out.
// Questionnaires have no form: they are written as YAML.
//
// A journey step in a form is one of four kinds: ask (a questionnaire, or fields given as YAML),
// service (a handler with `with` given as YAML), decide (branches), or final (a result). Steps
// that combine kinds (ask and service in one step) can only be edited as YAML; journeyToForm
// lists them in `unsupported`.
import { dump, load } from "js-yaml";
import type { Branch, Journey } from "./journeys.js";
import type { JourneyRoles, Role } from "./roles.js";
import type { Layout } from "./screens.js";
import type { Service, ServiceItem, StaffSection } from "./services.js";

// ---- YAML -------------------------------------------------------------------------------------

/** One document as YAML, in block style. */
export function toYaml(doc: unknown): string {
  return dump(doc, { lineWidth: 110, noRefs: true });
}

/** Parse one YAML document into a mapping, or say why not. */
export function parseDocument(text: string): { ok: true; doc: Record<string, unknown> } | { ok: false; error: string } {
  try {
    const doc = load(text);
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) return { ok: false, error: "The YAML must be one mapping (key: value lines)." };
    return { ok: true, doc: doc as Record<string, unknown> };
  } catch (e) {
    return { ok: false, error: `YAML: ${(e as Error).message.split("\n")[0]}` };
  }
}

const blank = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
/** Drop empty values, keeping key order. */
function compact<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => !blank(v))) as Partial<T>;
}
const str = (v: unknown) => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v));
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

// ---- services ---------------------------------------------------------------------------------

export type ServiceItemForm = {
  key: string;
  label: string;
  summary: string;
  icon: string;
  opens: "journey" | "screen" | "staff";
  /** The journey id, screen id or staff section. */
  target: string;
  layouts: Layout[];
};

export type ServiceForm = {
  id: string;
  title: string;
  summary: string;
  icon: string;
  order: number | null;
  layouts: Layout[];
  roles: string[];
  items: ServiceItemForm[];
};

export const newServiceItem = (): ServiceItemForm => ({ key: "", label: "", summary: "", icon: "", opens: "journey", target: "", layouts: [] });
export const newServiceForm = (id = ""): ServiceForm => ({ id, title: "", summary: "", icon: "", order: null, layouts: [], roles: [], items: [newServiceItem()] });

export function serviceToForm(doc: Partial<Service> | Record<string, unknown>): ServiceForm {
  const d = doc as Record<string, unknown>;
  const items = Array.isArray(d.items) ? (d.items as Record<string, unknown>[]) : [];
  return {
    id: str(d.id),
    title: str(d.title),
    summary: str(d.summary),
    icon: str(d.icon),
    order: typeof d.order === "number" ? d.order : null,
    layouts: strs(d.layouts) as Layout[],
    roles: strs(d.roles),
    items: items.map((i) => ({
      key: str(i?.key),
      label: str(i?.label),
      summary: str(i?.summary),
      icon: str(i?.icon),
      opens: i?.screen ? "screen" : i?.staff ? "staff" : "journey",
      target: str(i?.journey ?? i?.screen ?? i?.staff),
      layouts: strs(i?.layouts) as Layout[],
    })),
  };
}

export function formToService(f: ServiceForm): Record<string, unknown> {
  return compact({
    kind: "service",
    id: f.id.trim(),
    title: f.title.trim(),
    summary: f.summary.trim(),
    icon: f.icon.trim(),
    order: f.order ?? undefined,
    layouts: f.layouts,
    roles: f.roles,
    items: f.items.map(
      (i) =>
        compact({
          key: i.key.trim(),
          label: i.label.trim(),
          summary: i.summary.trim(),
          icon: i.icon.trim(),
          [i.opens]: i.target.trim(),
          layouts: i.layouts,
        }) as unknown as ServiceItem & { staff?: StaffSection },
    ),
  });
}

// ---- journeys ---------------------------------------------------------------------------------

export type StepKind = "ask" | "service" | "decide" | "final";

export type StepForm = {
  id: string;
  kind: StepKind;
  label: string;
  stage: string;
  icon: string;
  /** ask: the prompt; with a questionnaire it may be empty (the questionnaire's summary is used). */
  ask: string;
  questionnaire: string;
  /** ask without a questionnaire: the fields, as YAML (a list). */
  fieldsYaml: string;
  submitLabel: string;
  /** service: the handler, and its input as YAML (a mapping). */
  service: string;
  withYaml: string;
  onError: "fail" | "continue";
  /** ask and service steps: one next step, or branches. decide steps always use branches. */
  then: "step" | "branches";
  next: string;
  branches: Branch[];
  /** final: the result. `ok` is "", "true", "false" or a template. */
  resultTitle: string;
  resultText: string;
  resultOk: string;
};

export type JourneyForm = {
  id: string;
  title: string;
  summary: string;
  icon: string;
  category: string;
  version: number;
  initiate: string[];
  complete: string[];
  start: string;
  steps: StepForm[];
};

export const newStep = (id = "", kind: StepKind = "ask"): StepForm => ({
  id,
  kind,
  label: "",
  stage: "",
  icon: "",
  ask: "",
  questionnaire: "",
  fieldsYaml: "",
  submitLabel: "",
  service: "",
  withYaml: "",
  onError: "fail",
  then: "step",
  next: "",
  branches: [],
  resultTitle: "",
  resultText: "",
  resultOk: "",
});

export const newJourneyForm = (id = ""): JourneyForm => {
  const ask = { ...newStep("ask", "ask"), label: "Questions", next: "done" };
  const done = { ...newStep("done", "final"), resultTitle: "Thank you" };
  return { id, title: "", summary: "", icon: "", category: "", version: 1, initiate: ["visitor"], complete: [], start: "ask", steps: [ask, done] };
};

const yamlOf = (v: unknown) => (v === undefined ? "" : toYaml(v).trimEnd());

/** A journey document as a form. Steps the form can't represent are named in `unsupported`. */
export function journeyToForm(doc: Partial<Journey> | Record<string, unknown>): { form: JourneyForm; unsupported: string[] } {
  const d = doc as Record<string, unknown>;
  const roles = (d.roles ?? {}) as JourneyRoles;
  const unsupported: string[] = [];
  const steps = Object.entries((d.steps ?? {}) as Record<string, Record<string, unknown>>).map(([id, s]): StepForm => {
    s = s ?? {};
    const kinds = (["ask", "service", "decide", "final"] as const).filter((k) => s[k] !== undefined || (k === "ask" && s.questionnaire !== undefined));
    if (kinds.length > 1) unsupported.push(id);
    const kind: StepKind = kinds[0] ?? "ask";
    const next = s.next;
    const result = (s.result ?? {}) as Record<string, unknown>;
    return {
      ...newStep(id, kind),
      label: str(s.label),
      stage: str(s.stage),
      icon: str(s.icon),
      ask: str(s.ask),
      questionnaire: str(s.questionnaire),
      fieldsYaml: s.fields === undefined ? "" : yamlOf(s.fields),
      submitLabel: str(s.submitLabel),
      service: str(s.service),
      withYaml: yamlOf(s.with),
      onError: s.onError === "continue" ? "continue" : "fail",
      then: Array.isArray(next) ? "branches" : "step",
      next: typeof next === "string" ? next : "",
      branches: (Array.isArray(s.decide) ? s.decide : Array.isArray(next) ? next : []).map((b: Branch) => ({ ...(b?.if !== undefined ? { if: str(b.if) } : {}), to: str(b?.to) })),
      resultTitle: str(result.title),
      resultText: str(result.text),
      resultOk: result.ok === undefined ? "" : str(result.ok),
    };
  });
  return {
    form: {
      id: str(d.id),
      title: str(d.title),
      summary: str(d.summary),
      icon: str(d.icon),
      category: str(d.category),
      version: typeof d.version === "number" ? d.version : 1,
      initiate: strs(roles.initiate),
      complete: strs(roles.complete),
      start: str(d.start),
      steps,
    },
    unsupported,
  };
}

/** The form as a journey document, or the problems that stop it (fields or `with` that aren't YAML). */
export function formToJourney(f: JourneyForm): { ok: true; doc: Record<string, unknown> } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const parse = (at: string, text: string, want: "list" | "mapping") => {
    if (!text.trim()) return undefined;
    try {
      const v = load(text);
      if (want === "list" ? !Array.isArray(v) : !v || typeof v !== "object" || Array.isArray(v)) problems.push(`step '${at}': ${want === "list" ? "fields must be a YAML list" : "with must be a YAML mapping"}`);
      return v;
    } catch (e) {
      problems.push(`step '${at}': ${(e as Error).message.split("\n")[0]}`);
      return undefined;
    }
  };
  // Every branch but the last has a condition (an empty one stays, so the compiler reports it).
  const branches = (list: Branch[]) => list.map((b, i) => (i < list.length - 1 ? { if: (b.if ?? "").trim(), to: b.to.trim() } : { to: b.to.trim() }));
  const steps: Record<string, unknown> = {};
  for (const s of f.steps) {
    const id = s.id.trim();
    const then = s.then === "branches" ? branches(s.branches) : s.next.trim();
    const common = { label: s.label.trim(), stage: s.stage.trim(), icon: s.icon.trim() };
    let step: Record<string, unknown>;
    if (s.kind === "ask") {
      step = s.questionnaire.trim()
        ? { ...common, ask: s.ask.trim(), questionnaire: s.questionnaire.trim() }
        : { ...common, ask: s.ask.trim() || "Please answer these questions.", fields: parse(id, s.fieldsYaml, "list") ?? [] };
      step = { ...step, submitLabel: s.submitLabel.trim(), next: then };
    } else if (s.kind === "service") {
      step = { ...common, service: s.service.trim(), with: parse(id, s.withYaml, "mapping"), onError: s.onError === "continue" ? "continue" : undefined, next: then };
    } else if (s.kind === "decide") {
      step = { ...common, decide: branches(s.branches) };
    } else {
      const ok = s.resultOk.trim();
      step = { ...common, final: true, result: compact({ title: s.resultTitle.trim(), text: s.resultText, ok: ok === "true" ? true : ok === "false" ? false : ok }) };
    }
    // An ask step keeps `fields: []` so the compiler says what's missing; other empties go.
    steps[id] = Object.fromEntries(Object.entries(step).filter(([k, v]) => k === "fields" || !blank(v)));
  }
  if (problems.length) return { ok: false, problems };
  const roles = compact({ initiate: f.initiate, complete: f.complete });
  return {
    ok: true,
    doc: compact({
      kind: "journey",
      id: f.id.trim(),
      version: f.version || 1,
      title: f.title.trim(),
      summary: f.summary.trim(),
      icon: f.icon.trim(),
      category: f.category.trim(),
      roles: Object.keys(roles).length ? roles : undefined,
      start: f.start.trim(),
      steps,
    }),
  };
}

/** A starting point for a questionnaire (written as YAML; there is no form). */
export const questionnaireTemplate = (id = "new-questionnaire") => `kind: questionnaire
id: ${id}
version: 1
title: New questionnaire
summary: What these questions are for.
sections:
  - id: first
    title: First page
    fields:
      - { id: name, type: text, label: Your name, required: true }
      - id: choice
        type: select
        label: Pick one
        options:
          - { value: a, label: Option A }
          - { value: b, label: Option B }
`;

// ---- a whole service, nested (nested.ts): the Service Catalogue's designer --------------------

/** One journey of a nested service: its screens are steps (StepForm), questions as YAML. */
export type JourneyDesign = {
  id: string;
  title: string;
  summary: string;
  icon: string;
  initiate: string[];
  complete: string[];
  /** The first screen; empty: the first in the list. */
  start: string;
  screens: StepForm[];
};

export type ServiceDesign = {
  id: string;
  title: string;
  summary: string;
  icon: string;
  order: number | null;
  /** The roles this service defines (the designer's side panel). */
  roles: Role[];
  journeys: JourneyDesign[];
};

export const newScreen = (id = "", kind: StepKind = "ask"): StepForm => ({ ...newStep(id, kind), then: "step", next: "" });
export const newJourneyDesign = (id = "new-journey", title = "New journey"): JourneyDesign => ({
  id,
  title,
  summary: "",
  icon: "",
  // No starters: anyone at the kiosk. Adding a role as a starter restricts it to that role.
  initiate: [],
  complete: [],
  start: "",
  screens: [
    { ...newScreen("questions", "ask"), label: "Questions", fieldsYaml: "- { id: name, type: text, label: Your name, required: true }" },
    { ...newScreen("done", "final"), label: "Done", resultTitle: "Thank you" },
  ],
});
export const newServiceDesign = (id = "new-service"): ServiceDesign => ({ id, title: "New service", summary: "", icon: "", order: null, roles: [], journeys: [newJourneyDesign()] });

/** A nested service document as a design; screens that combine kinds are named in `unsupported`. */
export function designFromDoc(doc: Record<string, unknown>): { design: ServiceDesign; unsupported: string[] } {
  const unsupported: string[] = [];
  const roles = (Array.isArray(doc.roles) ? doc.roles : []).map((r: unknown) => {
    const o = (typeof r === "string" ? { id: r } : (r ?? {})) as Record<string, unknown>;
    return { id: str(o.id), label: str(o.label) || str(o.id), ...(o.description ? { description: str(o.description) } : {}) };
  });
  const journeys = (Array.isArray(doc.journeys) ? doc.journeys : []).map((raw: unknown): JourneyDesign => {
    const j = (raw ?? {}) as Record<string, unknown>;
    const jr = (j.roles ?? {}) as JourneyRoles;
    const screens = (Array.isArray(j.screens) ? j.screens : []).map((sraw: unknown): StepForm => {
      const s = (sraw ?? {}) as Record<string, unknown>;
      const kinds = (["ask", "service", "decide", "final"] as const).filter((k) =>
        k === "ask" ? s.questions !== undefined || s.ask !== undefined : k === "final" ? s.result !== undefined : s[k] !== undefined,
      );
      if (kinds.length > 1) unsupported.push(`${str(j.id)}/${str(s.id)}`);
      const result = (s.result ?? {}) as Record<string, unknown>;
      const next = s.next;
      return {
        ...newScreen(str(s.id), kinds[0] ?? "ask"),
        label: str(s.title),
        stage: str(s.stage),
        icon: str(s.icon),
        ask: s.ask !== undefined && s.ask !== s.title ? str(s.ask) : "",
        fieldsYaml: s.questions === undefined ? "" : yamlOf(s.questions),
        submitLabel: str(s.submitLabel),
        service: str(s.service),
        withYaml: yamlOf(s.with),
        onError: s.onError === "continue" ? "continue" : "fail",
        then: Array.isArray(next) ? "branches" : "step",
        next: typeof next === "string" ? next : "",
        branches: (Array.isArray(s.decide) ? s.decide : Array.isArray(next) ? next : []).map((b: Branch) => ({ ...(b?.if !== undefined ? { if: str(b.if) } : {}), to: str(b?.to) })),
        resultTitle: str(result.title),
        resultText: str(result.text),
        resultOk: result.ok === undefined ? "" : str(result.ok),
      };
    });
    return { id: str(j.id), title: str(j.title), summary: str(j.summary), icon: str(j.icon), initiate: strs(jr.initiate), complete: strs(jr.complete), start: str(j.start), screens };
  });
  return {
    design: { id: str(doc.id), title: str(doc.title), summary: str(doc.summary), icon: str(doc.icon), order: typeof doc.order === "number" ? doc.order : null, roles, journeys },
    unsupported,
  };
}

/** The design as a nested service document, or the problems that stop it (questions or `with` that aren't YAML). */
export function designToDoc(d: ServiceDesign): { ok: true; doc: Record<string, unknown> } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  const parse = (at: string, text: string, want: "list" | "mapping") => {
    if (!text.trim()) return undefined;
    try {
      const v = load(text);
      if (want === "list" ? !Array.isArray(v) : !v || typeof v !== "object" || Array.isArray(v)) problems.push(`${at}: ${want === "list" ? "questions must be a YAML list" : "with must be a YAML mapping"}`);
      return v;
    } catch (e) {
      problems.push(`${at}: ${(e as Error).message.split("\n")[0]}`);
      return undefined;
    }
  };
  const branches = (list: Branch[]) => list.map((b, i) => (i < list.length - 1 ? { if: (b.if ?? "").trim(), to: b.to.trim() } : { to: b.to.trim() }));
  const journeys = d.journeys.map((j) => {
    const screens = j.screens.map((s) => {
      const at = `journey '${j.id}' screen '${s.id}'`;
      const then = s.then === "branches" ? branches(s.branches) : s.next.trim() || undefined;
      const base = { id: s.id.trim(), title: s.label.trim(), stage: s.stage.trim(), icon: s.icon.trim() };
      let screen: Record<string, unknown>;
      if (s.kind === "ask") screen = { ...base, ask: s.ask.trim(), questions: parse(at, s.fieldsYaml, "list") ?? [], submitLabel: s.submitLabel.trim(), next: then };
      else if (s.kind === "service") screen = { ...base, service: s.service.trim(), with: parse(at, s.withYaml, "mapping"), onError: s.onError === "continue" ? "continue" : undefined, next: then };
      else if (s.kind === "decide") screen = { ...base, decide: branches(s.branches) };
      else {
        const ok = s.resultOk.trim();
        screen = { ...base, result: compact({ title: s.resultTitle.trim(), text: s.resultText, ok: ok === "true" ? true : ok === "false" ? false : ok }) };
      }
      return Object.fromEntries(Object.entries(screen).filter(([k, v]) => k === "questions" || !blank(v)));
    });
    const roles = compact({ initiate: j.initiate, complete: j.complete });
    return compact({ id: j.id.trim(), title: j.title.trim(), summary: j.summary.trim(), icon: j.icon.trim(), roles: Object.keys(roles).length ? roles : undefined, start: j.start.trim(), screens });
  });
  if (problems.length) return { ok: false, problems };
  return {
    ok: true,
    doc: compact({
      kind: "service",
      id: d.id.trim(),
      title: d.title.trim(),
      summary: d.summary.trim(),
      icon: d.icon.trim(),
      order: d.order ?? undefined,
      roles: d.roles.map((r) => compact({ id: r.id, label: r.label, description: r.description })),
      journeys,
    }),
  };
}

/** "Front desk" → "front-desk": a role or screen id from a name. */
export const idFromName = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[^a-z]+|-+$/g, "")
    .slice(0, 32);

/** A nested service to start from. */
export const serviceTemplate = (id = "new-service") => {
  const r = designToDoc(newServiceDesign(id));
  return r.ok ? toYaml(r.doc) : "";
};
