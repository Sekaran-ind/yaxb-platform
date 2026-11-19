// The organisation design (docs/specs/13-foundations.md ORG-1..5, ORG-8..9): who is where in a
// business, a household or a community, published through the Service Catalogue like a service.
//
//   kind: organisation
//   id: sri-ram-hardware
//   title: Sri Ram Hardware
//   type: business                        business | household | community
//   template: hardware-store              optional: the template it started from (templates.ts)
//   sites:
//     - { id: main, title: Main shop, address: "12 Car Street" }
//   units:
//     - id: office
//       title: Owner's office
//       lead: owner                       the unit's manager: one of its roles
//       roles: [{ id: owner, label: Owner }]
//     - id: counter
//       title: Counter
//       reports_to: office                the unit above it
//       lead: counter-head
//       roles: [{ id: counter-head, label: Counter head }, cashier]
//       services: [orders]                the catalogue services this unit runs
//       sites: [main]
//
// A role belongs to one unit, so a person's roles say which unit they are in. A journey screen with
// `role: manager-of-requester` goes to the lead of the requester's unit, or, when the requester is
// that lead, to the lead of the unit above (ORG-3): `resolveForRequester` rewrites the journey for one
// requester before a case keeps it, so the rest of the engine sees an ordinary role.
//
// In a household nobody reports to anyone (ORG-8): guardianship, set per child, is the only line,
// and only for children. No HR records, salaries or grades belong here (ORG-9).
import { DEFAULT_ROLES, MANAGER_OF_REQUESTER, ROLE_ID, VISITOR_ROLE, type Role } from "./roles.js";
import type { Journey } from "./journeys.js";

export const ORGANISATION_TYPES = ["business", "household", "community"] as const;
export type OrganisationType = (typeof ORGANISATION_TYPES)[number];

export type Site = { id: string; title: string; address?: string };
export type Unit = { id: string; title: string; lead: string | null; reports_to: string | null; roles: Role[]; services: string[]; sites: string[] };
export type Organisation = { id: string; title: string; type: OrganisationType; template: string | null; sites: Site[]; units: Unit[] };

const ID = /^[a-z][a-z0-9-]{0,63}$/;
const ORG_KEYS = new Set(["kind", "id", "title", "summary", "type", "template", "sites", "units", "version"]);
const UNIT_KEYS = new Set(["id", "title", "lead", "reports_to", "roles", "services", "sites"]);
const SITE_KEYS = new Set(["id", "title", "address"]);
/** Keys that would make it an HR record (ORG-9): refused with a reason, wherever they appear. */
const HR_KEYS = /^(salary|salaries|pay|wage|wages|ctc|compensation|grade|grades|band|level|appraisal|rating|bonus|increment|payroll|employee-id|employee_id)$/i;

export const isOrganisation = (doc: unknown): doc is Record<string, unknown> => Boolean(doc && typeof doc === "object" && !Array.isArray(doc) && (doc as Record<string, unknown>).kind === "organisation");

function keyProblems(at: string, o: Record<string, unknown>, allowed: Set<string>, problems: string[]) {
  for (const k of Object.keys(o)) {
    if (HR_KEYS.test(k)) problems.push(`${at}: '${k}' doesn't belong in the organisation: no HR records, salaries or grades here`);
    else if (!allowed.has(k)) problems.push(`${at}: unknown key '${k}'`);
  }
}

const idList = (at: string, v: unknown, what: string, problems: string[]): string[] => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
    problems.push(`${at}: ${what} is a list of ids`);
    return [];
  }
  return [...new Set(v as string[])];
};

export type CompiledOrganisation = { ok: true; organisation: Organisation; problems: string[] } | { ok: false; problems: string[] };

