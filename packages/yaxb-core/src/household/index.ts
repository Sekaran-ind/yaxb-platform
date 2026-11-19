// Household requests in the Family edition (docs/specs/12-platform-and-editions.md, EDN-20..24).
//
// A household is the profiles on a family's device (PRF-1), with who does what: guardians decide on
// requests, a handler looks after repairs, and a child's profile names its guardians. Requests are
// cases (LIB-33..38) of the built-in Household service, kept on the household's devices (LIB-42),
// never on the central store. Who may see and act on one follows the household (householdAllows):
// a child's request goes only to that child's guardians (EDN-21). Conversations and notebooks stay
// with each profile (PRF-2): a parent sees a child's requests, never the child's conversations.
import { compileBundle, type Bundle, type Journey } from "@sekaran-ind/yaxb-journeys";
import { z } from "zod";
import type { Case, CaseActor, CaseJourney } from "../cases/index.js";
import { JOURNEY_SERVICES } from "../content/index.js";

/** The catalogue "entry" household cases come from: built in, not published. */
export const HOUSEHOLD_ENTRY = "household";
export const HOUSEHOLD_ROLES = ["guardian", "handler"] as const;
export type HouseholdRole = (typeof HOUSEHOLD_ROLES)[number];
export const HOUSEHOLD_ROLE_LABELS: Record<HouseholdRole, string> = { guardian: "Parent or guardian", handler: "Handles repairs" };

const profileId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const householdMemberSchema = z.strictObject({
  profile: profileId,
  roles: z.array(z.enum(HOUSEHOLD_ROLES)).max(HOUSEHOLD_ROLES.length).default([]),
  /** A child's guardians (their profile ids); empty for an adult. */
  guardians: z.array(profileId).max(6).default([]),
});
export const householdSchema = z.strictObject({ members: z.array(householdMemberSchema).max(20).default([]) });
export type Household = z.infer<typeof householdSchema>;
export type HouseholdMember = z.infer<typeof householdMemberSchema>;

/** A profile acting on a household case. */
export const profileActorId = (profile: string) => `profile:${profile}`;
const profileOf = (actorId: string) => (actorId.startsWith("profile:") ? actorId.slice("profile:".length) : null);

export const memberOf = (h: Household, profile: string): HouseholdMember | undefined => h.members.find((m) => m.profile === profile);
/** A profile's household roles (guardian, handler). */
export const householdRoles = (h: Household, profile: string): HouseholdRole[] => [...(memberOf(h, profile)?.roles ?? [])];
/** A child: a profile with guardians. */
export const isChild = (h: Household, profile: string) => (memberOf(h, profile)?.guardians.length ?? 0) > 0;

/** What's wrong with a household (none: []). */
export function householdProblems(h: Household): string[] {
  const out: string[] = [];
  const guardians = new Set(h.members.filter((m) => m.roles.includes("guardian")).map((m) => m.profile));
  for (const m of h.members) {
    if (m.guardians.includes(m.profile)) out.push("A profile can't be its own guardian.");
    if (m.guardians.length && m.roles.includes("guardian")) out.push("A child can't be a guardian.");
    for (const g of m.guardians) if (!guardians.has(g)) out.push("A child's guardian must have the guardian role.");
  }
  return [...new Set(out)];
}

/**
 * Who may see and act on a household case (EDN-21): its starter; and, for a child's request, only
 * that child's guardians. Other cases follow the usual roles.
 */
export function householdAllows(h: Household): (c: Pick<Case, "entry_id" | "started_by">, a: CaseActor) => boolean {
  return (c, a) => {
    if (c.entry_id !== HOUSEHOLD_ENTRY || c.started_by === a.id) return true;
    const child = profileOf(c.started_by);
    const guardians = child ? (memberOf(h, child)?.guardians ?? []) : [];
    if (!guardians.length) return true;
    const me = profileOf(a.id);
    return me !== null && guardians.includes(me);
  };
}

