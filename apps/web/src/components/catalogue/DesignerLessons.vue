<script setup lang="ts">
// What the Service Designer agent has learnt (LIB-31): lessons from reviews of its drafts (accepted
// after changes, or rejected with the reviewer's note) and lessons administrators write. The newest
// ones are the agent's memory for every draft. Administrators only.
import type { DesignLesson } from "@sekaran-ind/yaxb-core/designer";
import { ConfirmAction } from "@sekaran-ind/yaxb-journeys/vue";
import { Plus, Trash2 } from "@lucide/vue";
import { ref } from "vue";
import { api } from "@/lib/api";

const LESSONS_IN_MEMORY = 30;
const lessons = ref<DesignLesson[] | null>(null);
const error = ref<string | null>(null);
const draft = ref<string | null>(null);
const busy = ref(false);

async function load() {
  error.value = null;
  try {
    lessons.value = (await api<{ lessons: DesignLesson[] }>("/api/library/lessons")).lessons;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
void load();

async function call(fn: () => Promise<unknown>) {
  busy.value = true;
  error.value = null;
  try {
    await fn();
    draft.value = null;
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
const add = () => call(() => api("/api/library/lessons", { text: draft.value }));
const remove = (id: string) => call(() => api(`/api/library/lessons/${id}`, undefined, "DELETE"));

const origin = (l: DesignLesson) => (l.source === "admin" ? `Written by ${l.created_by_name ?? "an administrator"}` : `${l.decision === "rejected" ? "Rejected" : "Accepted"} by ${l.created_by_name ?? "a reviewer"}`);
const when = (iso: string) => new Date(iso).toLocaleDateString();
</script>

<template>
  <section aria-label="What the Service Designer has learnt" class="max-w-4xl space-y-3">
    <p class="text-sm text-gray-600">
      “Describe it” drafts a service with the AI. It learns from what reviewers do with its drafts: a draft accepted after people changed it, or rejected with a note, becomes a lesson here. The newest
      {{ LESSONS_IN_MEMORY }} lessons go with every draft. Every published service is also an example for the next one.
    </p>
    <p v-if="error" role="alert" class="rounded-lg bg-danger/10 px-3 py-2 text-sm text-red-800">{{ error }}</p>
    <p v-if="lessons && !lessons.length" class="rounded-lg bg-mist px-3 py-4 text-center text-sm text-gray-500">No lessons yet. They appear when reviewers accept or reject services that started as AI drafts.</p>
    <ol v-else-if="lessons" class="divide-y divide-gray-100 rounded-xl bg-surface ring-1 ring-gray-100">
      <li v-for="(l, i) in lessons" :key="l.id" class="flex items-start gap-3 px-4 py-3">
        <span class="min-w-0 flex-1">
          <span class="block text-sm text-ink">{{ l.text }}</span>
          <span class="mt-0.5 block text-xs text-gray-500">
            {{ origin(l) }} · {{ when(l.created_at) }}<template v-if="i >= LESSONS_IN_MEMORY"> · older than the {{ LESSONS_IN_MEMORY }} the designer reads</template>
          </span>
        </span>
        <ConfirmAction
          label="Delete"
          confirm-label="Delete it"
          :aria-label="`Delete the lesson: ${l.text.slice(0, 60)}`"
          message="Delete this lesson? The designer stops following it from the next draft."
          trigger-class="btn-ghost h-8 px-2"
          :busy="busy"
          @confirm="remove(l.id)"
          ><Trash2 class="size-4" aria-hidden="true"
        /></ConfirmAction>
      </li>
    </ol>
    <form v-if="draft !== null" class="card space-y-2 p-3" @submit.prevent="add">
      <label class="block text-sm">
        <span class="mb-1 block text-gray-600">A lesson for the designer</span>
        <textarea v-model="draft" class="input min-h-20" maxlength="600" required placeholder="e.g. Ask for a phone number only when the person wants a call back." />
      </label>
      <div class="flex gap-2">
        <button type="submit" class="btn-primary" :disabled="busy || draft.trim().length < 5">Add the lesson</button>
        <button type="button" class="btn-ghost" @click="draft = null">Cancel</button>
      </div>
    </form>
    <button v-else type="button" class="btn-light" @click="draft = ''"><Plus class="size-4" aria-hidden="true" /> Write a lesson</button>
  </section>
</template>
