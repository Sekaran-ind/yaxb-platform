// The kiosk's built-in content, compiled and checked once: skills, journeys, services, screens.
// Authored in packages/yaxb-core/content/ (YAML and SKILL.md), bundled by tools/build-content.mjs.
import { load } from "js-yaml";
import contentJson from "../data/content.json" with { type: "json" };
import { compileJourney, type Journey } from "../journeys/index.js";
import { compileScreens, type ScreenConfig } from "../screens/index.js";
import { compileService, type Service } from "../services/index.js";

/** Handlers a surface may register for journey `service:` steps. Journeys may only use these. */
export const JOURNEY_SERVICES = [
  "agent.ask",
  "offline.summarize",
  "offline.translate",
  "offline.answer",
  "offline.classify",
  "notebook.add",
  "notebook.remember",
  "speech.speak",
] as const;

/** Screen components the kiosk renders. */
export const SCREEN_COMPONENTS = ["transcript", "services", "notebook", "account", "patient-info", "records", "scorecard", "translate", "sandbox"] as const;

export type Skill = { name: string; description: string; markdown: string };

const raw = contentJson as { skills: { name: string; markdown: string }[]; journeys: string[]; services: string[]; screens: string };

/** name and description from a SKILL.md's YAML frontmatter. */
export function skillMeta(markdown: string): { name: string; description: string } | null {
  const m = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const fm = load(m[1]!) as { name?: unknown; description?: unknown } | null;
  if (typeof fm?.name !== "string" || typeof fm.description !== "string") return null;
  return { name: fm.name, description: fm.description };
}

function build() {
  const problems: string[] = [];

  const skills: Skill[] = [];
  for (const s of raw.skills) {
    const meta = skillMeta(s.markdown);
    if (!meta) problems.push(`skill ${s.name}: SKILL.md needs name and description frontmatter`);
    else if (meta.name !== s.name) problems.push(`skill ${s.name}: frontmatter name is "${meta.name}"`);
    else if (!/^[a-z][a-z0-9-]{0,63}$/.test(meta.name)) problems.push(`skill ${s.name}: names are lower-case words joined by '-'`);
    else skills.push({ ...meta, markdown: s.markdown });
  }

  const journeys: Journey[] = [];
  for (const src of raw.journeys) {
    const r = compileJourney(src, { services: JOURNEY_SERVICES });
    if (r.ok) journeys.push(r.journey);
    else problems.push(...r.problems.map((p) => `journey: ${p}`));
  }

  const screensResult = compileScreens(raw.screens, { components: SCREEN_COMPONENTS });
  if (!screensResult.ok) problems.push(...screensResult.problems.map((p) => `screens: ${p}`));
  const screens: ScreenConfig = screensResult.ok ? screensResult.config : { kind: "screens", id: "kiosk", screens: [] };

  const services: Service[] = [];
  for (const src of raw.services) {
    const r = compileService(src, { journeys: journeys.map((j) => j.id), screens: screens.screens.map((s) => s.id) });
    if (r.ok) services.push(r.service);
    else problems.push(...r.problems.map((p) => `service: ${p}`));
  }

  return { skills, journeys, services, screens, problems };
}

/** The compiled content. `problems` is empty for shippable content (a test checks it). */
export const kioskContent = build();

export const journeyById = (id: string) => kioskContent.journeys.find((j) => j.id === id);
