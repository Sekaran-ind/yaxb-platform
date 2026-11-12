// Screens and layouts: which panes the kiosk shows, and how. No UI framework here; the web
// surface renders these answers (the same split as clinux-core's cubo/view.js and
// adaptiveSectionNav.js).
//
// Three kiosk layouts, chosen from the space available unless the visitor picks one:
//   mini   a compact card: the voice orb and one screen at a time, sections in a menu
//   pod    the "pod player": the console as a strip on top, one screen below
//   full   the full kiosk: the console column on the left, the screens on the right
//
// Navigation chrome per layout comes from the adaptive nav (ported from clinux-core's
// AdaptiveSectionNav): tabs, sidebar, accordion, or panes (every screen at once), collapsing to a
// single screen and a section menu below the compact breakpoint.
//
//   kind: screens
//   id: kiosk
//   screens:
//     - { id: transcript, label: Transcript, icon: message-square, component: transcript, layouts: [mini, pod, full] }
import { load } from "js-yaml";

export const LAYOUTS = ["mini", "pod", "full"] as const;
export type Layout = (typeof LAYOUTS)[number];
export type LayoutChoice = Layout | "auto";

export const NAV_MODES = ["tabs", "sidebar", "accordion", "panes"] as const;
export type NavMode = (typeof NAV_MODES)[number];
/** Modes a visitor may switch between; `panes` is a screen config's fixed choice. */
export const SWITCHABLE_NAV_MODES: readonly NavMode[] = ["tabs", "sidebar", "accordion"];

/** Below this a nav shows one screen and a section menu, whatever its mode. */
export const COMPACT_BREAKPOINT = 768;
/** Auto layout thresholds, by the kiosk container's width. */
export const LAYOUT_BREAKPOINTS = { pod: 640, full: 1100 } as const;

export type Screen = {
  id: string;
  label: string;
  icon?: string;
  component: string;
  layouts?: Layout[];
  hidden?: boolean;
  order?: number;
};

export type ScreenConfig = {
  kind: "screens";
  id: string;
  defaultScreen?: string;
  /** Nav chrome per layout. */
  nav?: Partial<Record<Layout, NavMode>>;
  screens: Screen[];
};

const CONFIG_KEYS = new Set(["kind", "id", "defaultScreen", "nav", "screens"]);
const SCREEN_KEYS = new Set(["id", "label", "icon", "component", "layouts", "hidden", "order"]);

export function screenProblems(doc: unknown, { components }: { components?: readonly string[] } = {}): string[] {
  const problems: string[] = [];
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return ["a screen config is a YAML mapping"];
  const c = doc as Record<string, unknown>;
  if (c.kind !== "screens") problems.push("kind must be 'screens'");
  if (!c.id) problems.push("id is required");
  for (const k of Object.keys(c)) if (!CONFIG_KEYS.has(k)) problems.push(`unknown key '${k}'`);
  if (c.nav !== undefined) {
    for (const [layout, mode] of Object.entries(c.nav as Record<string, unknown>)) {
      if (!LAYOUTS.includes(layout as Layout)) problems.push(`nav: no layout '${layout}'`);
      if (!NAV_MODES.includes(mode as NavMode)) problems.push(`nav.${layout}: modes are ${NAV_MODES.join(", ")}`);
    }
  }
  if (!Array.isArray(c.screens) || !c.screens.length) return [...problems, "screens is required"];
  const seen = new Set<string>();
  for (const raw of c.screens as Record<string, unknown>[]) {
    const at = `screen '${String(raw?.id ?? "?")}'`;
    if (!raw?.id) {
      problems.push("every screen has an id");
      continue;
    }
    if (seen.has(String(raw.id))) problems.push(`${at} is listed twice`);
    seen.add(String(raw.id));
    if (!raw.label) problems.push(`${at} has no label`);
    if (!raw.component) problems.push(`${at} has no component`);
    else if (components && !components.includes(String(raw.component))) problems.push(`${at}: no component '${String(raw.component)}'`);
    if (raw.layouts !== undefined && (!Array.isArray(raw.layouts) || raw.layouts.some((l) => !LAYOUTS.includes(l as Layout))))
      problems.push(`${at}: layouts are ${LAYOUTS.join(", ")}`);
    for (const k of Object.keys(raw)) if (!SCREEN_KEYS.has(k)) problems.push(`${at}: unknown key '${k}'`);
  }
  if (c.defaultScreen && !seen.has(String(c.defaultScreen))) problems.push(`defaultScreen: no screen '${String(c.defaultScreen)}'`);
  return problems;
}

export function compileScreens(source: string | object, options: Parameters<typeof screenProblems>[1] = {}) {
  let doc: unknown;
  try {
    doc = typeof source === "string" ? load(source) : source;
  } catch (e) {
    return { ok: false as const, problems: [`YAML: ${(e as Error).message}`] };
  }
  const problems = screenProblems(doc, options);
  if (problems.length) return { ok: false as const, problems };
  return { ok: true as const, config: doc as ScreenConfig };
}

/** The layout to render: the visitor's choice, or one picked from the width. */
export function resolveLayout(width: number, choice: LayoutChoice = "auto"): Layout {
  if (choice !== "auto") return choice;
  if (width >= LAYOUT_BREAKPOINTS.full) return "full";
  if (width >= LAYOUT_BREAKPOINTS.pod) return "pod";
  return "mini";
}

/** Screens shown in a layout, in order. */
export function screensFor(config: ScreenConfig, layout: Layout): Screen[] {
  return config.screens
    .filter((s) => !s.hidden && (!s.layouts?.length || s.layouts.includes(layout)))
    .map((s, i) => ({ ...s, order: s.order ?? i }))
    .sort((a, b) => a.order! - b.order!);
}

// ---- adaptive nav (from clinux-core's adaptiveSectionNav.js) -------------------------------------

export const isCompact = (width: number, breakpoint = COMPACT_BREAKPOINT) => width < breakpoint;

/** `panes` from the config always wins; otherwise a remembered choice, then the config's hint, then tabs. */
export function resolveNavMode({ configMode, storedMode }: { configMode?: NavMode; storedMode?: string | null }): NavMode {
  if (configMode === "panes") return "panes";
  if (storedMode && (SWITCHABLE_NAV_MODES as readonly string[]).includes(storedMode)) return storedMode as NavMode;
  if (configMode && (SWITCHABLE_NAV_MODES as readonly string[]).includes(configMode)) return configMode;
  return "tabs";
}

/** Keep the requested screen while it still exists; otherwise the first one. Never an id that names nothing. */
export function resolveActiveScreen(screens: { id: string }[], requested?: string | null): string | null {
  if (requested && screens.some((s) => s.id === requested)) return requested;
  return screens[0]?.id ?? null;
}
