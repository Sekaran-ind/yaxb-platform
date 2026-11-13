<script setup lang="ts">
// The open profile, the kiosk's counterpart of clinux-diary's Account panel and clinux-desk's
// activity log: what the answers suggest (apply / undo), the activity log (what happened, never
// what was said), the passphrase, export, sign out and erase.
import { ACTIVITY_ACTIONS, AGE_RANGES, INTEREST_DOMAINS, MIN_PASSPHRASE } from "@sekaran-ind/yaxb-core/accounts";
import { Download, LogOut, RotateCcw, Sparkles, Trash2 } from "@lucide/vue";
import { ConfirmAction } from "@sekaran-ind/yaxb-journeys/vue";
import { computed, ref } from "vue";
import { useAccount } from "@/composables/account";
import { languageLabel } from "@/lib/languages";
import AccountSetup from "./AccountSetup.vue";

const account = useAccount();
const editing = ref(false);
const pw = ref({ current: "", next: "", confirm: "", msg: "", err: "", busy: false });
const shown = ref(25);

const p = computed(() => account.profile.value!);
const ageLabel = computed(() => AGE_RANGES.find((a) => a.value === p.value.ageRange)?.label);
const journeysUsed = computed(() => account.activity.value.filter((e) => e.action === "journey.completed").length);
const questionsAsked = computed(() => account.activity.value.filter((e) => e.action === "question.asked").length);
const interests = computed(() => p.value.interests.map((i) => INTEREST_DOMAINS.find((d) => d.id === i)?.label ?? i));

