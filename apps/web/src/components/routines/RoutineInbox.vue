<script setup lang="ts">
// What routines left for this member's roles (RTN-1, RTN-6): notices to read and mark done, and
// actions waiting for their approval (a message, a connector call or a webhook, shown as it will be
// sent), to approve or decline. One member deciding is enough; the first decision counts. Used in
// My work and in Family's Preferences → Routines.
import type { RoutineApproval, RoutineNotice } from "@sekaran-ind/yaxb-core/routines";
import { ConfirmAction } from "@sekaran-ind/yaxb-journeys/vue";
import { BellRing, Check, ShieldQuestion, X } from "@lucide/vue";
import { onMounted, ref, watch } from "vue";
import { roleName } from "@/composables/library";
import { api } from "@/lib/api";

const emit = defineEmits<{ count: [n: number] }>();
const notices = ref<RoutineNotice[]>([]);
const approvals = ref<RoutineApproval[]>([]);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const busy = ref<string | null>(null);

async function load() {
  const [n, a] = await Promise.all([
    api<{ items: RoutineNotice[] }>("/api/routines/notices").catch(() => ({ items: [] as RoutineNotice[] })),
    api<{ items: RoutineApproval[] }>("/api/routines/approvals").catch(() => ({ items: [] as RoutineApproval[] })),
  ]);
  notices.value = n.items;
  approvals.value = a.items;
}
onMounted(load);
watch([notices, approvals], () => emit("count", notices.value.length + approvals.value.length));
defineExpose({ load });

const when = (iso: string) => new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
/** What will be sent, in words: the message, or the address and the values. */
function what(a: RoutineApproval): string {
  const p = a.payload;
  if (a.type === "message") return `To ${roleName(p.to ?? "")}: “${p.text ?? ""}”`;
  if (a.type === "connector") return `${p.call} with ${JSON.stringify(p.input ?? {})}`;
  const body = (p.body ?? {}) as { data?: unknown };
  return `To ${p.url ? new URL(p.url).host : "?"}: ${JSON.stringify(body.data ?? {})}`;
}

async function done(n: RoutineNotice) {
  error.value = null;
  try {
    await api(`/api/routines/notices/${n.id}/done`, {});
    notices.value = notices.value.filter((x) => x.id !== n.id);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
async function decide(a: RoutineApproval, decision: "approved" | "declined") {
  busy.value = a.id;
  error.value = notice.value = null;
  try {
    const out = await api<{ sent: { ok: boolean; note: string } | null }>(`/api/routines/approvals/${a.id}`, { decision });
    notice.value = decision === "declined" ? "Declined: nothing was sent." : out.sent?.ok ? "Approved and sent." : `Approved, but it wasn't sent: ${out.sent?.note ?? ""}`;
    approvals.value = approvals.value.filter((x) => x.id !== a.id);
  } catch (e) {
    error.value = (e as Error).message;
    void load();
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <div v-if="notices.length || approvals.length || notice || error" class="space-y-4">
    <p v-if="error" role="alert" class="text-sm text-red-800">{{ error }}</p>
    <p v-if="notice" role="status" class="rounded-lg bg-mist px-3 py-2 text-sm text-ink">{{ notice }}</p>

    <div v-if="approvals.length" class="space-y-2">
      <h3 class="flex items-center gap-2 font-semibold text-ink"><ShieldQuestion class="size-4 text-brand" aria-hidden="true" /> Waiting for your approval <span class="text-sm font-normal text-gray-500">{{ approvals.length }}</span></h3>
      <ul class="space-y-2">
        <li v-for="a in approvals" :key="a.id" class="card space-y-2 p-3">
          <p class="text-sm text-ink"><span class="font-semibold">{{ a.routine_title }}</span> wants to send this:</p>
          <p class="rounded-lg bg-mist px-3 py-2 text-sm break-words text-ink">{{ what(a) }}</p>
          <p class="text-xs text-gray-500">For {{ roleName(a.role) }} to approve · {{ when(a.created_at) }}</p>
          <div class="flex flex-wrap gap-2">
            <ConfirmAction label="Approve" confirm-label="Approve and send" :message="`Send this now? ${what(a)}`" trigger-class="btn-primary h-9 px-3 text-sm" :busy="busy === a.id" @confirm="decide(a, 'approved')">
              <Check class="size-4" aria-hidden="true" /> Approve
            </ConfirmAction>
            <button type="button" class="btn-light h-9 px-3 text-sm" :disabled="busy === a.id" @click="decide(a, 'declined')"><X class="size-4" aria-hidden="true" /> Decline</button>
          </div>
        </li>
      </ul>
    </div>

    <div v-if="notices.length" class="space-y-2">
      <h3 class="flex items-center gap-2 font-semibold text-ink"><BellRing class="size-4 text-brand" aria-hidden="true" /> Notices <span class="text-sm font-normal text-gray-500">{{ notices.length }}</span></h3>
      <ul class="space-y-2">
        <li v-for="n in notices" :key="n.id" class="card flex items-start justify-between gap-3 p-3">
          <div class="min-w-0">
            <p class="text-sm whitespace-pre-line text-ink">{{ n.text }}</p>
            <p class="text-xs text-gray-500">For {{ roleName(n.role) }} · {{ when(n.created_at) }}</p>
          </div>
          <button type="button" class="btn-light h-8 shrink-0 px-2 text-sm" :aria-label="`Mark done: ${n.text.slice(0, 60)}`" @click="done(n)"><Check class="size-4" aria-hidden="true" /> Done</button>
        </li>
      </ul>
    </div>
  </div>
</template>
