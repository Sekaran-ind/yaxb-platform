// Sealed steps (step access, hand-over on devices). A step whose `access` doesn't let everyone read it
// (access.ts) travels in a case sealed (seal/index.ts): its answers are encrypted for the devices of
// the people who may read it, and every other device on the way carries it without being able to
// read it. Each hop opens what its key can open, and seals again what it holds in the clear before
// it sends the case on, so a case that goes nurse -> clerk -> doctor still reaches the doctor with the
// nurse's step intact even though the clerk could not read it.
//
// A device that cannot read a step still has to check the case: the receiving device replays the answers
// to see where the case stands. The decisions that depended on sealed answers are recorded in the
// case (`steps["route:<id>"]`, journeys `routeKey`) when it is sealed, and the replay takes the
// recorded way (journeys `replay`, `{ sealed }`).
//
// Only a step with questions is sealed. A service step's result stays in the clear.
import { accessOf, isRestricted, replay, type Journey, type Step } from "@sekaran-ind/yaxb-journeys/journeys";
import { open, seal, type PublicKey, type KeyPair, type Sealed } from "../seal/index.js";
import { contextOf, type Case } from "./index.js";
import { TransferError } from "./transfer.js";

/** Where the readers' public keys come from: the business's directory of its members' devices. */
export interface KeyDirectory {
  /** The devices of the members who hold any of these roles. */
  forRoles(roles: readonly string[]): Promise<PublicKey[]>;
  /** Administrators' devices: they read everything. */
  admins(): Promise<PublicKey[]>;
}

export const sealedAad = (caseId: string, step: string) => `${caseId}|${step}`;


/** Who may read a restricted step: the roles, and whether the person who started the case. Mirrors accessOf. */
export function readersOf(s: Step): { roles: string[]; starter: boolean } {
  const access = s.access ?? {};
  const listed = (k: string) => Object.hasOwn(access, k);
  const roles = new Set<string>();
  if (s.role && !listed(s.role)) roles.add(s.role);
  for (const [subject, bits] of Object.entries(access)) if (subject !== "starter" && subject !== "any" && typeof bits === "string" && bits.includes("r")) roles.add(subject);
  const starter = listed("starter") ? String(access.starter).includes("r") : true;
  return { roles: [...roles], starter };
}

/**
 * The case as it goes in an envelope: every restricted step still in the clear is sealed for its
 * readers, and the way the run went at each decision is recorded. The sender keeps its own copy as
 * it was. Fails (nothing is sent) if no device could read a step, rather than send it unsealed.
 */
export async function sealCase(c: Case, { directory, starterKey = c.starter_key ?? null }: { directory: KeyDirectory; starterKey?: PublicKey | null }): Promise<Case> {
  const restricted = Object.keys(c.run.answers).filter((id) => c.journey.steps[id] && isRestricted(c.journey.steps[id]!));
  if (!restricted.length) return c;
  const known = Object.keys(c.run.sealed ?? {});
  const full = await replay(c.journey, { answers: c.run.answers, steps: c.run.steps }, contextOf(c), { sealed: known, recordRoutes: true });
  if (!full.ok) throw new TransferError(`The case's answers don't fit its journey: ${full.problems[0]}`);
  const steps: Record<string, unknown> = { ...c.run.steps };
  for (const [k, v] of Object.entries(full.state.steps)) if (k.startsWith("route:")) steps[k] = v;
  const answers = { ...c.run.answers };
  const sealed: Record<string, unknown> = { ...(c.run.sealed ?? {}) };
  const admins = await directory.admins();
  for (const id of restricted) {
    const who = readersOf(c.journey.steps[id]!);
    const keys = new Map<string, PublicKey>();
    for (const k of [...(who.roles.length ? await directory.forRoles(who.roles) : []), ...admins, ...(who.starter && starterKey ? [starterKey] : [])]) keys.set(k.id, k);
    if (!keys.size) throw new TransferError(`No device can read "${c.journey.steps[id]?.label ?? id}" yet, so the case isn't sent.`);
    sealed[id] = await seal(answers[id], sealedAad(c.id, id), [...keys.values()]);
    delete answers[id];
  }
  return { ...c, run: { ...c.run, answers, steps, sealed } };
}

/** The case with every sealed step this key can open in the clear; the rest stay sealed. */
export async function openCase(c: Case, me: Pick<KeyPair, "id" | "privateKey">): Promise<Case> {
  const sealed = c.run.sealed as Record<string, Sealed> | undefined;
  if (!sealed || !Object.keys(sealed).length) return c;
  const answers = { ...c.run.answers };
  const rest: Record<string, unknown> = {};
  for (const [id, s] of Object.entries(sealed)) {
    const plain = await open<Record<string, unknown>>(s, sealedAad(c.id, id), me);
    if (plain && typeof plain === "object") answers[id] = plain;
    else rest[id] = s;
  }
  const { sealed: _gone, ...run } = c.run;
  return { ...c, run: { ...run, answers, ...(Object.keys(rest).length ? { sealed: rest } : {}) } };
}

/** The steps a case carries sealed. */
export const sealedSteps = (c: Pick<Case, "run">) => Object.keys(c.run.sealed ?? {});

/** Sealed steps that make no sense for the journey: not a step with questions that restricts reading, or also in the clear. */
export function sealedProblems(journey: Journey, run: Pick<Case["run"], "answers" | "sealed">): string[] {
  const problems: string[] = [];
  for (const id of Object.keys(run.sealed ?? {})) {
    const step = journey.steps[id];
    if (!step || !isRestricted(step)) problems.push(`"${id}" isn't a step that is sealed.`);
    else if (Object.hasOwn(run.answers, id)) problems.push(`"${id}" is both sealed and in the clear.`);
    else {
      const s = (run.sealed as Record<string, Partial<Sealed>>)[id];
      if (!s || s.v !== 1 || typeof s.ct !== "string" || typeof s.iv !== "string" || !s.keys || typeof s.keys !== "object") problems.push(`"${id}" isn't sealed properly.`);
    }
  }
  return problems;
}

export { accessOf, isRestricted };
