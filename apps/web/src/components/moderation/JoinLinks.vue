<script setup lang="ts">
// Administration → Join links (TEN-4..7): a link for a role to share with someone joining this
// business; the people who asked to join, to accept (with a role) or decline. The link shows once.
import type { JoinRequest, JoinToken } from "@sekaran-ind/yaxb-core/tenants";
import { ConfirmAction } from "@sekaran-ind/yaxb-journeys/vue";
import { Copy, Link2, Loader2, UserPlus } from "@lucide/vue";
import { computed, ref } from "vue";
import { api } from "@/lib/api";
import { errorText, useApiMutation, useApiQuery } from "@/lib/queries";
import { roleName } from "@/composables/library";

const props = defineProps<{ roles: readonly string[] }>();
const tenantQuery = useApiQuery<{ tenant: { name: string; slug: string } | null }>(["join", "tenant"], "/api/tenant");
const linksQuery = useApiQuery<{ links: JoinToken[] }>(["join", "links"], "/api/tenant/join-links");
const requestsQuery = useApiQuery<{ requests: JoinRequest[] }>(["join", "requests"], "/api/tenant/join-requests");
const tenant = computed(() => tenantQuery.data.value?.tenant ?? null);
const links = computed(() => linksQuery.data.value?.links ?? []);
const requests = computed(() => requestsQuery.data.value?.requests ?? []);
const form = ref({ role: props.roles[0] ?? "moderator", hours: 72, uses: 1, label: "" });
const made = ref<string | null>(null);
const copied = ref(false);
const choose = ref<Record<string, string>>({});

const issue = useApiMutation(
  async () => (await api<{ link: string }>("/api/tenant/join-links", { ...form.value, label: form.value.label.trim() || undefined })).link,
  [["join", "links"]],
);
const withdraw = useApiMutation((id: string) => api(`/api/tenant/join-links/${id}`, undefined, "DELETE"), [["join", "links"]]);
const decideRequest = useApiMutation((v: { r: JoinRequest; decision: "accept" | "decline" }) => api(`/api/tenant/join-requests/${v.r.id}/decide`, { decision: v.decision, role: choose.value[v.r.id] ?? v.r.role }), [["join", "requests"]]);
const busy = computed(() => issue.isPending.value);
const error = computed(() => errorText(tenantQuery.error.value, linksQuery.error.value, requestsQuery.error.value, issue.error.value, withdraw.error.value, decideRequest.error.value));
const make = () =>
  issue.mutate(undefined, {
    onSuccess: (link) => {
      made.value = link;
      copied.value = false;
    },
  });
async function copy() {
  if (!made.value) return;
  await navigator.clipboard?.writeText(made.value).catch(() => {});
  copied.value = true;
}
const decide = (r: JoinRequest, decision: "accept" | "decline") => decideRequest.mutate({ r, decision });
const pending = computed(() => requests.value.filter((r) => r.status === "pending"));
const decided = computed(() => requests.value.filter((r) => r.status !== "pending").slice(0, 10));
const open = computed(() => links.value.filter((l) => !l.revoked && l.uses_left > 0 && l.expires_at > new Date().toISOString()));
const when = (iso: string) => new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const STATUS: Record<JoinRequest["status"], string> = { pending: "Waiting", accepted: "Accepted: their key is ready for them", declined: "Declined", collected: "Joined" };
</script>

