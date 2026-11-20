<script setup lang="ts">
// For staff → Attendance (ATT-2..5): the report over check-in events (weekly or monthly, with CSV),
// and the roster as a grid (employees, departments, shifts; PINs set, never shown; QR tokens). The
// roster is service data on the box (sync v2).
import { hashPin, newQr, PIN, reportCsv, rosterCsv, rosterProblems, rosterReport, type CheckEvent, type CheckOutcome, type Employee, type Roster } from "@sekaran-ind/yaxb-core/attendance";
import { ConfirmAction } from "@sekaran-ind/yaxb-journeys/vue";
import { Download, Plus } from "@lucide/vue";
import { computed, onMounted, ref, watch } from "vue";
import SegmentedControl from "@/components/site/SegmentedControl.vue";
import { roster, saveRoster } from "@/composables/attendance";
import { askText } from "@/composables/dialog";
import { catalogue, loadCatalogue } from "@/composables/library";
import { loadEvents } from "@/composables/service-events";
import { cn } from "@/lib/cn";

type Tab = "report" | "roster";
const tab = ref<Tab>("report");
const TABS = [
  { value: "report" as const, label: "Report" },
  { value: "roster" as const, label: "Roster" },
];
const error = ref<string | null>(null);
const notice = ref<string | null>(null);

