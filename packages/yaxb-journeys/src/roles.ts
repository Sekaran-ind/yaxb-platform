// Roles: who takes part in delivering a service, and who may start and finish a journey.
//
//   kind: service
//   roles: [receptionist, nurse]          the roles that deliver this service
//   ---
//   kind: journey
//   roles:
//     initiate: [visitor, receptionist]   who may start it ("visitor": anyone at the kiosk)
//     complete: [nurse]                   who finishes it
//
// Role ids are lower-case words joined by '-'. Admin, Moderator and Reviewer are built in; an
// organisation adds its own (a library's role catalogue). `visitor` is not a member role: it means
// "anyone at the kiosk", so a journey whose initiate list has it (or that names no roles) is offered
// to every visitor.

export type Role = { id: string; label: string; description?: string; builtin?: boolean };

export const VISITOR_ROLE = "visitor";

/** The built-in roles. Their ids match the kiosk's member roles (administrator is shown as Admin). */
export const DEFAULT_ROLES: readonly Role[] = [
  { id: "administrator", label: "Admin", description: "Manages the team, roles and libraries; can do everything.", builtin: true },
  { id: "moderator", label: "Moderator", description: "Handles the kiosk's moderation queue; writes and maintains journeys.", builtin: true },
  { id: "reviewer", label: "Reviewer", description: "Reads what is submitted and accepts or rejects it.", builtin: true },
];

export const ROLE_ID = /^[a-z][a-z0-9-]{0,31}$/;

export type JourneyRoles = { initiate?: string[]; complete?: string[] };

/** Problems with a list of role ids. `known`, when given, are the ids that exist (visitor is always allowed). */
export function roleListProblems(at: string, value: unknown, known?: readonly string[]): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((r) => typeof r !== "string")) return [`${at} must be a list of role ids`];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const r of value as string[]) {
    if (!ROLE_ID.test(r)) problems.push(`${at}: '${r}' is not a role id (lower-case words joined by '-')`);
    else if (known && r !== VISITOR_ROLE && !known.includes(r)) problems.push(`${at}: no role '${r}'`);
    if (seen.has(r)) problems.push(`${at}: '${r}' is listed twice`);
    seen.add(r);
  }
  return problems;
}

/** Problems with a journey's `roles: { initiate, complete }`. */
export function journeyRoleProblems(value: unknown, known?: readonly string[]): string[] {
  if (value === undefined) return [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["roles is a mapping with initiate and complete lists"];
  const r = value as Record<string, unknown>;
  const problems = Object.keys(r).filter((k) => k !== "initiate" && k !== "complete").map((k) => `roles: unknown key '${k}'`);
  return [...problems, ...roleListProblems("roles.initiate", r.initiate, known), ...roleListProblems("roles.complete", r.complete, known)];
}

/** May someone with these roles start the journey? No initiate list, or `visitor` in it, means anyone. */
export function canInitiate(journey: { roles?: JourneyRoles }, roles: readonly string[] = []): boolean {
  const initiate = journey.roles?.initiate;
  if (!initiate?.length || initiate.includes(VISITOR_ROLE)) return true;
  return initiate.some((r) => roles.includes(r));
}

/** A role's label from a catalogue, or the id made readable. */
export function roleLabel(id: string, catalogue: readonly Role[] = DEFAULT_ROLES): string {
  if (id === VISITOR_ROLE) return "Visitor";
  return catalogue.find((r) => r.id === id)?.label ?? id.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
}
