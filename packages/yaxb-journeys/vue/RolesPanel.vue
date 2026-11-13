<script setup lang="ts">
// The designer's side panel: the roles that deliver the service, added as you design, and who starts
// and finishes each journey (a role × journey matrix). Removing a role takes it out of every journey.
import { idFromName } from "@sekaran-ind/yaxb-journeys/forms";
import { DEFAULT_ROLES, VISITOR_ROLE, type Role } from "@sekaran-ind/yaxb-journeys/journeys";
import { computed, ref, useId } from "vue";

type Assign = { id: string; title: string; initiate: string[]; complete: string[] };
const props = defineProps<{ roles: Role[]; journeys: Assign[]; readonly?: boolean }>();
const emit = defineEmits<{ "update:roles": [roles: Role[]]; assign: [index: number, initiate: string[], complete: string[]] }>();
const uid = useId();

const name = ref("");
const description = ref("");
const error = ref<string | null>(null);
const newId = computed(() => idFromName(name.value));
const missingBuiltins = computed(() => DEFAULT_ROLES.filter((d) => !props.roles.some((r) => r.id === d.id)));

function add(role?: Role) {
  error.value = null;
  const r = role ?? { id: newId.value, label: name.value.trim(), ...(description.value.trim() ? { description: description.value.trim() } : {}) };
  if (!r.id || !r.label) return void (error.value = "Give the role a name.");
  if (r.id === VISITOR_ROLE) return void (error.value = "Visitor is built in: it means anyone at the kiosk.");
  if (props.roles.some((x) => x.id === r.id)) return void (error.value = `There is already a role "${r.label}".`);
  emit("update:roles", [...props.roles, { id: r.id, label: r.label, ...(r.description ? { description: r.description } : {}) }]);
  name.value = description.value = "";
}
function remove(id: string) {
  emit("update:roles", props.roles.filter((r) => r.id !== id));
  props.journeys.forEach((j, i) => {
    if (j.initiate.includes(id) || j.complete.includes(id)) emit("assign", i, j.initiate.filter((x) => x !== id), j.complete.filter((x) => x !== id));
  });
}

type Part = "none" | "start" | "finish" | "both";
const partOf = (j: Assign, id: string): Part => {
  // Nobody set to start a journey means anyone may: the visitor row shows that.
  const s = j.initiate.includes(id) || (id === VISITOR_ROLE && !j.initiate.length);
  const f = j.complete.includes(id);
  return s && f ? "both" : s ? "start" : f ? "finish" : "none";
};
function setPart(i: number, id: string, part: Part) {
  const j = props.journeys[i]!;
  // The visitor is implicit while nobody else starts it: keep that explicit before changing others.
  const initiate = j.initiate.filter((x) => x !== id);
  if (id !== VISITOR_ROLE && !j.initiate.length && part === "none") return;
  const complete = j.complete.filter((x) => x !== id);
  if (part === "start" || part === "both") initiate.push(id);
  if (part === "finish" || part === "both") complete.push(id);
  emit("assign", i, initiate, complete);
}
const rows = computed(() => [{ id: VISITOR_ROLE, label: "Visitor (anyone)" }, ...props.roles]);
</script>

<template>
  <div class="yj yj-stack yj-roles-panel">
    <div>
      <h3 class="yj-title">Roles</h3>
      <p class="yj-small yj-muted">Who delivers this service. Add one while you design, then say which journeys it starts or finishes.</p>
    </div>

    <ul v-if="roles.length" class="yj-role-list">
      <li v-for="r in roles" :key="r.id" class="yj-role">
        <span>
          <span class="yj-title yj-small">{{ r.label }}</span> <code class="yj-code">{{ r.id }}</code>
          <span v-if="r.description" class="yj-help yj-block">{{ r.description }}</span>
        </span>
        <button v-if="!readonly" type="button" class="yj-btn yj-btn-quiet" :aria-label="`Remove the role ${r.label}`" @click="remove(r.id)">×</button>
      </li>
    </ul>
    <p v-else class="yj-note yj-small">No roles yet: every journey is open to visitors.</p>

    <form v-if="!readonly" class="yj-stack yj-card yj-step" @submit.prevent="add()">
      <div>
        <label :for="`${uid}-name`" class="yj-field-label">New role</label>
        <input :id="`${uid}-name`" v-model="name" class="yj-input" placeholder="Front desk" maxlength="40" />
        <p v-if="newId" class="yj-help">Id: <code class="yj-code">{{ newId }}</code></p>
      </div>
      <div>
        <label :for="`${uid}-desc`" class="yj-field-label">What they do (optional)</label>
        <input :id="`${uid}-desc`" v-model="description" class="yj-input" maxlength="200" />
      </div>
      <p v-if="error" role="alert" class="yj-alert">{{ error }}</p>
      <div class="yj-row">
        <button type="submit" class="yj-btn yj-btn-primary" :disabled="!name.trim()">Add role</button>
        <button v-for="b in missingBuiltins" :key="b.id" type="button" class="yj-btn yj-select-sm" :title="b.description" @click="add(b)">+ {{ b.label }}</button>
      </div>
    </form>

    <div v-if="journeys.length">
      <h4 class="yj-title yj-small">Who starts and finishes each journey</h4>
      <div class="yj-matrix-wrap">
        <table class="yj-matrix">
          <thead>
            <tr>
              <th scope="col">Role</th>
              <th v-for="j in journeys" :key="j.id" scope="col">{{ j.title || j.id }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="r.id">
              <th scope="row">{{ r.label }}</th>
              <td v-for="(j, i) in journeys" :key="j.id">
                <select
                  class="yj-input yj-select-sm"
                  :value="partOf(j, r.id)"
                  :disabled="readonly"
                  :aria-label="`${r.label} in ${j.title || j.id}`"
                  @change="setPart(i, r.id, ($event.target as HTMLSelectElement).value as Part)"
                >
                  <option value="none">—</option>
                  <option value="start">Starts</option>
                  <option v-if="r.id !== 'visitor'" value="finish">Finishes</option>
                  <option v-if="r.id !== 'visitor'" value="both">Both</option>
                </select>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="yj-help">A journey nobody is set to start is open to visitors. Set a role to start it, and only that role can (unless Visitor starts it too).</p>
    </div>
  </div>
</template>