/** Check and normalise an organisation document. */
export function compileOrganisation(doc: unknown): CompiledOrganisation {
  const problems: string[] = [];
  if (!isOrganisation(doc)) return { ok: false, problems: ["The document needs kind: organisation."] };
  keyProblems("organisation", doc, ORG_KEYS, problems);
  const id = typeof doc.id === "string" ? doc.id : "";
  if (!ID.test(id)) problems.push("The organisation needs an id: lower-case words joined by '-'.");
  const title = typeof doc.title === "string" && doc.title.trim() ? doc.title.trim() : id;
  const type = (doc.type ?? "business") as OrganisationType;
  if (!ORGANISATION_TYPES.includes(type)) problems.push(`type is one of ${ORGANISATION_TYPES.join(", ")}`);
  const household = type === "household";

  const sites: Site[] = [];
  if (doc.sites !== undefined && !Array.isArray(doc.sites)) problems.push("sites must be a list");
  for (const [i, raw] of (Array.isArray(doc.sites) ? doc.sites : []).entries()) {
    const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const at = typeof s.id === "string" ? `site '${s.id}'` : `site ${i + 1}`;
    keyProblems(at, s, SITE_KEYS, problems);
    if (typeof s.id !== "string" || !ID.test(s.id)) {
      problems.push(`${at}: id is lower-case words joined by '-'`);
      continue;
    }
    if (sites.some((x) => x.id === s.id)) problems.push(`${at} is listed twice`);
    sites.push({ id: s.id, title: typeof s.title === "string" && s.title.trim() ? s.title.trim() : s.id, ...(typeof s.address === "string" && s.address.trim() ? { address: s.address.trim() } : {}) });
  }

  const units: Unit[] = [];
  const roleUnit = new Map<string, string>();
  if (!Array.isArray(doc.units)) problems.push("units must be a list");
  else if (!doc.units.length) problems.push("add at least one unit");
  for (const [i, raw] of (Array.isArray(doc.units) ? doc.units : []).entries()) {
    const u = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
    const uid = typeof u.id === "string" ? u.id : "";
    const at = uid ? `unit '${uid}'` : `unit ${i + 1}`;
    keyProblems(at, u, UNIT_KEYS, problems);
    if (!ID.test(uid)) {
      problems.push(`${at}: id is lower-case words joined by '-'`);
      continue;
    }
    if (units.some((x) => x.id === uid)) problems.push(`${at} is listed twice`);
    const roles: Role[] = [];
    if (u.roles !== undefined && !Array.isArray(u.roles)) problems.push(`${at}: roles must be a list`);
    for (const r of Array.isArray(u.roles) ? u.roles : []) {
      const role = typeof r === "string" ? { id: r } : ((r ?? {}) as Record<string, unknown>);
      for (const k of Object.keys(role)) if (HR_KEYS.test(k)) problems.push(`${at}: '${k}' doesn't belong in the organisation: no HR records, salaries or grades here`);
      const rid = role.id;
      if (typeof rid !== "string" || !ROLE_ID.test(rid)) {
        problems.push(`${at}: a role id is lower-case words joined by '-'`);
        continue;
      }
      if (rid === VISITOR_ROLE || rid === MANAGER_OF_REQUESTER) {
        problems.push(`${at}: role '${rid}' is built in: don't define it`);
        continue;
      }
      const other = roleUnit.get(rid);
      if (other) {
        problems.push(`${at}: role '${rid}' is already in unit '${other}': a role belongs to one unit`);
        continue;
      }
      roleUnit.set(rid, uid);
      roles.push({
        id: rid,
        label: typeof role.label === "string" && role.label.trim() ? role.label.trim() : (DEFAULT_ROLES.find((d) => d.id === rid)?.label ?? rid.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase())),
        ...(typeof role.description === "string" && role.description.trim() ? { description: role.description.trim() } : {}),
      });
    }
    const lead = typeof u.lead === "string" ? u.lead : null;
    const reports = typeof u.reports_to === "string" ? u.reports_to : null;
    if (household && (u.lead !== undefined || u.reports_to !== undefined))
      problems.push(`${at}: in a household nobody reports to anyone; guardians are set per child in Household`);
    else {
      if (u.lead !== undefined && !lead) problems.push(`${at}: lead is one of the unit's role ids`);
      if (lead && !roles.some((r) => r.id === lead)) problems.push(`${at}: lead '${lead}' isn't one of its roles`);
      if (u.reports_to !== undefined && !reports) problems.push(`${at}: reports_to is a unit id`);
    }
    const services = idList(at, u.services, "services", problems);
    const unitSites = idList(at, u.sites, "sites", problems);
    for (const s of unitSites) if (!sites.some((x) => x.id === s)) problems.push(`${at}: no site '${s}'`);
    units.push({ id: uid, title: typeof u.title === "string" && u.title.trim() ? u.title.trim() : uid, lead: household ? null : lead, reports_to: household ? null : reports, roles, services, sites: unitSites });
  }
  for (const u of units) {
    if (u.reports_to && !units.some((x) => x.id === u.reports_to)) problems.push(`unit '${u.id}': reports_to: no unit '${u.reports_to}'`);
    if (u.reports_to === u.id) problems.push(`unit '${u.id}' can't report to itself`);
  }
  // Reporting lines must end: a loop would send an approval round forever.
  for (const u of units) {
    const seen = new Set<string>([u.id]);
    let at = u.reports_to ? units.find((x) => x.id === u.reports_to) : undefined;
    while (at) {
      if (seen.has(at.id)) {
        if (at.id === u.id && u.reports_to !== u.id) problems.push(`unit '${u.id}': its reporting line goes round in a circle`);
        break;
      }
      seen.add(at.id);
      at = at.reports_to ? units.find((x) => x.id === at!.reports_to) : undefined;
    }
  }
  if (problems.length) return { ok: false, problems };
  return { ok: true, organisation: { id, title, type, template: typeof doc.template === "string" ? doc.template : null, sites, units }, problems };
}