function ago(at: string) {
  const s = Math.max(1, Math.round((Date.now() - new Date(at).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `about ${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}
const detailText = (d?: Record<string, string | number | boolean>) =>
  d
    ? Object.entries(d)
        .map(([k, v]) => (k === "language" ? languageLabel(String(v)) : `${k} ${v}`))
        .join(" · ")
    : "";

async function changePassphrase() {
  const f = pw.value;
  f.err = "";
  f.msg = "";
  if (f.next.length < MIN_PASSPHRASE) return (f.err = `Use at least ${MIN_PASSPHRASE} characters.`);
  if (f.next !== f.confirm) return (f.err = "The new passphrases differ.");
  f.busy = true;
  try {
    if (!(await account.changePassphrase(f.current, f.next))) f.err = "The current passphrase isn't right.";
    else Object.assign(f, { current: "", next: "", confirm: "", msg: "Passphrase changed. Your profile was re-encrypted with the new one." });
  } finally {
    f.busy = false;
  }
}

async function exportProfile() {
  const blob = await account.exportJson();
  if (!blob) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `yaxb-profile-${p.value.nickname.replace(/[^\p{L}\p{N}]+/gu, "-")}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function erase() {
  await account.erase();
}
</script>

<template>
  <AccountSetup v-if="editing" :initial="p" @done="editing = false" @cancel="editing = false" />
  <div v-else class="space-y-4">
    <section class="card flex flex-wrap items-start justify-between gap-3 p-5">
      <div>
        <h2 class="text-lg font-semibold text-ink">Hello, {{ p.nickname }}</h2>
        <p class="text-sm text-gray-600">
          {{ languageLabel(p.language) }}<template v-if="ageLabel"> · {{ ageLabel }}</template><template v-if="p.city"> · {{ p.city }}</template>
        </p>
        <p v-if="interests.length" class="mt-1 text-sm text-gray-600">Interested in {{ interests.join(", ") }}</p>
        <p class="mt-1 text-xs text-gray-500">{{ questionsAsked }} question{{ questionsAsked === 1 ? "" : "s" }} asked · {{ journeysUsed }} service{{ journeysUsed === 1 ? "" : "s" }} used</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn-light" @click="editing = true">Edit answers</button>
        <button type="button" class="btn-light" @click="account.lock()"><LogOut class="size-4" aria-hidden="true" /> Sign out</button>
      </div>
    </section>

    <section v-if="account.preferences.value?.suggestions.length" class="card p-5">
      <h3 class="flex items-center gap-2 font-semibold text-ink"><Sparkles class="size-4 text-brand" aria-hidden="true" /> Set up for you</h3>
      <p class="mt-1 mb-3 text-sm text-gray-500">From your answers. Nothing changes until you apply it, and you can undo it.</p>
      <ul class="space-y-2">
        <li v-for="s in account.preferences.value.suggestions" :key="s.label" class="rounded-lg bg-mist px-3 py-2">
          <p class="text-sm text-ink">{{ s.label }}</p>
          <p class="text-xs text-gray-500">{{ s.because }}</p>
        </li>
      </ul>
      <div class="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" class="btn-primary" @click="account.applySuggestions()">{{ account.applied.value ? "Apply again" : "Apply these settings" }}</button>
        <button v-if="account.applied.value" type="button" class="btn-light" @click="account.undoSuggestions()"><RotateCcw class="size-4" aria-hidden="true" /> Undo</button>
        <span v-if="account.appliedAt.value" class="text-xs text-gray-500">Applied {{ ago(account.appliedAt.value) }}</span>
      </div>
    </section>

    <section class="card p-5">
      <h3 class="font-semibold text-ink">Activity log</h3>
      <p class="mt-1 mb-3 text-sm text-gray-500">What happened on your profile, newest first. It never records what you asked or wrote.</p>
      <p v-if="!account.activity.value.length" class="text-sm text-gray-500">Nothing yet.</p>
      <ol v-else class="divide-y divide-gray-100 text-sm">
        <li v-for="e in account.activity.value.slice(0, shown)" :key="e.id" class="flex flex-wrap items-baseline justify-between gap-x-4 py-2">
          <span class="text-ink">{{ ACTIVITY_ACTIONS[e.action] ?? e.action }}<span v-if="e.details" class="ml-2 text-xs text-gray-500">{{ detailText(e.details) }}</span></span>
          <time :datetime="e.at" :title="new Date(e.at).toLocaleString()" class="text-xs text-gray-500">{{ ago(e.at) }}</time>
        </li>
      </ol>
      <button v-if="account.activity.value.length > shown" type="button" class="mt-2 text-sm font-medium text-brand-dark hover:underline" @click="shown += 25">Show more</button>
    </section>

    <section class="card p-5">
      <h3 class="font-semibold text-ink">Passphrase</h3>
      <form class="mt-3 grid gap-3 @lg:grid-cols-3" @submit.prevent="changePassphrase">
        <input v-model="pw.current" type="password" class="input" placeholder="Current" autocomplete="current-password" aria-label="Current passphrase" required />
        <input v-model="pw.next" type="password" class="input" placeholder="New" autocomplete="new-password" aria-label="New passphrase" required />
        <input v-model="pw.confirm" type="password" class="input" placeholder="New, again" autocomplete="new-password" aria-label="New passphrase again" required />
        <div class="flex flex-wrap items-center gap-3 @lg:col-span-3">
          <button type="submit" class="btn-light" :disabled="pw.busy">Change passphrase</button>
          <span v-if="pw.msg" role="status" class="text-sm text-ink">{{ pw.msg }}</span>
          <span v-if="pw.err" role="alert" class="text-sm text-red-800">{{ pw.err }}</span>
        </div>
      </form>
    </section>

    <section class="card p-5">
      <h3 class="font-semibold text-ink">Your data</h3>
      <div class="mt-3 flex flex-wrap gap-2">
        <button type="button" class="btn-light" @click="exportProfile"><Download class="size-4" aria-hidden="true" /> Export my profile</button>
        <ConfirmAction
          label="Erase my profile"
          confirm-label="Erase"
          message="This erases your profile and its activity log from this device. It can't be undone."
          :type-to-confirm="p.nickname"
          trigger-class="btn-light text-red-800"
          @confirm="erase"
          ><Trash2 class="size-4" aria-hidden="true" /> Erase my profile</ConfirmAction
        >
      </div>
    </section>
  </div>
</template>
