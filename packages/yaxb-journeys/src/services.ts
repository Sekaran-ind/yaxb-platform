// Services: what a visitor can do, grouped by purpose. Same model as clinux-core's services
// (SPEC-32 §4): a service lists items, and each item opens a screen or starts a journey. One model
// feeds the kiosk's Services screen and the agent's "what can I do here" answer.
//
//   kind: service
//   id: notebook
//   title: Notebook
//   summary: Work with your own documents
//   icon: notebook
//   order: 10
//   layouts: [pod, full]                  where it's offered; absent means every layout
//   roles: [receptionist, nurse]      the roles that deliver it (roles.ts)
//   items:
//     - { key: ask, label: Ask about your sources, icon: message-circle, screen: transcript }
//     - { key: summarise, label: Summarise a source, icon: file-text, journey: summarise-source }
import { load } from "js-yaml";
import { roleListProblems } from "./roles.js";
import { LAYOUTS, type Layout } from "./screens.js";

/** The staff's sections, which a service item may open inside Services (SET-16). */
export const STAFF_SECTIONS = ["quality", "review", "moderation", "library", "team", "profile", "admin"] as const;
export type StaffSection = (typeof STAFF_SECTIONS)[number];

export type ServiceItem = { key: string; label: string; summary?: string; icon?: string; screen?: string; journey?: string; staff?: StaffSection; layouts?: Layout[] };
export type Service = {
  kind: "service";
  id: string;
  title: string;
  summary?: string;
  icon?: string;
  order: number;
  layouts?: Layout[];
  hidden?: boolean;
  /** The roles that take part in delivering the service (roles.ts). */
  roles?: string[];
  items: ServiceItem[];
};

const SERVICE_KEYS = new Set(["kind", "id", "version", "title", "summary", "icon", "order", "layouts", "hidden", "roles", "items"]);
const ITEM_KEYS = new Set(["key", "label", "summary", "icon", "screen", "journey", "staff", "layouts"]);

export function serviceProblems(doc: unknown, { journeys, screens, roles }: { journeys?: readonly string[]; screens?: readonly string[]; roles?: readonly string[] } = {}): string[] {
  const problems: string[] = [];
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return ["a service is a YAML mapping"];
  const s = doc as Record<string, unknown>;
  if (s.kind !== "service") problems.push("kind must be 'service'");
  for (const k of ["id", "title"]) if (!s[k]) problems.push(`${k} is required`);
  for (const k of Object.keys(s)) if (!SERVICE_KEYS.has(k)) problems.push(`unknown key '${k}'`);
  const layoutProblem = (at: string, v: unknown) => {
    if (v !== undefined && (!Array.isArray(v) || v.some((l) => !LAYOUTS.includes(l as Layout)))) problems.push(`${at}: layouts are ${LAYOUTS.join(", ")}`);
  };
  layoutProblem("service", s.layouts);
  problems.push(...roleListProblems("roles", s.roles, roles));
  if (s.hidden) return problems;
  if (!Array.isArray(s.items) || !s.items.length) return [...problems, "items is required"];
  const seen = new Set<string>();
  for (const raw of s.items as Record<string, unknown>[]) {
    const at = `item '${String(raw?.key ?? "?")}'`;
    if (!raw?.key) {
      problems.push("every item has a key");
      continue;
    }
    if (seen.has(String(raw.key))) problems.push(`${at} is listed twice`);
    seen.add(String(raw.key));
    if (!raw.label) problems.push(`${at} has no label`);
    const opens = [raw.screen, raw.journey, raw.staff].filter(Boolean).length;
    if (opens === 0) problems.push(`${at} needs a screen, a journey or a staff section`);
    if (opens > 1) problems.push(`${at} opens one thing: a screen, a journey or a staff section`);
    if (raw.staff && !(STAFF_SECTIONS as readonly string[]).includes(String(raw.staff))) problems.push(`${at}: no staff section '${String(raw.staff)}'`);
    for (const k of Object.keys(raw)) if (!ITEM_KEYS.has(k)) problems.push(`${at}: unknown key '${k}'`);
    if (raw.journey && journeys && !journeys.includes(String(raw.journey))) problems.push(`${at}: no journey '${String(raw.journey)}'`);
    if (raw.screen && screens && !screens.includes(String(raw.screen))) problems.push(`${at}: no screen '${String(raw.screen)}'`);
    layoutProblem(at, raw.layouts);
  }
  return problems;
}

export function compileService(source: string | object, options: Parameters<typeof serviceProblems>[1] = {}) {
  let doc: unknown;
  try {
    doc = typeof source === "string" ? load(source) : source;
  } catch (e) {
    return { ok: false as const, problems: [`YAML: ${(e as Error).message}`] };
  }
  const problems = serviceProblems(doc, options);
  if (problems.length) return { ok: false as const, problems };
  return { ok: true as const, service: { order: 100, ...(doc as object) } as Service };
}

/** A deployment's services over the built-in ones: same id replaces, `hidden: true` removes, new ids add. */
export function overlayServices(base: Service[] = [], overlay: Service[] = []): Service[] {
  const byId = new Map(base.map((s) => [s.id, s]));
  for (const s of overlay) byId.set(s.id, s);
  return [...byId.values()].filter((s) => !s.hidden);
}

const offered = (layouts: Layout[] | undefined, layout: Layout | undefined) => !layouts?.length || !layout || layouts.includes(layout);

/** The services and items offered in a layout, in order. Items whose journey is unknown are dropped. */
export function servicesFor(services: Service[], { layout, journeys }: { layout?: Layout; journeys?: readonly string[] } = {}): Service[] {
  return [...services]
    .filter((s) => !s.hidden && offered(s.layouts, layout))
    .sort((a, b) => a.order - b.order)
    .map((s) => ({
      ...s,
      items: s.items.filter((i) => offered(i.layouts, layout) && (!i.journey || !journeys || journeys.includes(i.journey))),
    }))
    .filter((s) => s.items.length > 0);
}

/** One line per item, for the agent's prompt: what the visitor can do here. */
export function offeringsText(services: Service[]): string {
  return services
    .map((s) => `${s.title}: ${s.items.map((i) => i.label).join("; ")}`)
    .join("\n");
}
