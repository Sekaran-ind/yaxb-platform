<script setup lang="ts">
// A moderator's own page (MOD-21, MOD-24), like a visitor's profile: sign in with your key, then
// your display name, languages, the knowledge sources you look after, preferences, and your own
// activity (from the audit log: sign-ins, reviews, profile changes; never content).
import { AUDIT_ACTIONS, type AuditEvent, type ModeratorProfile } from "@sekaran-ind/yaxb-core/moderators";
import { KeyRound, LogOut } from "@lucide/vue";
import { onMounted, ref } from "vue";
import { useAgentResource } from "@/composables/resource";
import { LANGUAGES } from "@/lib/languages";
import type { KnowledgeSource } from "@/lib/types";

type Me = {
  moderator: { id: string; name: string; label?: string | null; roles: string[]; status?: string; key_prefix?: string; created_at?: string; expires_at?: string | null; last_seen_at?: string | null; reviews?: number; shared: boolean };
  profile: ModeratorProfile | null;
  activity: AuditEvent[];
};
const me = ref<Me | null>(null);
const signedOut = ref(false);
const key = ref("");
const error = ref<string | null>(null);
const saved = ref<string | null>(null);
const busy = ref(false);
const draft = ref<{ display_name: string; languages: string[]; sources: string[]; queue: "open" | "all"; reviewLanguage: string } | null>(null);
const sources = useAgentResource<{ sources: KnowledgeSource[] }>("sources");

async function load() {
  error.value = null;
  const res = await fetch("/api/moderator/me");
  if (res.status === 401) {
    me.value = null;
    signedOut.value = true;
    return;
  }
  const body = (await res.json()) as Me;
  me.value = body;
  signedOut.value = false;
  const p = body.profile;
  draft.value = p ? { display_name: p.display_name, languages: [...p.languages], sources: [...p.sources], queue: p.preferences.queue ?? "open", reviewLanguage: p.preferences.reviewLanguage ?? "" } : null;
}
async function signIn() {
  busy.value = true;
  error.value = null;
  try {
    const res = await fetch("/api/moderator", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: key.value }) });
    if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Sign-in failed.");
    key.value = "";
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function signOut() {
  await fetch("/api/moderator", { method: "DELETE" });
  await load();
}
async function save() {
  if (!draft.value) return;
  busy.value = true;
  error.value = null;
  saved.value = null;
  try {
    const d = draft.value;
    const res = await fetch("/api/moderator/me", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ display_name: d.display_name, languages: d.languages, sources: d.sources, preferences: { queue: d.queue, ...(d.reviewLanguage ? { reviewLanguage: d.reviewLanguage } : {}) } }),
    });
    if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Couldn't save.");
    saved.value = "Saved.";
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : "—");
onMounted(load);
</script>