/** The built-in Household service (EDN-22): ask for something, report a repair, plan an outing. */
export const HOUSEHOLD_SERVICE_YAML = `kind: service
id: household
title: At home
summary: Requests between the people at home. A child's request goes to their parents.
icon: user-round
roles:
  - { id: guardian, label: Parent or guardian, description: Decides on requests from children and elders }
  - { id: handler, label: Handles repairs, description: Looks after repairs at home }
journeys:
  - id: household-ask
    title: Ask for something
    summary: Ask a parent for something; they say yes or not now.
    icon: message-circle
    roles: { initiate: [visitor] }
    screens:
      - id: what
        title: What would you like?
        questions:
          - { id: thing, type: text, label: What would you like?, required: true }
          - { id: why, type: textarea, label: "Why, or anything else they should know" }
          - { id: by, type: date, label: "By when, if it matters" }
      - id: decision
        title: Your answer
        role: guardian
        questions:
          - { id: answer, type: select, label: Your answer, required: true, options: [{ value: "yes", label: "Yes" }, { value: later, label: Not now }] }
          - { id: note, type: textarea, label: A note for them }
      - id: route
        decide:
          - { if: "answers.decision.answer == 'yes'", to: agreed }
          - { to: not-now }
      - id: agreed
        result: { title: "Yes", text: "{{answers.decision.note}}", outcome: agreed }
      - id: not-now
        result: { title: "Not now", text: "{{answers.decision.note}}", outcome: declined }
  - id: household-repair
    title: Report a repair
    summary: Tell whoever handles repairs what needs fixing.
    icon: wrench
    roles: { initiate: [visitor] }
    screens:
      - id: what
        title: What needs fixing?
        questions:
          - { id: thing, type: text, label: What needs fixing?, required: true }
          - { id: where, type: text, label: Where is it? }
          - { id: urgent, type: boolean, label: It's urgent }
      - id: fixed
        title: What happened
        role: handler
        questions:
          - { id: done, type: select, label: What happened, required: true, options: [{ value: fixed, label: Fixed }, { value: booked, label: Someone is booked to fix it }, { value: later, label: Later }] }
          - { id: note, type: textarea, label: A note }
      - id: done
        result: { title: "Thanks for telling us", text: "{{answers.fixed.note}}", outcome: handled }
  - id: household-outing
    title: Plan an outing
    summary: Suggest an outing; a parent agrees or suggests another time.
    icon: calendar
    roles: { initiate: [visitor] }
    screens:
      - id: plan
        title: The plan
        questions:
          - { id: place, type: text, label: Where to?, required: true }
          - { id: day, type: date, label: When?, required: true }
          - { id: people, type: text, label: Who is going? }
      - id: agree
        title: Your answer
        role: guardian
        questions:
          - { id: answer, type: select, label: Your answer, required: true, options: [{ value: "yes", label: "Let's go" }, { value: other, label: Another time }, { value: "no", label: Not this time }] }
          - { id: note, type: textarea, label: A note }
      - id: route
        decide:
          - { if: "answers.agree.answer == 'yes'", to: going }
          - { to: not-going }
      - id: going
        result: { title: "It's on", text: "{{answers.plan.place}}, {{answers.plan.day}}. {{answers.agree.note}}", outcome: agreed }
      - id: not-going
        result: { title: "Not this time", text: "{{answers.agree.note}}", outcome: declined }
`;

let bundle: Bundle | null = null;
/** The Household service, compiled once. */
export function householdBundle(): Bundle {
  return (bundle ??= compileBundle(HOUSEHOLD_SERVICE_YAML, { services: JOURNEY_SERVICES }));
}
export const householdJourneys = (): Journey[] => householdBundle().journeys;

/** For the case service's journeyFor: a household journey, as a case keeps it. */
export function householdCaseJourney(journeyId: string): CaseJourney | null {
  const journey = householdJourneys().find((j) => j.id === journeyId);
  return journey ? { journey, entry_id: HOUSEHOLD_ENTRY, service_id: "household", service_title: "At home", revision: null } : null;
}