<template>
  <section class="card space-y-4 p-5" aria-labelledby="join-title">
    <div>
      <h3 id="join-title" class="flex items-center gap-2 font-semibold text-ink"><UserPlus class="size-4 text-brand" aria-hidden="true" /> Join links</h3>
      <p class="mt-1 text-sm text-gray-500">
        Send someone a link to join {{ tenant?.name ?? "this business" }} with a role. They give their name; you accept or decline here; once accepted, their own key appears on their screen, once.
      </p>
    </div>
    <p v-if="error" role="alert" class="text-sm text-red-800">{{ error }}</p>

    <form class="grid gap-3 @lg:grid-cols-[1fr_auto_auto] items-end" @submit.prevent="make">
      <label class="block text-sm"><span class="mb-1 block font-medium text-ink">Role</span>
        <select v-model="form.role" class="input"><option v-for="r in roles" :key="r" :value="r">{{ roleName(r) }}</option></select>
      </label>
      <label class="block text-sm"><span class="mb-1 block font-medium text-ink">Uses</span><input v-model.number="form.uses" type="number" min="1" max="50" class="input w-24" /></label>
      <label class="block text-sm"><span class="mb-1 block font-medium text-ink">Valid for (hours)</span><input v-model.number="form.hours" type="number" min="1" max="720" class="input w-28" /></label>
      <label class="block text-sm @lg:col-span-3"><span class="mb-1 block font-medium text-ink">Note <span class="font-normal text-gray-500">(optional, for you)</span></span><input v-model="form.label" class="input" maxlength="80" placeholder="Showroom staff" /></label>
      <button type="submit" class="btn-primary h-10 @lg:col-span-3 justify-self-start" :disabled="busy"><Loader2 v-if="busy" class="size-4 animate-spin" aria-hidden="true" /><Link2 v-else class="size-4" aria-hidden="true" /> Make a join link</button>
    </form>

    <div v-if="made" class="caution space-y-2 p-3 text-sm" role="status">
      <p class="font-medium text-ink">Share this link now: it isn't shown again.</p>
      <div class="flex flex-wrap items-center gap-2">
        <code class="min-w-0 flex-1 break-all rounded-lg bg-surface px-2 py-1 text-xs">{{ made }}</code>
        <button type="button" class="btn-light h-9 text-sm" @click="copy"><Copy class="size-4" aria-hidden="true" /> {{ copied ? "Copied" : "Copy" }}</button>
      </div>
    </div>

    <div v-if="pending.length" class="space-y-2">
      <h4 class="text-sm font-semibold text-ink">Asking to join ({{ pending.length }})</h4>
      <ul class="space-y-2">
        <li v-for="r in pending" :key="r.id" class="flex flex-wrap items-end justify-between gap-3 rounded-xl bg-mist p-3">
          <div class="min-w-0">
            <p class="font-medium text-ink">{{ r.name }}</p>
            <p class="text-xs text-gray-500">asked {{ when(r.created_at) }}</p>
          </div>
          <div class="flex flex-wrap items-end gap-2">
            <label class="text-sm"><span class="sr-only">Role for {{ r.name }}</span>
              <select :value="choose[r.id] ?? r.role" class="input h-9 w-auto" @change="choose[r.id] = ($event.target as HTMLSelectElement).value"><option v-for="x in roles" :key="x" :value="x">{{ roleName(x) }}</option></select>
            </label>
            <button type="button" class="btn-primary h-9 text-sm" @click="decide(r, 'accept')">Accept</button>
            <ConfirmAction label="Decline" :message="`Decline ${r.name}'s request to join?`" trigger-class="btn-ghost h-9 text-sm" @confirm="decide(r, 'decline')" />
          </div>
        </li>
      </ul>
    </div>

    <div v-if="open.length" class="space-y-1">
      <h4 class="text-sm font-semibold text-ink">Open links</h4>
      <ul class="divide-y divide-gray-100 text-sm">
        <li v-for="l in open" :key="l.id" class="flex flex-wrap items-center justify-between gap-2 py-2">
          <span class="text-body">{{ roleName(l.role) }}<template v-if="l.label"> · {{ l.label }}</template> · {{ l.uses_left }} use{{ l.uses_left === 1 ? "" : "s" }} left · until {{ when(l.expires_at) }}</span>
          <ConfirmAction label="Withdraw" :message="`Withdraw this ${roleName(l.role)} link? Nobody can join with it after.`" trigger-class="btn-ghost h-8 text-sm" @confirm="withdraw.mutate(l.id)" />
        </li>
      </ul>
    </div>

    <div v-if="decided.length" class="space-y-1">
      <h4 class="text-sm font-semibold text-ink">Recently decided</h4>
      <ul class="text-sm text-gray-600">
        <li v-for="r in decided" :key="r.id">{{ r.name }} · {{ roleName(r.role) }} · {{ STATUS[r.status] }}</li>
      </ul>
    </div>
  </section>
</template>
