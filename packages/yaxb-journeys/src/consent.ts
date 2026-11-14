// A service's consent forms (CON-1..3): a short form for each role, written by the Legal Guardian
// (yaxb-core guardian/) from what the service asks, who sees it and where it is kept, then reviewed
// with the service. It is part of the service document, so a new revision may change it and the
// reviewer accepts it with everything else.
//
//   consent:
//     version: 2                      raised when the wording changes: people agree again
//     forms:
//       - role: visitor                anyone starting a journey (or a role's own id)
//         title: Before you start
//         points: [ "We ask for your name and phone number.", "…" ]
//         agree: I agree
//       - role: marshal                a staff role: their duties with what people give
//         title: Your duties as a marshal
//         points: [ … ]
//         agree: I'll follow these
import { ROLE_ID, VISITOR_ROLE } from "./roles.js";

export type ConsentForm = { role: string; title: string; points: string[]; agree: string };
export type ServiceConsent = { version: number; forms: ConsentForm[] };

export const CONSENT_LIMITS = { points: 8, point: 300, title: 80, agree: 60 } as const;

/** The service's `consent:`, and what's wrong with it. `roles` are the ids a form may name. */
export function serviceConsent(value: unknown, roles: ReadonlySet<string> | null, problems: string[] = []): ServiceConsent | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    problems.push("consent must be { version, forms }");
    return null;
  }
  const c = value as Record<string, unknown>;
  for (const k of Object.keys(c)) if (k !== "version" && k !== "forms") problems.push(`consent: unknown key '${k}'`);
  const version = typeof c.version === "number" && Number.isInteger(c.version) && c.version > 0 ? c.version : 0;
  if (!version) problems.push("consent: version is a whole number from 1");
  if (!Array.isArray(c.forms)) {
    problems.push("consent: forms must be a list of { role, title, points, agree }");
    return null;
  }
  const forms: ConsentForm[] = [];
  c.forms.forEach((raw, i) => {
    const f = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const at = `consent form ${typeof f.role === "string" ? `'${f.role}'` : i + 1}`;
    if (typeof f.role !== "string" || (f.role !== VISITOR_ROLE && !ROLE_ID.test(f.role))) return void problems.push(`${at}: role is a role id, or visitor`);
    if (roles && f.role !== VISITOR_ROLE && !roles.has(f.role)) return void problems.push(`${at}: role '${f.role}' isn't one of this service's roles`);
    if (forms.some((x) => x.role === f.role)) return void problems.push(`${at} is listed twice`);
    if (typeof f.title !== "string" || !f.title.trim() || f.title.length > CONSENT_LIMITS.title) return void problems.push(`${at}: give it a title (up to ${CONSENT_LIMITS.title} characters)`);
    const points = Array.isArray(f.points) ? f.points.filter((p): p is string => typeof p === "string" && Boolean(p.trim())).map((p) => p.trim()) : [];
    if (!points.length || points.length !== (f.points as unknown[]).length) return void problems.push(`${at}: points is a list of sentences`);
    if (points.length > CONSENT_LIMITS.points) return void problems.push(`${at}: at most ${CONSENT_LIMITS.points} points`);
    if (points.some((p) => p.length > CONSENT_LIMITS.point)) return void problems.push(`${at}: keep each point under ${CONSENT_LIMITS.point} characters`);
    const agree = typeof f.agree === "string" && f.agree.trim() ? f.agree.trim() : "I agree";
    if (agree.length > CONSENT_LIMITS.agree) return void problems.push(`${at}: the agree button's words are too long`);
    forms.push({ role: f.role, title: f.title.trim(), points, agree });
  });
  return version ? { version, forms } : null;
}

/**
 * The form for someone acting in `roles` (their roles, most specific first) at a part where `allowed`
 * roles act: a staff role's own form when they have one, else the visitor's (anyone starting).
 */
export function consentFormFor(consent: ServiceConsent | null, roles: readonly string[], allowed?: readonly string[]): ConsentForm | null {
  if (!consent) return null;
  const own = consent.forms.find((f) => f.role !== VISITOR_ROLE && roles.includes(f.role) && (!allowed || allowed.includes(f.role)));
  if (own) return own;
  return !allowed || !allowed.length || allowed.includes(VISITOR_ROLE) ? (consent.forms.find((f) => f.role === VISITOR_ROLE) ?? null) : null;
}
