// A service with its journeys inside, and screens inside each journey: the way people design a
// service in the Service Catalogue. It expands into the flat documents the engine runs (a service
// whose items open its journeys, and journeys whose steps are the screens), so everything else
// (running, previews, summaries, slot filling) works unchanged.
//
//   kind: service
//   id: clinic
//   title: Clinic visit
//   roles:                                   the roles that deliver it, defined here
//     - { id: receptionist, label: Receptionist }
//     - { id: nurse, label: Nurse, description: Ward nurse }
//   journeys:
//     - id: check-in
//       title: Check in
//       roles: { initiate: [visitor], complete: [nurse] }
//       start: about-you                      optional: the first screen
//       screens:
//         - id: about-you
//           title: About you                  the screen's name (its line in the progress list)
//           ask: Tell us who you are.         optional prompt (the title when absent)
//           questions:                        the fields, as in a questionnaire
//             - { id: name, type: text, label: Your name, required: true }
//         - id: triage
//           role: nurse                        who answers it (absent: whoever started it); the
//           questions: [...]                   journey waits for a nurse, a case in their queue
//         - id: summarise
//           service: agent.ask                a service screen; `with:` is its input
//           with: { message: "…" }
//         - id: route
//           decide: [{ if: "…", to: done }, { to: about-you }]
//         - id: done
//           result: { title: "Thank you {{answers.about-you.name}}" }   ends the journey
//
// Each screen goes to the next one in the list unless it says `next:`. A journey whose last screen
// doesn't end it gets an ending ("Thank you"). Journeys may name the service's roles, the built-in
// ones (administrator, moderator, reviewer) and `visitor` (anyone at the kiosk).
import { DEFAULT_ROLES, ROLE_ID, VISITOR_ROLE, type Role } from "./roles.js";

export const isNestedService = (doc: unknown): doc is Record<string, unknown> =>
  Boolean(doc && typeof doc === "object" && !Array.isArray(doc) && (doc as Record<string, unknown>).kind === "service" && (doc as Record<string, unknown>).journeys !== undefined);

const SERVICE_KEYS = new Set(["kind", "id", "version", "title", "summary", "icon", "order", "layouts", "hidden", "roles", "journeys"]);
const JOURNEY_KEYS = new Set(["id", "title", "summary", "icon", "category", "version", "roles", "start", "screens"]);
const SCREEN_KEYS = new Set(["id", "title", "ask", "questions", "submitLabel", "service", "with", "onError", "decide", "next", "result", "stage", "icon", "role"]);
const ID = /^[a-z][a-z0-9-]{0,63}$/;

export type Expanded = {
  /** The flat service document (items open its journeys). */
  service: Record<string, unknown>;
  /** One flat journey document per journey (steps are the screens). */
  journeys: Record<string, unknown>[];
  /** The roles the service defines. */
  roles: Role[];
  /** Problems with the nesting itself (the flat documents are checked when they compile). */
  problems: string[];
};

/** The roles a nested service defines: `{ id, label, description }` or plain ids. */
export function serviceRoles(value: unknown, problems: string[] = []): Role[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    problems.push("roles must be a list");
    return [];
  }
  const out: Role[] = [];
  for (const [i, r] of value.entries()) {
    const role = typeof r === "string" ? { id: r } : ((r ?? {}) as Record<string, unknown>);
    const id = role.id;
    if (typeof id !== "string" || !ROLE_ID.test(id)) {
      problems.push(`role ${i + 1}: id is lower-case words joined by '-'`);
      continue;
    }
    if (id === VISITOR_ROLE) {
      problems.push(`role '${id}' is built in (anyone at the kiosk): don't define it`);
      continue;
    }
    if (out.some((x) => x.id === id)) problems.push(`role '${id}' is listed twice`);
    const extra = Object.keys(role).filter((k) => k !== "id" && k !== "label" && k !== "description");
    if (extra.length) problems.push(`role '${id}': unknown key '${extra[0]}'`);
    out.push({
      id,
      label: typeof role.label === "string" && role.label.trim() ? role.label.trim() : (DEFAULT_ROLES.find((d) => d.id === id)?.label ?? id),
      ...(typeof role.description === "string" && role.description.trim() ? { description: role.description.trim() } : {}),
    });
  }
  return out;
}