// ---- the report (ATT-3) ----
const entry = computed(() => catalogue.value.find((s) => s.id === "attendance")?.entry_id ?? null);
type Period = "this-week" | "last-week" | "this-month";
const period = ref<Period>("this-week");
const PERIODS = [
  { value: "this-week" as const, label: "This week" },
  { value: "last-week" as const, label: "Last week" },
  { value: "this-month" as const, label: "This month" },
];
const day = (d: Date) => d.toISOString().slice(0, 10);
const range = computed(() => {
  const now = new Date(Date.now() + 330 * 60_000);
  const monday = new Date(now.getTime() - ((now.getUTCDay() + 6) % 7) * 86400_000);
  if (period.value === "this-month") return { from: `${day(now).slice(0, 8)}01`, to: day(now) };
  const start = period.value === "last-week" ? new Date(monday.getTime() - 7 * 86400_000) : monday;
  return { from: day(start), to: day(new Date(start.getTime() + 6 * 86400_000)) };
});
const events = ref<CheckEvent[]>([]);
const loading = ref(false);
async function loadReport() {
  if (!entry.value) return;
  loading.value = true;
  error.value = null;
  try {
    const all = await loadEvents(entry.value, `${range.value.from}T00:00:00Z`);
    events.value = all
      .filter((e) => e.kind === "journey.outcome" && e.actor && (e.outcome === "attendance.in" || e.outcome === "attendance.late" || e.outcome === "attendance.out"))
      .map((e) => ({ at: e.at, employee: e.actor!, outcome: e.outcome as CheckOutcome }));
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
const report = computed(() => rosterReport(roster.value, events.value, range.value.from, range.value.to));
watch([period, entry], () => void loadReport());
onMounted(async () => {
  await loadCatalogue();
  void loadReport();
});
const short = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString([], { weekday: "short", day: "numeric", timeZone: "UTC" });
function download(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---- the roster (ATT-2, ATT-4) ----
const draft = ref<Roster>(structuredClone(roster.value));
watch(roster, (r) => (draft.value = structuredClone(r)));
const problems = computed(() => rosterProblems(draft.value));
const changed = computed(() => JSON.stringify(draft.value) !== JSON.stringify(roster.value));
function save() {
  if (problems.value.length) return void (error.value = problems.value[0]!);
  saveRoster(draft.value);
  notice.value = "Saved. Every front desk gets it from the box.";
}
const addEmployee = () => draft.value.employees.push({ id: `e-${crypto.randomUUID().slice(0, 8)}`, name: "", department: draft.value.departments[0]?.id ?? null, shift: draft.value.shifts[0]?.id ?? null, pin_hash: null, qr: newQr(), active: true });
const addDepartment = () => draft.value.departments.push({ id: `d-${crypto.randomUUID().slice(0, 6)}`, name: "New department" });
const addShift = () => draft.value.shifts.push({ id: `s-${crypto.randomUUID().slice(0, 6)}`, name: "Day", start: "09:00", end: "18:00", grace: 10, days: [1, 2, 3, 4, 5, 6] });
async function setPin(e: Employee) {
  const pin = await askText({ title: `${e.name || "This employee"}'s PIN`, label: "4 to 6 digits (they type it to check in)", confirm: "Set the PIN", maxLength: 6 });
  if (pin === null) return;
  if (!PIN.test(pin)) return void (error.value = "A PIN is 4 to 6 digits.");
  e.pin_hash = await hashPin(e.id, pin);
  notice.value = `${e.name}'s PIN is set. Save the roster to use it.`;
}
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const toggleDay = (s: Roster["shifts"][number], d: number) => (s.days = s.days.includes(d) ? s.days.filter((x) => x !== d) : [...s.days, d].sort());

</script>

<template>
  <section class="space-y-4" aria-labelledby="att-h">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 id="att-h" class="text-lg font-semibold text-ink">Attendance</h2>
      <SegmentedControl :model-value="tab" :options="TABS" label="Attendance" @update:model-value="(v) => (tab = v as Tab)" />
    </div>
    <p v-if="error" role="alert" class="rounded-lg bg-danger/10 px-3 py-2 text-sm text-red-800">{{ error }}</p>
    <p v-if="notice" role="status" class="rounded-lg bg-success/10 px-3 py-2 text-sm text-ink">{{ notice }}</p>

    <template v-if="tab === 'report'">
      <p v-if="!entry" class="caution rounded-lg px-3 py-2 text-sm">Add the Attendance service to this kiosk (Quick tools → Services) and choose where it keeps its records (the box), so check-ins are counted here.</p>
      <div class="flex flex-wrap items-center gap-2">
        <SegmentedControl :model-value="period" :options="PERIODS" label="Period" @update:model-value="(v) => (period = v as Period)" />
        <button type="button" class="btn-light h-9 px-3 text-sm" :disabled="!report.rows.length" @click="download(`attendance-${range.from}-${range.to}.csv`, reportCsv(report))"><Download class="size-4" aria-hidden="true" /> Export CSV</button>
        <span v-if="loading" class="text-sm text-gray-500">Loading…</span>
      </div>
      <p v-if="!roster.employees.length" class="text-sm text-gray-600">The roster is empty: add employees under Roster.</p>
      <div v-else class="overflow-x-auto rounded-xl ring-1 ring-gray-100">
        <table class="w-full min-w-[640px] text-left text-sm">
          <thead class="bg-mist text-xs text-gray-600">
            <tr>
              <th class="px-3 py-2 font-medium">Employee</th>
              <th v-for="d in report.days" :key="d" class="px-2 py-2 font-medium whitespace-nowrap">{{ short(d) }}</th>
              <th class="px-2 py-2 font-medium">Present</th>
              <th class="px-2 py-2 font-medium">Late</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in report.rows" :key="r.employee" class="border-t border-gray-100">
              <td class="px-3 py-2 text-ink">{{ r.name }}<span class="block text-xs text-gray-500">{{ r.department }}</span></td>
              <td v-for="d in report.days" :key="d" :class="cn('px-2 py-2 text-xs whitespace-nowrap', r.cells[d]?.late ? 'text-red-800' : 'text-body')">
                <template v-if="r.cells[d]">{{ r.cells[d]!.first_in ?? "—" }}–{{ r.cells[d]!.last_out ?? "" }}<span v-if="r.cells[d]!.late" class="block">late</span></template>
              </td>
              <td class="px-2 py-2">{{ r.present }}</td>
              <td class="px-2 py-2">{{ r.late }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <template v-else>
      <div class="overflow-x-auto rounded-xl ring-1 ring-gray-100">
        <table class="w-full min-w-[720px] text-left text-sm">
          <thead class="bg-mist text-xs text-gray-600">
            <tr><th class="px-3 py-2 font-medium">Name</th><th class="px-2 font-medium">Department</th><th class="px-2 font-medium">Shift</th><th class="px-2 font-medium">PIN</th><th class="px-2 font-medium">Card QR</th><th class="px-2 font-medium">Active</th><th class="sr-only">Remove</th></tr>
          </thead>
          <tbody>
            <tr v-for="(e, i) in draft.employees" :key="e.id" class="border-t border-gray-100">
              <td class="px-2 py-1"><input v-model="e.name" class="input h-9" :aria-label="`Name ${i + 1}`" maxlength="80" /></td>
              <td class="px-2"><select v-model="e.department" class="input h-9" :aria-label="`${e.name}'s department`"><option :value="null">—</option><option v-for="d in draft.departments" :key="d.id" :value="d.id">{{ d.name }}</option></select></td>
              <td class="px-2"><select v-model="e.shift" class="input h-9" :aria-label="`${e.name}'s shift`"><option :value="null">—</option><option v-for="s in draft.shifts" :key="s.id" :value="s.id">{{ s.name }}</option></select></td>
              <td class="px-2"><button type="button" class="btn-ghost h-8 px-2 text-xs" @click="setPin(e)">{{ e.pin_hash ? "Change" : "Set PIN" }}</button></td>
              <td class="px-2 font-mono text-xs text-gray-600">{{ e.qr.slice(0, 8) }}…<button type="button" class="btn-ghost ml-1 h-7 px-1 text-xs" :aria-label="`New card for ${e.name}`" @click="e.qr = newQr()">New</button></td>
              <td class="px-2"><input v-model="e.active" type="checkbox" class="size-4 accent-brand" :aria-label="`${e.name} is active`" /></td>
              <td class="px-2"><ConfirmAction label="Remove" :message="`Remove ${e.name || 'this employee'} from the roster?`" trigger-class="btn-ghost h-8 px-2 text-xs" @confirm="draft.employees.splice(i, 1)" /></td>
            </tr>
          </tbody>
        </table>
      </div>
      <button type="button" class="btn-light h-9 px-3 text-sm" @click="addEmployee"><Plus class="size-4" aria-hidden="true" /> Add an employee</button>

      <div class="grid gap-4 @2xl:grid-cols-2">
        <fieldset class="space-y-2">
          <legend class="text-sm font-semibold text-ink">Departments</legend>
          <div v-for="d in draft.departments" :key="d.id" class="flex gap-2"><input v-model="d.name" class="input h-9" :aria-label="`Department ${d.name}`" maxlength="60" /></div>
          <button type="button" class="btn-ghost h-8 px-2 text-sm" @click="addDepartment"><Plus class="size-4" aria-hidden="true" /> Add</button>
        </fieldset>
        <fieldset class="space-y-2">
          <legend class="text-sm font-semibold text-ink">Shifts</legend>
          <div v-for="s in draft.shifts" :key="s.id" class="space-y-1 rounded-lg bg-mist p-2">
            <div class="flex flex-wrap items-center gap-2">
              <input v-model="s.name" class="input h-9 w-32" :aria-label="`Shift ${s.name}`" maxlength="40" />
              <input v-model="s.start" type="time" class="input h-9 w-28" :aria-label="`${s.name} starts`" />
              <input v-model="s.end" type="time" class="input h-9 w-28" :aria-label="`${s.name} ends`" />
              <label class="text-xs text-gray-600">Late after <input v-model.number="s.grace" type="number" min="0" max="240" class="input inline h-9 w-16" /> min</label>
            </div>
            <div class="flex flex-wrap gap-1">
              <button v-for="(n, d) in DAYS" :key="n" type="button" :aria-pressed="s.days.includes(d)" :class="cn('h-7 rounded-full px-2 text-xs', s.days.includes(d) ? 'bg-brand-dark text-on-brand' : 'bg-surface text-gray-600 ring-1 ring-gray-200')" @click="toggleDay(s, d)">{{ n }}</button>
            </div>
          </div>
          <button type="button" class="btn-ghost h-8 px-2 text-sm" @click="addShift"><Plus class="size-4" aria-hidden="true" /> Add</button>
        </fieldset>
      </div>
      <p v-if="problems.length" class="caution rounded-lg px-3 py-2 text-sm">{{ problems.join(" ") }}</p>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn-primary" :disabled="!changed" @click="save">Save the roster</button>
        <button type="button" class="btn-light" :disabled="!roster.employees.length" @click="download('roster.csv', rosterCsv(roster))"><Download class="size-4" aria-hidden="true" /> Export the roster</button>
      </div>
    </template>

  </section>
</template>
