<script setup lang="ts">
// Curation view: questions the agent escalated (moderators only) above the curated Q&A timeline.
import { AlertTriangle, Lock, MessageCircleQuestion, RefreshCw } from "@lucide/vue";
import { computed, ref } from "vue";
import { useAgentResource } from "@/composables/resource";
import type { CuratedItem, ModerationItem } from "@/lib/types";

const moderation = useAgentResource<{ items: ModerationItem[] }>("moderation");
const curated = useAgentResource<{ items: CuratedItem[] }>("curated");
const signInNeeded = computed(() => moderation.error.value === "Moderator sign-in required.");

const token = ref("");
const signInError = ref<string | null>(null);
const busy = ref(false);
async function signIn() {
  busy.value = true;
  try {
    const res = await fetch("/api/moderator", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: token.value }) });
    if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Sign-in failed.");
    signInError.value = null;
    token.value = "";
    await moderation.refresh();
  } catch (e) {
    signInError.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="space-y-8">
    <section aria-labelledby="mod-heading">
      <div class="mb-3 flex items-center justify-between">
        <h3 id="mod-heading" class="font-semibold text-ink">Awaiting moderation</h3>
        <button type="button" class="inline-flex items-center gap-1 text-xs hover:text-ink" @click="moderation.refresh()"><RefreshCw class="size-3.5" aria-hidden="true" /> Refresh</button>
      </div>
      <form v-if="signInNeeded" class="flex flex-wrap items-center gap-2 rounded-lg bg-mist px-4 py-3 text-sm" @submit.prevent="signIn">
        <Lock class="size-4 text-gray-500" aria-hidden="true" />
        <label for="moderator-token">Moderators: sign in to see escalated questions.</label>
        <input id="moderator-token" v-model="token" type="password" autocomplete="current-password" required class="input max-w-xs" />
        <button type="submit" class="btn-primary" :disabled="busy">Sign in</button>
        <p v-if="signInError" role="alert" class="w-full text-red-800">{{ signInError }}</p>
      </form>
      <p v-else-if="moderation.error.value" class="text-sm text-red-800">{{ moderation.error.value }}</p>
      <p v-if="moderation.data.value?.items.length === 0" class="text-sm text-gray-400">Nothing escalated yet.</p>
      <ul class="space-y-2">
        <li v-for="m in moderation.data.value?.items ?? []" :key="m.id" class="rounded-lg border-l-4 border-warning bg-warning/10 px-4 py-3 text-sm">
          <p class="font-medium text-ink">{{ m.question }}</p>
          <p class="mt-1 text-xs text-gray-600">{{ m.reason }} · {{ new Date(m.created_at).toLocaleString() }}</p>
        </li>
      </ul>
    </section>

    <section aria-labelledby="timeline-heading">
      <h3 id="timeline-heading" class="mb-4"><span class="rounded-r-full bg-info px-3 py-1 text-sm font-bold text-white">Today</span></h3>
      <p v-if="curated.error.value" class="text-sm text-red-800">{{ curated.error.value }}</p>
      <ol class="relative space-y-6 border-l-2 border-gray-200 pl-6">
        <li v-for="item in curated.data.value?.items ?? []" :key="item.id" class="relative">
          <span class="absolute top-1 -left-[33px] flex size-4 items-center justify-center rounded-full bg-white ring-2 ring-info" />
          <div class="card p-4">
            <p class="flex items-start gap-2 font-medium text-ink">
              <AlertTriangle v-if="item.red_flag" class="mt-0.5 size-4 shrink-0 text-danger" aria-label="Red flag" />
              <MessageCircleQuestion v-else class="mt-0.5 size-4 shrink-0 text-info" aria-hidden="true" />
              {{ item.question }}
            </p>
            <p class="mt-3 border-t border-gray-100 pt-3 text-sm">{{ item.answer }}</p>
            <p v-if="item.category" class="mt-2 text-xs text-gray-400">{{ item.category }}</p>
          </div>
        </li>
      </ol>
    </section>
  </div>
</template>
