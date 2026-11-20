<script setup lang="ts">
// Administration → Business links (DEP-2, DEP-4, DEP-5): ask another business to let this one use some
// of its services as a dependency, or, when asked, choose which journeys the other may use and the
// shape it accepts (an Order or an Invoice). Only those values cross, the other business keeps the
// request in its own list, and both sides' audit logs record each change.
import { LINK_SHAPES, type BusinessLink, type LinkOffer, type LinkShape } from "@sekaran-ind/yaxb-core/links";
import { ConfirmAction } from "@sekaran-ind/yaxb-journeys/vue";
import { Handshake, Loader2 } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { api } from "@/lib/api";
import { errorText, useApiMutation, useApiQuery } from "@/lib/queries";

type Offerable = { service: string; service_title: string; journey: string; journey_title: string };
const query = useApiQuery<{ me: string; links: BusinessLink[]; offerable: Offerable[] }>(["links"], "/api/links");
const me = computed(() => query.data.value?.me ?? "");
const links = computed(() => query.data.value?.links ?? []);
const offerable = computed(() => query.data.value?.offerable ?? []);
const business = ref("");
/** The offers being chosen, per link: "service/journey" → the shape accepted ("" for not offered). */
const draft = ref<Record<string, Record<string, LinkShape | "">>>({});

const keyOf = (o: { service: string; journey: string }) => `${o.service}/${o.journey}`;
// What the server holds is the starting point each time it is read again.
watch(
  () => query.data.value,
  (r) => {
    if (!r) return;
    for (const l of r.links)
      if (l.provider === r.me && l.status !== "ended") draft.value[l.id] = Object.fromEntries(r.offerable.map((o) => [keyOf(o), l.offers.find((x) => keyOf(x) === keyOf(o))?.accepts ?? ""]));
  },
  { immediate: true },
);

const chosen = (id: string): LinkOffer[] =>
  Object.entries(draft.value[id] ?? {})
    .filter(([, shape]) => shape)
    .map(([k, shape]) => ({ service: k.split("/")[0]!, journey: k.split("/")[1]!, accepts: shape as LinkShape }));
const invite = useApiMutation((name: string) => api("/api/links", { business: name }), [["links"]]);
const accept = useApiMutation((l: BusinessLink) => api(`/api/links/${l.id}/accept`, { offers: chosen(l.id) }), [["links"]]);
const save = useApiMutation((l: BusinessLink) => api(`/api/links/${l.id}/offers`, { offers: chosen(l.id) }, "PUT"), [["links"]]);
const end = useApiMutation((l: BusinessLink) => api(`/api/links/${l.id}/end`, {}), [["links"]]);
const busy = computed(() => [invite, accept, save, end].some((m) => m.isPending.value));
const error = computed(() => errorText(query.error.value, invite.error.value, accept.error.value, save.error.value, end.error.value));
const ask = () => invite.mutate(business.value.trim(), { onSuccess: () => (business.value = "") });

const asking = computed(() => links.value.filter((l) => l.status === "invited" && l.provider === me.value));
const waiting = computed(() => links.value.filter((l) => l.status === "invited" && l.requester === me.value));
const active = computed(() => links.value.filter((l) => l.status === "active"));
const ended = computed(() => links.value.filter((l) => l.status === "ended").slice(0, 5));
const other = (l: BusinessLink) => (l.requester === me.value ? l.provider_name : l.requester_name);
const when = (iso: string) => new Date(iso).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
</script>