/** Every role the organisation defines, in unit order. */
export const organisationRoles = (org: Organisation): Role[] => org.units.flatMap((u) => u.roles);

/** The unit a role belongs to. */
export const unitOfRole = (org: Organisation, role: string): Unit | undefined => org.units.find((u) => u.roles.some((r) => r.id === role));

/** The first lead above (and including, when `self`) a unit. */
function leadFrom(org: Organisation, unit: Unit | undefined, self: boolean): string | null {
  const seen = new Set<string>();
  let u = self ? unit : unit?.reports_to ? org.units.find((x) => x.id === unit.reports_to) : undefined;
  while (u && !seen.has(u.id)) {
    seen.add(u.id);
    if (u.lead) return u.lead;
    u = u.reports_to ? org.units.find((x) => x.id === u!.reports_to) : undefined;
  }
  return null;
}

/**
 * The role that is the requester's manager (ORG-3): the lead of their unit, or, when they are that
 * lead, the lead above. A requester with no unit (a visitor) goes to the lead of the unit that runs
 * the service. Null in a household, at the top, or when nobody fits.
 */
export function managerOf(org: Organisation, requesterRoles: readonly string[], { service }: { service?: string } = {}): string | null {
  if (org.type === "household") return null;
  const unit = org.units.find((u) => u.roles.some((r) => requesterRoles.includes(r.id)));
  if (unit) {
    const isLead = Boolean(unit.lead && requesterRoles.includes(unit.lead));
    return leadFrom(org, unit, !isLead);
  }
  const runs = service ? org.units.find((u) => u.services.includes(service)) : undefined;
  return runs ? leadFrom(org, runs, true) : null;
}

/** Does the journey ask for the requester's manager anywhere? */
export const needsManager = (journey: Pick<Journey, "steps" | "roles">): boolean =>
  Object.values(journey.steps).some((s) => s.role === MANAGER_OF_REQUESTER) || Boolean(journey.roles?.complete?.includes(MANAGER_OF_REQUESTER));

/**
 * The journey as one requester's case keeps it: `manager-of-requester` becomes that person's
 * manager's role. Returns a problem when nobody fits, or there is no organisation.
 */
export function resolveForRequester<J extends Pick<Journey, "steps" | "roles">>(
  journey: J,
  org: Organisation | null,
  requesterRoles: readonly string[],
  options: { service?: string } = {},
): { ok: true; journey: J; manager: string | null } | { ok: false; problem: string } {
  if (!needsManager(journey)) return { ok: true, journey, manager: null };
  if (!org) return { ok: false, problem: "This journey goes to the requester's manager, but the organisation isn't set up yet. Ask an administrator to publish it." };
  const manager = managerOf(org, requesterRoles, options);
  if (!manager) return { ok: false, problem: org.type === "household" ? "A household has no managers: this journey can't run here." : "There is nobody above you to approve this." };
  const swap = (r: string) => (r === MANAGER_OF_REQUESTER ? manager : r);
  const steps = Object.fromEntries(Object.entries(journey.steps).map(([k, s]) => [k, s.role === MANAGER_OF_REQUESTER ? { ...s, role: manager } : s]));
  const roles = journey.roles ? { ...journey.roles, ...(journey.roles.complete ? { complete: [...new Set(journey.roles.complete.map(swap))] } : {}) } : journey.roles;
  return { ok: true, journey: { ...journey, steps, roles } as J, manager };
}

// ---- checks before publishing (ORG-5) and how units work together (ORG-4) ----------------------------

