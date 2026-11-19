// The household on this device (EDN-20..24): who is a guardian, who handles repairs, and each
// child's guardians. Only profile ids and roles are kept, in this browser's local storage (no names,
// ages or anything sealed in a profile). Requests between them are household cases, kept on this
// household's devices (composables/case-network.ts acts as the open profile).
import { HOUSEHOLD_ROLE_LABELS, householdProblems, householdRoles, householdSchema, isChild, type Household, type HouseholdMember } from "@sekaran-ind/yaxb-core/household";
import { computed, ref } from "vue";
import { useAccount } from "@/composables/account";
import { offers } from "@/lib/surface";

const KEY = "yaxb.household";

function read(): Household {
  try {
    const r = householdSchema.safeParse(JSON.parse(localStorage.getItem(KEY) ?? "null") ?? {});
    return r.success ? r.data : { members: [] };
  } catch {
    return { members: [] };
  }
}

const state = ref<Household>(read());
export const household = computed(() => state.value);

/** Change one profile's place in the household; refused (with the reason) when it would be wrong. */
export function setMember(profile: string, patch: Partial<Omit<HouseholdMember, "profile">>): string | null {
  const members = state.value.members.filter((m) => m.profile !== profile);
  const now = state.value.members.find((m) => m.profile === profile) ?? { profile, roles: [], guardians: [] };
  const next = householdSchema.safeParse({ members: [...members, { ...now, ...patch }] });
  if (!next.success) return "That isn't a valid household.";
  const problems = householdProblems(next.data);
  if (problems.length) return problems[0]!;
  state.value = next.data;
  try {
    localStorage.setItem(KEY, JSON.stringify(next.data));
  } catch {
    /* kept for this visit only */
  }
  return null;
}

/** Profiles that were removed from the device leave the household too. */
export function pruneHousehold(profiles: readonly string[]) {
  const keep = new Set(profiles);
  const members = state.value.members.filter((m) => keep.has(m.profile)).map((m) => ({ ...m, guardians: m.guardians.filter((g) => keep.has(g)) }));
  if (members.length !== state.value.members.length || members.some((m, i) => m.guardians.length !== state.value.members[i]!.guardians.length)) {
    state.value = { members };
    try {
      localStorage.setItem(KEY, JSON.stringify(state.value));
    } catch {
      /* ignore */
    }
  }
}

/**
 * Who a household request goes to, by name (EDN-21): a child's guardians for a child's request,
 * else everyone with the role ("Amma or Appa"); the role's label when nobody has it yet.
 */
export function householdRecipients(role: string, starterProfile: string | null, names: ReadonlyMap<string, string>): string {
  const h = state.value;
  const child = starterProfile ? (h.members.find((m) => m.profile === starterProfile)?.guardians ?? []) : [];
  const ids = role === "guardian" && child.length ? child : h.members.filter((m) => (m.roles as string[]).includes(role)).map((m) => m.profile);
  const who = ids.map((id) => names.get(id)).filter((n): n is string => Boolean(n));
  return who.length ? who.join(" or ") : (HOUSEHOLD_ROLE_LABELS[role as keyof typeof HOUSEHOLD_ROLE_LABELS] ?? role);
}

let one: ReturnType<typeof create> | null = null;
/** The open profile's household roles (none when no profile is open, or outside Family). One instance. */
export const useHousehold = () => (one ??= create());
function create() {
  const account = useAccount();
  const profile = computed(() => (offers("household") ? account.profileId.value : null));
  const roles = computed(() => (profile.value ? householdRoles(state.value, profile.value) : []));
  /** Whoever may change the household: an open profile that is a guardian, or anyone open while there is no guardian yet. */
  const mayEdit = computed(() => Boolean(profile.value) && (!state.value.members.some((m) => m.roles.includes("guardian")) || roles.value.includes("guardian")));
  return { household, profile, roles, mayEdit, child: computed(() => (profile.value ? isChild(state.value, profile.value) : false)) };
}
