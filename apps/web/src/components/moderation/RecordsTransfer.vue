<script setup lang="ts">
// Administration → Records: what this business's services captured (cases, their events and service
// events) out as a file, and back in. Services and their settings stay on the server and aren't in the
// file; on another site, add the services first and the import matches each row to its service. On the
// free plan an import is a sync (a few a year) and starts each case's 30 days again.
import { Download, Loader2, Upload } from "@lucide/vue";
import { computed, ref } from "vue";
import { catalogue } from "@/composables/library";
import { useCapabilities } from "@/composables/settings";
import { api } from "@/lib/api";
import { errorText, useApiQuery } from "@/lib/queries";

type Report = { added: Record<string, number>; already: Record<string, number>; expired: number; missingServices: string[] };
type Allowance = { limit: number | null; left: number | null; freeAgainAt: string | null };

const { data: caps } = useCapabilities();
const allowance = useApiQuery<Allowance>(["sync", "allowance"], "/api/sync/allowance");
const free = computed(() => caps.value?.plan === "free");
const service = ref("");
const busy = ref<"export" | "import" | null>(null);
const error = ref<string | null>(null);
const report = ref<Report | null>(null);

async function download() {
  busy.value = "export";
  error.value = null;
  try {
    const r = await fetch(`/api/records/export${service.value ? `?service=${encodeURIComponent(service.value)}` : ""}`, { credentials: "same-origin" });
    if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? "The export failed.");
    const url = URL.createObjectURL(await r.blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: `yaxb-records-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = null;
  }
}

async function upload(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  busy.value = "import";
  error.value = null;
  report.value = null;
  try {
    const body = JSON.parse(await file.text()) as unknown;
    report.value = (await api<{ report: Report }>("/api/records/import", body)).report;
    await allowance.refetch();
  } catch (e) {
    error.value = e instanceof SyntaxError ? "That file isn't a records file (it isn't JSON)." : errorText(e);
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <section class="card space-y-3 p-5" aria-labelledby="records-title">
    <h3 id="records-title" class="font-semibold text-ink">Records: export and import</h3>
    <p class="text-sm text-gray-500">
      What your services captured (requests, their history and service events) as a file, and back in. Your services and their settings stay on the server and aren't in the file. The file holds what people gave, so keep it as safely as the records themselves.
    </p>
    <div class="flex flex-wrap items-end gap-2">
      <label class="block min-w-48 flex-1 text-sm">
        <span class="mb-1 block font-medium text-ink">Service</span>
        <select v-model="service" class="input"><option value="">All services</option><option v-for="s in catalogue" :key="s.entry_id" :value="s.entry_id">{{ s.title }}</option></select>
      </label>
      <button type="button" class="btn-light h-10" :disabled="busy !== null" @click="download"><Loader2 v-if="busy === 'export'" class="size-4 animate-spin" aria-hidden="true" /><Download v-else class="size-4" aria-hidden="true" /> Export</button>
      <label :class="['btn-light h-10 cursor-pointer', busy !== null && 'pointer-events-none opacity-60']">
        <Loader2 v-if="busy === 'import'" class="size-4 animate-spin" aria-hidden="true" /><Upload v-else class="size-4" aria-hidden="true" /> Import a file
        <input type="file" accept="application/json,.json" class="sr-only" :disabled="busy !== null" @change="upload" />
      </label>
    </div>
    <p v-if="free" class="caution px-3 py-2 text-sm">
      On the free plan an import is a sync: it starts each request's 30 days again and uses one of your {{ allowance.data.value?.limit ?? 5 }} a year<template v-if="allowance.data.value?.left !== undefined && allowance.data.value?.left !== null"> ({{ allowance.data.value.left }} left)</template>. Records older than 30 days aren't brought in.
    </p>
    <p v-if="error" role="alert" class="text-sm text-red-800">{{ error }}</p>
    <div v-if="report" role="status" class="rounded-lg bg-mist px-3 py-2 text-sm text-body">
      <p class="font-medium text-ink">Imported {{ report.added.cases }} requests, {{ report.added.case_events }} history entries and {{ report.added.service_events }} service events.</p>
      <p v-if="report.already.cases + report.already.case_events + report.already.service_events" class="text-xs text-gray-600">{{ report.already.cases + report.already.case_events + report.already.service_events }} were already here and left as they were.</p>
      <p v-if="report.expired" class="text-xs text-gray-600">{{ report.expired }} were past how long they may be kept here and weren't brought in.</p>
      <p v-if="report.missingServices.length" class="caution mt-1 px-2 py-1 text-xs">Not brought in, because this site has no such service: {{ report.missingServices.join(", ") }}. Add the service, then import again.</p>
    </div>
  </section>
</template>
