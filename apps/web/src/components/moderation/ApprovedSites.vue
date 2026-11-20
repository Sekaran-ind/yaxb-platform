<script setup lang="ts">
// Approved sites (SIT-1..6) in Administration.
// - The platform's moderators (on the portal): open requests, merged by site and use with a count,
//   naming a business or "a family"; approve onto the platform catalogue (region, category, uses) or
//   reject; pause, resume or revoke entries. Whoever asked can't decide.
// - A business's administrator: its own list (uses other than run-time lookups), and switching a
//   platform site off for the business (never looser).
import { ConfirmAction } from "@sekaran-ind/yaxb-journeys/vue";
import { Globe } from "@lucide/vue";
import { onMounted, ref } from "vue";
import { api } from "@/lib/api";

type Site = { id: string; origin: string; paths: string[]; region: string; category: string; uses: string[]; status: string; approved_by: string; review_at: string };
type Request = { id: string; origin: string; use: string; reason: string | null; asked_by_label: string; count: number; created_at: string };
type Lists = { platform: Site[]; own: Site[]; requests: Request[]; moderator: boolean; administrator: boolean; enforce: boolean };
const USE: Record<string, string> = { source: "notebook source", link: "link to open", analyse: "analysed when designing", lookup: "looked up while a journey runs" };

