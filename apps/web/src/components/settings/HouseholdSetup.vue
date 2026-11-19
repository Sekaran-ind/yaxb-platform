<script setup lang="ts">
// Preferences → Household (EDN-20..24): who decides on requests, who handles repairs, and each
// child's guardians. A guardian changes it (anyone signed in, until there is a guardian). Only
// profile ids and roles are kept; a parent sees a child's requests, never the child's conversations.
import { HOUSEHOLD_ROLE_LABELS, HOUSEHOLD_ROLES, type HouseholdRole } from "@sekaran-ind/yaxb-core/household";
import { Users } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";
import { useAccount } from "@/composables/account";
import { pruneHousehold, setMember, useHousehold } from "@/composables/household";

const account = useAccount();
const { household, mayEdit, profile } = useHousehold();
const problem = ref<string | null>(null);
onMounted(() => pruneHousehold(account.list.value.map((p) => p.id)));

const people = computed(() => account.list.value);
const memberOf = (id: string) => household.value.members.find((m) => m.profile === id) ?? { profile: id, roles: [], guardians: [] };
const guardians = computed(() => people.value.filter((p) => memberOf(p.id).roles.includes("guardian")));
const nameOf = (id: string) => people.value.find((p) => p.id === id)?.nickname ?? "Someone";

function toggleRole(id: string, role: HouseholdRole, on: boolean) {
  const roles = memberOf(id).roles.filter((r) => r !== role);
  problem.value = setMember(id, { roles: on ? [...roles, role] : roles });
}
function toggleGuardian(child: string, guardian: string, on: boolean) {
  const list = memberOf(child).guardians.filter((g) => g !== guardian);
  problem.value = setMember(child, { guardians: on ? [...list, guardian] : list });
}
</script>

<template>
  <section class="card p-5" aria-labelledby="household-setup">
    <h2 id="household-setup" class="flex items-center gap-2 text-lg font-semibold text-ink"><Users class="size-5 text-brand" aria-hidden="true" /> Household</h2>
    <p class="mt-1 text-sm text-gray-600">
      Who decides on requests and who handles repairs. A child's requests go only to the guardians you tick for them. Parents see a child's requests, never their conversations.
    </p>

    <p v-if="!people.length" class="mt-4 text-sm text-gray-600">Add a profile for each person first (Preferences → Profile).</p>
    <template v-else>
      <p v-if="!profile" class="caution mt-4 px-3 py-2 text-sm">Sign in to your profile to change the household.</p>
      <p v-else-if="!mayEdit" class="caution mt-4 px-3 py-2 text-sm">Only a parent or guardian can change the household.</p>

      <ul class="mt-4 divide-y divide-gray-100">
        <li v-for="p in people" :key="p.id" class="py-3">
          <p class="font-medium text-ink">{{ p.nickname }}<span v-if="p.id === profile" class="text-sm font-normal text-gray-500"> · you</span></p>
          <div class="mt-2 flex flex-wrap gap-x-5 gap-y-2">
            <label v-for="r in HOUSEHOLD_ROLES" :key="r" class="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" class="size-4 accent-[var(--color-brand)]" :checked="memberOf(p.id).roles.includes(r)" :disabled="!mayEdit || (r === 'guardian' && memberOf(p.id).guardians.length > 0)" @change="toggleRole(p.id, r, ($event.target as HTMLInputElement).checked)" />
              {{ HOUSEHOLD_ROLE_LABELS[r] }}
            </label>
          </div>
          <fieldset v-if="!memberOf(p.id).roles.includes('guardian') && guardians.length" class="mt-2">
            <legend class="text-xs text-gray-600">A child? Their requests go to:</legend>
            <div class="mt-1 flex flex-wrap gap-x-5 gap-y-2">
              <label v-for="g in guardians" :key="g.id" class="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" class="size-4 accent-[var(--color-brand)]" :checked="memberOf(p.id).guardians.includes(g.id)" :disabled="!mayEdit" @change="toggleGuardian(p.id, g.id, ($event.target as HTMLInputElement).checked)" />
                {{ nameOf(g.id) }}
              </label>
            </div>
          </fieldset>
        </li>
      </ul>
      <p v-if="problem" role="alert" class="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-sm text-red-800">{{ problem }}</p>
    </template>
  </section>
</template>
