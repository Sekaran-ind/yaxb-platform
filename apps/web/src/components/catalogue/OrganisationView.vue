<script setup lang="ts">
// The organisation (ORG-1, ORG-3..5) read as people see it: units by reporting line, each with its
// lead, roles, sites and the services it runs; who approves for whom ("the requester's manager");
// and how units work together, drawn from the published services' journeys (never by hand).
import { compileBundle, managerOf, roleLabel, unitLinks, unitTree, type Journey, type Organisation, type Role } from "@sekaran-ind/yaxb-journeys";
import { computed } from "vue";
import type { CatalogueService } from "@/composables/library";

const props = defineProps<{ organisation: Organisation; services: readonly CatalogueService[]; warnings?: readonly { line: number; message: string }[] }>();
const emit = defineEmits<{ line: [number] }>();

const roles = computed<Role[]>(() => props.organisation.units.flatMap((u) => u.roles));
const label = (id: string) => roleLabel(id, roles.value);
const unitTitle = (id: string) => props.organisation.units.find((u) => u.id === id)?.title ?? id;
const serviceTitle = (id: string) => props.services.find((s) => s.id === id)?.title ?? id;
const siteTitle = (id: string) => props.organisation.sites.find((s) => s.id === id)?.title ?? id;
const tree = computed(() => unitTree(props.organisation));
const household = computed(() => props.organisation.type === "household");

/** Who a request from each role goes to when a journey asks for "the requester's manager". */
const approvals = computed(() =>
  household.value
    ? []
    : roles.value.map((r) => {
        const m = managerOf(props.organisation, [r.id]);
        return { role: r.label, manager: m ? label(m) : null };
      }),
);

const journeys = computed<Journey[]>(() => props.services.flatMap((s) => compileBundle(s.yaml).journeys));
const links = computed(() => unitLinks(props.organisation, journeys.value));
const journeyTitle = (id: string) => journeys.value.find((j) => j.id === id)?.title ?? id;
</script>

<template>
  <div class="space-y-5">
    <p class="text-sm text-gray-600">
      {{ organisation.title }} · {{ household ? "a household" : organisation.type === "community" ? "a community" : "a business" }} · {{ organisation.units.length }} unit{{ organisation.units.length === 1 ? "" : "s" }}<template v-if="organisation.sites.length">
        · {{ organisation.sites.length }} site{{ organisation.sites.length === 1 ? "" : "s" }}</template
      >
    </p>

    <section aria-label="Units" class="space-y-2">
      <h3 class="text-sm font-semibold text-ink">Units</h3>
      <ul class="space-y-2">
        <li v-for="t in tree" :key="t.unit.id" :style="{ marginInlineStart: `${Math.min(t.depth, 4) * 1.25}rem` }" class="card p-3">
          <p class="flex flex-wrap items-baseline gap-x-2">
            <span class="font-semibold text-ink">{{ t.unit.title }}</span>
            <span v-if="t.unit.reports_to" class="text-xs text-gray-500">reports to {{ unitTitle(t.unit.reports_to) }}</span>
          </p>
          <p v-if="t.unit.lead" class="text-sm text-gray-700">Led by {{ label(t.unit.lead) }}</p>
          <p v-if="t.unit.roles.length" class="mt-1 flex flex-wrap gap-1"><span v-for="r in t.unit.roles" :key="r.id" class="chip">{{ r.label }}</span></p>
          <p v-if="t.unit.services.length" class="mt-1 text-xs text-gray-600">Runs {{ t.unit.services.map(serviceTitle).join(", ") }}</p>
          <p v-if="t.unit.sites.length" class="text-xs text-gray-500">At {{ t.unit.sites.map(siteTitle).join(", ") }}</p>
        </li>
      </ul>
      <p v-if="household" class="text-xs text-gray-500">At home nobody reports to anyone. A child's requests go to their guardians, set in Preferences → Household.</p>
    </section>

    <section v-if="approvals.length" aria-label="Who approves" class="space-y-2">
      <h3 class="text-sm font-semibold text-ink">The requester's manager</h3>
      <p class="text-xs text-gray-500">A screen for "the requester's manager" goes to the lead of the person's own unit, or the lead above when they lead it.</p>
      <dl class="grid gap-x-6 gap-y-1 rounded-xl bg-mist p-3 text-sm @lg:grid-cols-[auto_1fr]">
        <template v-for="a in approvals" :key="a.role">
          <dt class="text-gray-600">{{ a.role }}</dt>
          <dd class="text-ink">{{ a.manager ?? "Nobody above" }}</dd>
        </template>
      </dl>
    </section>

    <section aria-label="How units work together" class="space-y-2">
      <h3 class="text-sm font-semibold text-ink">How units work together</h3>
      <p v-if="!links.length" class="text-sm text-gray-600">No published journey passes work from one unit to another yet.</p>
      <ul v-else class="space-y-1 text-sm">
        <li v-for="l in links" :key="`${l.from}-${l.to}`" class="text-ink">
          {{ unitTitle(l.from) }} → {{ unitTitle(l.to) }} <span class="text-xs text-gray-500">({{ l.journeys.map(journeyTitle).join(", ") }})</span>
        </li>
      </ul>
    </section>

    <section v-if="warnings?.length" aria-label="Before publishing" class="space-y-1">
      <h3 class="text-sm font-semibold text-ink">Before publishing</h3>
      <ul class="space-y-1">
        <li v-for="(w, i) in warnings" :key="i">
          <button type="button" class="flex w-full gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-mist" @click="emit('line', w.line)">
            <span class="font-semibold text-gray-700">Warning</span><span class="text-ink">{{ w.message }}</span>
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>
