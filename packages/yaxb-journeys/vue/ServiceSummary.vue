<script setup lang="ts">
// A service at a glance, from its compiled bundle: journeys, screens and questions, who starts and
// finishes each journey, the services its screens call, and the roles that take part.
import type { Bundle } from "@sekaran-ind/yaxb-journeys/bundle";
import { roleLabel, VISITOR_ROLE, type Journey, type Role } from "@sekaran-ind/yaxb-journeys/journeys";
import { computed } from "vue";

const props = defineProps<{ bundle: Pick<Bundle, "services" | "journeys" | "roles"> }>();

const service = computed(() => props.bundle.services[0] ?? null);
const roles = computed<Role[]>(() => props.bundle.roles);
const label = (id: string) => roleLabel(id, roles.value);
const steps = (j: Journey) => Object.values(j.steps);
const questions = (j: Journey) => steps(j).reduce((n, s) => n + (s.fields?.length ?? 0), 0);
const calls = (j: Journey) => [...new Set(steps(j).flatMap((s) => (s.service ? [s.service] : [])))];
const starters = (j: Journey) => (j.roles?.initiate?.length ? j.roles.initiate.map(label) : ["Visitor (anyone)"]);
const finishers = (j: Journey) => (j.roles?.complete ?? []).map(label);

const totals = computed(() => {
  const js = props.bundle.journeys;
  return {
    journeys: js.length,
    screens: js.reduce((n, j) => n + steps(j).length, 0),
    questions: js.reduce((n, j) => n + questions(j), 0),
    roles: roles.value.length,
  };
});
/** For each role: the journeys it starts and finishes. */
const byRole = computed(() =>
  [{ id: VISITOR_ROLE, label: "Visitor (anyone)", description: "Anyone at the kiosk" } as Role, ...roles.value].map((r) => ({
    role: r,
    starts: props.bundle.journeys.filter((j) => (r.id === VISITOR_ROLE ? !j.roles?.initiate?.length || j.roles.initiate.includes(VISITOR_ROLE) : j.roles?.initiate?.includes(r.id))).map((j) => j.title),
    finishes: props.bundle.journeys.filter((j) => j.roles?.complete?.includes(r.id)).map((j) => j.title),
  })),
);
</script>

<template>
  <div class="yj yj-cq yj-stack">
    <p v-if="!service" class="yj-note">The service doesn't compile yet, so there is nothing to summarise. Check the problems.</p>
    <template v-else>
      <div>
        <h3 class="yj-title">{{ service.title }}</h3>
        <p v-if="service.summary" class="yj-small yj-muted">{{ service.summary }}</p>
      </div>
      <div class="yj-stat-grid">
        <div class="yj-stat"><span class="yj-stat-value">{{ totals.journeys }}</span><span class="yj-small yj-muted">journeys</span></div>
        <div class="yj-stat"><span class="yj-stat-value">{{ totals.screens }}</span><span class="yj-small yj-muted">screens</span></div>
        <div class="yj-stat"><span class="yj-stat-value">{{ totals.questions }}</span><span class="yj-small yj-muted">questions</span></div>
        <div class="yj-stat"><span class="yj-stat-value">{{ totals.roles }}</span><span class="yj-small yj-muted">roles</span></div>
      </div>

      <section class="yj-stack" aria-label="Journeys">
        <h4 class="yj-title yj-small">Journeys</h4>
        <div v-for="j in bundle.journeys" :key="j.id" class="yj-card yj-step">
          <p class="yj-title">{{ j.title }} <code class="yj-code">{{ j.id }}</code></p>
          <p v-if="j.summary" class="yj-small yj-muted">{{ j.summary }}</p>
          <dl class="yj-dl yj-mt">
            <dt>Screens</dt>
            <dd>{{ steps(j).map((s) => s.label ?? s.id).join(" → ") }}</dd>
            <dt>Questions</dt>
            <dd>{{ questions(j) }}</dd>
            <dt>Started by</dt>
            <dd>{{ starters(j).join(", ") }}</dd>
            <dt>Finished by</dt>
            <dd>{{ finishers(j).join(", ") || "Whoever started it" }}</dd>
            <template v-if="calls(j).length">
              <dt>Services it calls</dt>
              <dd>{{ calls(j).join(", ") }}</dd>
            </template>
          </dl>
        </div>
      </section>

      <section class="yj-stack" aria-label="Roles">
        <h4 class="yj-title yj-small">Roles</h4>
        <div class="yj-matrix-wrap">
          <table class="yj-matrix">
            <thead>
              <tr>
                <th scope="col">Role</th>
                <th scope="col">Starts</th>
                <th scope="col">Finishes</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in byRole" :key="r.role.id">
                <th scope="row">{{ r.role.label }}</th>
                <td>{{ r.starts.join(", ") || "—" }}</td>
                <td>{{ r.finishes.join(", ") || "—" }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>
