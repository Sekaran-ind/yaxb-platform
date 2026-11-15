<script setup lang="ts">
// A parallel journey's tasks (JRN-47): each one and where it stands. A ready task can be picked to
// work on now; one waiting for others says what it waits for; one waiting for a role says who.
import type { TaskState } from "@sekaran-ind/yaxb-journeys/journeys";
import { computed } from "vue";

const props = defineProps<{ tasks: TaskState[]; roleName?: (id: string) => string }>();
const emit = defineEmits<{ focus: [step: string] }>();

const label = (id: string) => props.tasks.find((t) => t.step === id)?.label ?? id;
const doneCount = computed(() => props.tasks.filter((t) => t.status === "done").length);
const note = (t: TaskState) => {
  if (t.status === "done") return "Done";
  if (t.status === "asking") return "Now";
  if (t.status === "running") return "Running…";
  if (t.status === "waiting") return t.role ? `For ${props.roleName ? props.roleName(t.role) : t.role}` : "Waiting";
  if (t.status === "pending") return `After ${t.after.map(label).join(" and ")}`;
  return "Ready";
};
</script>

<template>
  <div class="yj yj-tasks" role="group" :aria-label="`Tasks: ${doneCount} of ${tasks.length} done`">
    <p class="yj-small yj-muted">{{ doneCount }} of {{ tasks.length }} done · do them in any order</p>
    <ul class="yj-tasks-list">
      <li v-for="t in tasks" :key="t.step">
        <button
          type="button"
          class="yj-task"
          :class="`yj-task-${t.status}`"
          :disabled="t.status !== 'ready'"
          :aria-current="t.status === 'asking' ? 'step' : undefined"
          :title="t.status === 'ready' ? `Work on ${t.label} now` : undefined"
          @click="emit('focus', t.step)"
        >
          <span class="yj-task-dot" aria-hidden="true" />
          <span class="yj-task-label">{{ t.label }}</span>
          <span class="yj-task-note">{{ note(t) }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>