/** A published service as the checks need it: its id, title, and every role its journeys name. */
export type ServiceRoles = { id: string; title: string; roles: readonly string[]; journeys?: readonly Pick<Journey, "id" | "title" | "steps" | "roles">[] };

export type OrganisationCheck = { level: "warning"; message: string; unit?: string; service?: string; role?: string };

const SPECIAL = new Set<string>([VISITOR_ROLE, MANAGER_OF_REQUESTER, ...DEFAULT_ROLES.map((r) => r.id)]);

/**
 * Warnings before publishing (ORG-5): a service role no unit holds, a unit that runs a service the
 * catalogue doesn't have, and (with the members' roles) a unit running a service with nobody staffed.
 */
export function organisationChecks(org: Organisation, services: readonly ServiceRoles[], memberRoles?: readonly (readonly string[])[]): OrganisationCheck[] {
  const out: OrganisationCheck[] = [];
  const held = new Set(organisationRoles(org).map((r) => r.id));
  for (const s of services)
    for (const r of s.roles)
      if (!SPECIAL.has(r) && !held.has(r)) out.push({ level: "warning", service: s.id, role: r, message: `role '${r}' of service '${s.id}' is held by no unit` });
  for (const u of org.units) {
    if (!u.roles.length) out.push({ level: "warning", unit: u.id, message: `unit '${u.id}' has no roles` });
    for (const sid of u.services) {
      const s = services.find((x) => x.id === sid);
      if (!s) {
        out.push({ level: "warning", unit: u.id, service: sid, message: `unit '${u.id}' runs '${sid}', which isn't in the catalogue` });
        continue;
      }
      if (!memberRoles) continue;
      const mine = u.roles.map((r) => r.id).filter((r) => s.roles.includes(r));
      const wanted = mine.length ? mine : u.roles.map((r) => r.id);
      if (wanted.length && !memberRoles.some((m) => m.some((r) => wanted.includes(r))))
        out.push({ level: "warning", unit: u.id, service: sid, message: `unit '${u.id}' runs '${sid}' with nobody staffed (${wanted.join(", ")})` });
    }
  }
  return out;
}

/** Hand-overs between two units, drawn from published journeys (ORG-4), never by hand. */
export type UnitLink = { from: string; to: string; journeys: string[]; weight: number };

/**
 * How units work together: for each journey, the units its roles pass the work through (starters,
 * then each screen's role, then finishers), each pair once. `weights` (journey id → hand-overs, from
 * case events) adds how often it happens; without them each journey counts once.
 */
export function unitLinks(org: Organisation, journeys: readonly Pick<Journey, "id" | "steps" | "roles">[], weights: Record<string, number> = {}): UnitLink[] {
  const links = new Map<string, UnitLink>();
  for (const j of journeys) {
    const chain: string[] = [];
    const push = (role: string | undefined | null) => {
      const u = role === MANAGER_OF_REQUESTER ? undefined : role ? unitOfRole(org, role)?.id : undefined;
      if (u && chain[chain.length - 1] !== u) chain.push(u);
    };
    for (const r of j.roles?.initiate ?? []) push(r);
    for (const s of Object.values(j.steps)) push(s.role);
    for (const r of j.roles?.complete ?? []) push(r);
    const w = weights[j.id] ?? 1;
    for (let i = 1; i < chain.length; i++) {
      const key = `${chain[i - 1]}→${chain[i]}`;
      const l = links.get(key) ?? { from: chain[i - 1]!, to: chain[i]!, journeys: [], weight: 0 };
      if (!l.journeys.includes(j.id)) l.journeys.push(j.id);
      l.weight += w;
      links.set(key, l);
    }
  }
  return [...links.values()].sort((a, b) => b.weight - a.weight || a.from.localeCompare(b.from));
}

/** Units as a tree, by reporting line (top units first), for display. */
export function unitTree(org: Organisation): { unit: Unit; depth: number }[] {
  const out: { unit: Unit; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (u: Unit, depth: number) => {
    if (seen.has(u.id)) return;
    seen.add(u.id);
    out.push({ unit: u, depth });
    for (const c of org.units.filter((x) => x.reports_to === u.id)) walk(c, depth + 1);
  };
  for (const u of org.units.filter((x) => !x.reports_to || !org.units.some((y) => y.id === x.reports_to))) walk(u, 0);
  for (const u of org.units) walk(u, 0);
  return out;
}