<template>
  <div class="space-y-6">
    <p v-if="error" role="alert" class="rounded-md bg-danger/10 px-4 py-3 text-sm text-red-800">{{ error }}</p>

    <form v-if="signedOut" class="card flex flex-wrap items-center gap-2 p-5 text-sm" @submit.prevent="signIn">
      <KeyRound class="size-4 text-gray-500" aria-hidden="true" />
      <label for="mod-key">Your moderator key</label>
      <input id="mod-key" v-model="key" type="password" autocomplete="current-password" required class="input max-w-sm" placeholder="yaxb_mod_…" />
      <button type="submit" class="btn-primary" :disabled="busy">Sign in</button>
    </form>

    <template v-else-if="me">
      <section class="card flex flex-wrap items-start justify-between gap-3 p-5">
        <div>
          <h2 class="text-lg font-semibold text-ink">{{ me.profile?.display_name ?? me.moderator.name }}</h2>
          <p class="text-sm text-gray-600 capitalize">{{ me.moderator.roles.join(", ") }}<template v-if="me.moderator.label"> · {{ me.moderator.label }}</template></p>
          <p v-if="!me.moderator.shared" class="mt-1 text-xs text-gray-500">
            Key {{ me.moderator.key_prefix }} · {{ me.moderator.expires_at ? `expires ${new Date(me.moderator.expires_at).toLocaleDateString()}` : "doesn't expire" }} · {{ me.moderator.reviews ?? 0 }} reviews
          </p>
        </div>
        <div class="flex gap-2">
          <RouterLink to="/kiosk/curate" class="btn-light">Moderation queue</RouterLink>
          <RouterLink to="/kiosk/team" class="btn-light">Team</RouterLink>
          <button type="button" class="btn-light" @click="signOut"><LogOut class="size-4" aria-hidden="true" /> Sign out</button>
        </div>
      </section>

      <section v-if="me.moderator.shared" class="card p-5 text-sm text-gray-600">You're signed in with the shared moderator token. Ask the administrator for your own key to have a profile and your own activity.</section>

      <form v-else-if="draft" class="card space-y-4 p-5" @submit.prevent="save">
        <h3 class="font-semibold text-ink">Your profile</h3>
        <div>
          <label for="mp-name" class="mb-1 block text-sm font-medium text-ink">Display name</label>
          <input id="mp-name" v-model="draft.display_name" class="input max-w-sm" required maxlength="60" />
        </div>
        <fieldset>
          <legend class="mb-1 text-sm font-medium text-ink">Languages you review in</legend>
          <div class="flex flex-wrap gap-x-4 gap-y-1">
            <label v-for="l in LANGUAGES" :key="l.code" class="inline-flex items-center gap-1.5 text-sm"><input v-model="draft.languages" type="checkbox" :value="l.code" class="size-4 accent-brand" />{{ l.label }}</label>
          </div>
        </fieldset>
        <fieldset>
          <legend class="mb-1 text-sm font-medium text-ink">Knowledge sources you look after</legend>
          <div class="grid gap-1 @lg:grid-cols-2">
            <label v-for="s in sources.data.value?.sources ?? []" :key="s.id" class="inline-flex items-center gap-1.5 text-sm"><input v-model="draft.sources" type="checkbox" :value="s.id" class="size-4 accent-brand" />{{ s.title }}</label>
          </div>
        </fieldset>
        <div class="grid gap-3 @lg:grid-cols-2">
          <div>
            <label for="mp-queue" class="mb-1 block text-sm font-medium text-ink">Moderation queue shows</label>
            <select id="mp-queue" v-model="draft.queue" class="input"><option value="open">Open items</option><option value="all">Everything</option></select>
          </div>
          <div>
            <label for="mp-lang" class="mb-1 block text-sm font-medium text-ink">Review language</label>
            <select id="mp-lang" v-model="draft.reviewLanguage" class="input"><option value="">As asked</option><option v-for="l in LANGUAGES" :key="l.code" :value="l.code">{{ l.label }}</option></select>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <button type="submit" class="btn-primary" :disabled="busy">Save</button>
          <span v-if="saved" role="status" class="text-sm text-ink">{{ saved }}</span>
        </div>
      </form>

      <section v-if="!me.moderator.shared" class="card p-5">
        <h3 class="font-semibold text-ink">Your activity</h3>
        <p class="mt-1 mb-3 text-sm text-gray-500">Your sign-ins, reviews and profile changes. Never what you reviewed.</p>
        <p v-if="!me.activity.length" class="text-sm text-gray-500">Nothing yet.</p>
        <ol v-else class="divide-y divide-gray-100 text-sm">
          <li v-for="e in me.activity" :key="e.id" class="flex flex-wrap items-baseline justify-between gap-x-4 py-2">
            <span class="text-ink">{{ AUDIT_ACTIONS[e.action] ?? e.action }}</span>
            <time :datetime="e.at" class="text-xs text-gray-500">{{ when(e.at) }}</time>
          </li>
        </ol>
      </section>
    </template>
  </div>
</template>