const data = ref<Lists | null>(null);
const error = ref<string | null>(null);
const decide = ref<Record<string, { region: string; category: string }>>({});
const own = ref({ url: "", uses: ["source", "link"] as string[] });
async function load() {
  try {
    data.value = await api<Lists>("/api/sites");
  } catch (e) {
    error.value = (e as Error).message;
  }
}
onMounted(load);
async function act(fn: () => Promise<unknown>) {
  error.value = null;
  try {
    await fn();
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  }
}
const approve = (r: Request) => act(() => api(`/api/sites/requests/${r.id}/approve`, { region: decide.value[r.id]?.region || "IN", category: decide.value[r.id]?.category || "general", uses: [r.use] }));
const reject = (r: Request) => act(() => api(`/api/sites/requests/${r.id}/reject`, {}));
const status = (s: Site, st: string) => act(() => api(`/api/sites/${s.id}/status`, { status: st }));
const addOwn = () => act(async () => (await api("/api/sites/own", { url: own.value.url, uses: own.value.uses }), (own.value.url = "")));
const switchOff = (s: Site) => act(() => api("/api/sites/own", { url: s.origin, off: true }));
const host = (o: string) => o.replace(/^https:\/\//, "");
</script>

<template>
  <section v-if="data && (data.moderator || data.administrator)" class="card space-y-4 p-5" aria-labelledby="sites-h">
    <div>
      <h3 id="sites-h" class="flex items-center gap-2 font-semibold text-ink"><Globe class="size-5 text-brand" aria-hidden="true" /> Approved sites</h3>
      <p class="mt-1 text-sm text-gray-600">
        Every outside site Anjal reads comes from an approved list: the platform's, and this business's own.
        {{ data.enforce ? "A site that isn't on it is refused." : "For now a site that isn't on it is still added, flagged, and asked for." }}
      </p>
    </div>

    <template v-if="data.moderator">
      <h4 class="text-sm font-semibold text-ink">Requests ({{ data.requests.length }})</h4>
      <p v-if="!data.requests.length" class="text-sm text-gray-500">Nothing is waiting.</p>
      <ul v-else class="space-y-2">
        <li v-for="r in data.requests" :key="r.id" class="rounded-lg bg-mist p-3 text-sm">
          <p class="text-ink"><strong>{{ host(r.origin) }}</strong> as a {{ USE[r.use] ?? r.use }} · asked by {{ r.asked_by_label }}{{ r.count > 1 ? ` and ${r.count - 1} more` : "" }}</p>
          <p v-if="r.reason" class="text-gray-600">{{ r.reason }}</p>
          <div class="mt-2 flex flex-wrap items-end gap-2">
            <label class="text-xs"><span class="block text-gray-600">Region</span><input v-model="(decide[r.id] ??= { region: 'IN', category: 'general' }).region" class="input h-9 w-28" /></label>
            <label class="text-xs"><span class="block text-gray-600">Category</span><input v-model="(decide[r.id] ??= { region: 'IN', category: 'general' }).category" class="input h-9 w-36" /></label>
            <button type="button" class="btn-primary h-9 px-3 text-sm" @click="approve(r)">Approve</button>
            <button type="button" class="btn-ghost h-9 px-3 text-sm" @click="reject(r)">Reject</button>
          </div>
        </li>
      </ul>
    </template>

    <h4 class="text-sm font-semibold text-ink">The platform's list</h4>
    <p v-if="!data.platform.length" class="text-sm text-gray-500">No sites yet.</p>
    <ul v-else class="divide-y divide-gray-100 rounded-xl bg-surface ring-1 ring-gray-100">
      <li v-for="s in data.platform" :key="s.id" class="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
        <span class="min-w-0 flex-1"><span class="text-ink">{{ host(s.origin) }}</span><span class="block text-xs text-gray-500">{{ s.uses.map((u) => USE[u] ?? u).join(", ") }} · {{ s.region }} · {{ s.category }} · review by {{ s.review_at }}{{ s.status === "paused" ? " · paused" : "" }}</span></span>
        <template v-if="data.moderator">
          <button type="button" class="btn-ghost h-8 px-2 text-sm" @click="status(s, s.status === 'paused' ? 'active' : 'paused')">{{ s.status === "paused" ? "Resume" : "Pause" }}</button>
          <ConfirmAction label="Revoke" :message="`Revoke ${host(s.origin)} for everyone?`" trigger-class="btn-ghost h-8 px-2 text-sm text-red-700" @confirm="status(s, 'revoked')" />
        </template>
        <ConfirmAction v-else-if="data.administrator" label="Switch off here" :message="`Stop using ${host(s.origin)} in this business?`" trigger-class="btn-ghost h-8 px-2 text-sm" @confirm="switchOff(s)" />
      </li>
    </ul>

    <template v-if="data.administrator">
      <h4 class="text-sm font-semibold text-ink">This business's own sites</h4>
      <ul v-if="data.own.length" class="divide-y divide-gray-100 rounded-xl bg-surface ring-1 ring-gray-100">
        <li v-for="s in data.own" :key="s.id" class="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
          <span class="min-w-0 flex-1"><span class="text-ink">{{ host(s.origin) }}</span><span class="block text-xs text-gray-500">{{ s.status === "off" ? "switched off here" : s.uses.map((u) => USE[u] ?? u).join(", ") }}</span></span>
          <ConfirmAction v-if="s.status !== 'off'" label="Remove" :message="`Remove ${host(s.origin)} from this business's list?`" trigger-class="btn-ghost h-8 px-2 text-sm" @confirm="status(s, 'revoked')" />
          <button v-else type="button" class="btn-ghost h-8 px-2 text-sm" @click="status(s, 'revoked')">Switch back on</button>
        </li>
      </ul>
      <form class="flex flex-wrap items-end gap-2" @submit.prevent="addOwn">
        <label class="block text-sm"><span class="mb-1 block font-medium text-ink">Add a site</span><input v-model="own.url" class="input w-72" placeholder="https://supplier.example.com" /></label>
        <label v-for="u in ['source', 'link', 'analyse']" :key="u" class="inline-flex items-center gap-1 text-sm"><input v-model="own.uses" type="checkbox" :value="u" class="size-4 accent-brand" />{{ USE[u] }}</label>
        <button type="submit" class="btn-light h-10" :disabled="!own.url.trim() || !own.uses.length">Add</button>
      </form>
      <p class="text-xs text-gray-500">Looking things up on another site while a journey runs needs the platform's approval: ask for it from where the site is used.</p>
    </template>
    <p v-if="error" role="alert" class="text-sm text-red-800">{{ error }}</p>
  </section>
</template>