<template>
  <section class="card space-y-4 p-5" aria-labelledby="links-title">
    <div>
      <h3 id="links-title" class="flex items-center gap-2 font-semibold text-ink"><Handshake class="size-4 text-brand" aria-hidden="true" /> Business links</h3>
      <p class="mt-1 text-sm text-gray-500">
        Let another business's service be a step in yours (or the other way round). Only the values a screen names go over, shaped as an Order or an Invoice, and only for a journey the business that provides it has offered. Their request stays in their own list; only how it ended comes back. Both businesses' audit logs record every change.
      </p>
    </div>
    <p v-if="error" role="alert" class="text-sm text-red-800">{{ error }}</p>

    <form class="flex flex-wrap items-end gap-2" @submit.prevent="ask">
      <label class="block min-w-48 flex-1 text-sm"><span class="mb-1 block font-medium text-ink">Ask a business to let you use its services</span>
        <input v-model="business" class="input" placeholder="Its short name, such as parts-co" maxlength="48" autocomplete="off" required />
      </label>
      <button type="submit" class="btn-primary h-10" :disabled="busy || !business.trim()"><Loader2 v-if="busy" class="size-4 animate-spin" aria-hidden="true" /> Ask</button>
    </form>

    <div v-if="asking.length" class="space-y-2">
      <h4 class="text-sm font-semibold text-ink">Asking to use your services ({{ asking.length }})</h4>
      <div v-for="l in asking" :key="l.id" class="space-y-2 rounded-xl bg-mist p-3">
        <p class="font-medium text-ink">{{ l.requester_name }} <span class="text-xs font-normal text-gray-500">asked {{ when(l.created_at) }}</span></p>
        <p v-if="!offerable.length" class="text-sm text-gray-600">You have no published services to offer yet.</p>
        <ul v-else class="space-y-1">
          <li v-for="o in offerable" :key="keyOf(o)" class="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span class="text-body">{{ o.service_title }} · {{ o.journey_title }}</span>
            <select v-model="draft[l.id]![keyOf(o)]" class="input h-9 w-auto" :aria-label="`${o.service_title}, ${o.journey_title}`">
              <option value="">Not offered</option>
              <option v-for="s in LINK_SHAPES" :key="s" :value="s">Accept an {{ s }}</option>
            </select>
          </li>
        </ul>
        <div class="flex gap-2">
          <button type="button" class="btn-primary h-9 text-sm" :disabled="busy" @click="accept.mutate(l)">Accept</button>
          <ConfirmAction label="Decline" :message="`Decline ${l.requester_name}'s request?`" trigger-class="btn-ghost h-9 text-sm" @confirm="end.mutate(l)" />
        </div>
      </div>
    </div>

    <ul v-if="waiting.length" class="space-y-1 text-sm text-gray-600">
      <li v-for="l in waiting" :key="l.id" class="flex flex-wrap items-center justify-between gap-2">
        <span>Waiting for {{ l.provider_name }} to answer (asked {{ when(l.created_at) }})</span>
        <ConfirmAction label="Withdraw" :message="`Withdraw your request to ${l.provider_name}?`" trigger-class="btn-ghost h-8 text-sm" @confirm="end.mutate(l)" />
      </li>
    </ul>

    <div v-if="active.length" class="space-y-2">
      <h4 class="text-sm font-semibold text-ink">Active</h4>
      <div v-for="l in active" :key="l.id" class="space-y-2 rounded-xl bg-mist p-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="font-medium text-ink">{{ other(l) }} <span class="text-xs font-normal text-gray-500">· {{ l.requester === me ? "you use their services" : "they use yours" }} · agreement {{ l.consent_version }}</span></p>
          <ConfirmAction label="End link" :message="`End the link with ${other(l)}? New requests stop at once; ones already started carry on.`" trigger-class="btn-ghost h-8 text-sm" @confirm="end.mutate(l)" />
        </div>
        <template v-if="l.provider === me">
          <ul class="space-y-1">
            <li v-for="o in offerable" :key="keyOf(o)" class="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span class="text-body">{{ o.service_title }} · {{ o.journey_title }}</span>
              <select v-model="draft[l.id]![keyOf(o)]" class="input h-9 w-auto" :aria-label="`${o.service_title}, ${o.journey_title}`">
                <option value="">Not offered</option>
                <option v-for="s in LINK_SHAPES" :key="s" :value="s">Accept an {{ s }}</option>
              </select>
            </li>
          </ul>
          <button type="button" class="btn-light h-9 text-sm" :disabled="busy" @click="save.mutate(l)">Save what is offered</button>
        </template>
        <ul v-else class="list-inside list-disc text-sm text-body">
          <li v-for="o in l.offers" :key="keyOf(o)">{{ o.service }} · {{ o.journey }} (an {{ o.accepts }}): <code class="text-xs">uses: { business: {{ l.provider_name.toLowerCase().replace(/\s+/g, "-") }}, service: {{ o.service }}, journey: {{ o.journey }}, as: {{ o.accepts }} }</code></li>
          <li v-if="!l.offers.length" class="list-none text-gray-600">Nothing is offered right now.</li>
        </ul>
      </div>
    </div>

    <ul v-if="ended.length" class="text-sm text-gray-600">
      <li v-for="l in ended" :key="l.id">{{ other(l) }} · ended {{ l.ended_at ? when(l.ended_at) : "" }}<template v-if="l.ended_by"> by {{ l.ended_by }}</template></li>
    </ul>
    <p v-if="query.isPending.value" class="text-sm text-gray-500">Loading…</p>
    <p v-else-if="!links.length && !error" class="text-sm text-gray-500">No links yet.</p>
  </section>
</template>