export function expandService(doc: Record<string, unknown>): Expanded {
  const problems: string[] = [];
  for (const k of Object.keys(doc)) if (!SERVICE_KEYS.has(k)) problems.push(k === "items" ? "a service with journeys lists no items: each journey is one" : `unknown key '${k}'`);
  const roles = serviceRoles(doc.roles, problems);
  const known = new Set<string>([VISITOR_ROLE, ...DEFAULT_ROLES.map((r) => r.id), ...roles.map((r) => r.id)]);

  const list = Array.isArray(doc.journeys) ? (doc.journeys as unknown[]) : [];
  if (!Array.isArray(doc.journeys)) problems.push("journeys must be a list");
  else if (!list.length) problems.push("add at least one journey");

  const journeyIds = new Set<string>();
  const journeys: Record<string, unknown>[] = [];
  for (const [ji, raw] of list.entries()) {
    const j = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
    const jid = typeof j.id === "string" ? j.id : "";
    const at = jid ? `journey '${jid}'` : `journey ${ji + 1}`;
    if (!ID.test(jid)) {
      problems.push(`${at}: id is lower-case words joined by '-'`);
      continue;
    }
    if (journeyIds.has(jid)) problems.push(`${at} is listed twice`);
    journeyIds.add(jid);
    for (const k of Object.keys(j)) if (!JOURNEY_KEYS.has(k)) problems.push(`${at}: unknown key '${k}'`);

    // Roles a journey names must be the service's (or built in).
    const jr = (j.roles ?? {}) as Record<string, unknown>;
    for (const which of ["initiate", "complete"] as const) {
      const ids = Array.isArray(jr[which]) ? (jr[which] as unknown[]) : [];
      for (const r of ids) if (typeof r === "string" && ROLE_ID.test(r) && !known.has(r)) problems.push(`${at}: role '${r}' isn't one of this service's roles: add it to the roles`);
    }

    const screens = Array.isArray(j.screens) ? (j.screens as unknown[]) : [];
    if (!Array.isArray(j.screens) || !screens.length) {
      problems.push(`${at}: add at least one screen`);
      continue;
    }
    const ids = screens.map((s) => (s && typeof s === "object" ? (s as Record<string, unknown>).id : undefined));
    const steps: Record<string, Record<string, unknown>> = {};
    let ending: string | null = null;
    const endId = () => {
      if (!ending) {
        let n = 1;
        ending = "end";
        while (ids.includes(ending)) ending = `end-${++n}`;
      }
      return ending;
    };
    for (const [si, sraw] of screens.entries()) {
      const s = (sraw && typeof sraw === "object" && !Array.isArray(sraw) ? sraw : {}) as Record<string, unknown>;
      const sid = typeof s.id === "string" ? s.id : "";
      const sat = `${at} screen ${sid ? `'${sid}'` : si + 1}`;
      if (!ID.test(sid)) {
        problems.push(`${sat}: id is lower-case words joined by '-'`);
        continue;
      }
      if (sid in steps) problems.push(`${sat} is listed twice`);
      for (const k of Object.keys(s)) if (!SCREEN_KEYS.has(k)) problems.push(`${sat}: unknown key '${k}'`);
      const ends = s.result !== undefined;
      const following = typeof ids[si + 1] === "string" ? (ids[si + 1] as string) : null;
      const step: Record<string, unknown> = {};
      if (s.title !== undefined) step.label = s.title;
      for (const k of ["stage", "icon"] as const) if (s[k] !== undefined) step[k] = s[k];
      if (ends) {
        step.final = true;
        step.result = s.result;
      } else {
        if (s.questions !== undefined || s.ask !== undefined) {
          step.ask = s.ask ?? s.title ?? "Please answer these questions.";
          step.fields = s.questions ?? [];
          if (s.submitLabel !== undefined) step.submitLabel = s.submitLabel;
        }
        if (s.role !== undefined) {
          step.role = s.role;
          if (typeof s.role === "string" && ROLE_ID.test(s.role) && s.role !== VISITOR_ROLE && !known.has(s.role)) problems.push(`${sat}: role '${s.role}' isn't one of this service's roles: add it to the roles`);
        }
        if (s.service !== undefined) {
          step.service = s.service;
          if (s.with !== undefined) step.with = s.with;
          if (s.onError !== undefined) step.onError = s.onError;
        }
        if (s.decide !== undefined) step.decide = s.decide;
        else step.next = s.next ?? following ?? endId();
        if (step.ask === undefined && step.service === undefined && step.decide === undefined) problems.push(`${sat}: give it questions, a service, a decision or a result`);
      }
      steps[sid] = step;
    }
    if (ending) steps[ending] = { label: "Done", final: true, result: { title: "Thank you" } };
    journeys.push({
      kind: "journey",
      id: jid,
      version: j.version ?? 1,
      title: j.title ?? jid,
      ...(j.summary !== undefined ? { summary: j.summary } : {}),
      ...(j.icon !== undefined ? { icon: j.icon } : {}),
      ...(j.category !== undefined ? { category: j.category } : {}),
      ...(j.roles !== undefined ? { roles: j.roles } : {}),
      start: j.start ?? ids.find((x) => typeof x === "string") ?? "",
      steps,
    });
  }

  const service: Record<string, unknown> = {
    kind: "service",
    id: doc.id,
    ...(doc.version !== undefined ? { version: doc.version } : {}),
    title: doc.title,
    ...(doc.summary !== undefined ? { summary: doc.summary } : {}),
    ...(doc.icon !== undefined ? { icon: doc.icon } : {}),
    ...(doc.order !== undefined ? { order: doc.order } : {}),
    ...(doc.layouts !== undefined ? { layouts: doc.layouts } : {}),
    ...(doc.hidden !== undefined ? { hidden: doc.hidden } : {}),
    ...(roles.length ? { roles: roles.map((r) => r.id) } : {}),
    items: journeys.map((j) => ({
      key: j.id,
      label: j.title,
      ...(j.summary !== undefined ? { summary: j.summary } : {}),
      ...(j.icon !== undefined ? { icon: j.icon } : {}),
      journey: j.id,
    })),
  };
  return { service, journeys, roles, problems };
}
