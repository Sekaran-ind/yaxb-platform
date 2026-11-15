<script setup lang="ts">
// Joining a business with a link (TEN-5..7): see the business and the role, give your name, wait
// for an administrator, then collect your own key, shown once. The claim code stays in this
// browser (localStorage) until the key is collected.
import { CheckCircle2, Copy, Loader2, UserPlus } from "@lucide/vue";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "@/lib/api";

const route = useRoute();
const router = useRouter();
const token = computed(() => String(route.params.token ?? ""));
const KEY = "yaxb.join";
type Kept = { token: string; id: string; claim: string };
const read = (): Kept | null => {
  try {
    const k = JSON.parse(localStorage.getItem(KEY) ?? "null") as Kept | null;
    return k && k.token === token.value ? k : null;
  } catch {
    return null;
  }
};
const keep = (k: Kept | null) => {
  try {
    if (k) localStorage.setItem(KEY, JSON.stringify(k));
    else localStorage.removeItem(KEY);
  } catch {
    /* private window: this page only */
  }
};

const offer = ref<{ tenant: { name: string; slug: string }; role: string; label: string | null } | null>(null);
const mine = ref<Kept | null>(read());
const status = ref<string | null>(null);
const key = ref<string | null>(null);
const name = ref("");
const error = ref<string | null>(null);
const busy = ref(false);
const copied = ref(false);
let timer: ReturnType<typeof setInterval> | null = null;

async function check() {
  if (!mine.value) return;
  try {
    const r = await fetch(`/api/join-requests/${mine.value.id}`, { headers: { "X-Yaxb-Claim": mine.value.claim } }).then((x) => x.json() as Promise<{ status?: string; error?: string; tenant?: { name: string } }>);
    status.value = r.status ?? null;
    if (r.tenant && !offer.value) offer.value = { tenant: { name: r.tenant.name, slug: "" }, role: "", label: null };
    if (r.status === "accepted") await collect();
  } catch {
    /* try again shortly */
  }
}
async function collect() {
  if (!mine.value) return;
  const res = await fetch(`/api/join-requests/${mine.value.id}/collect`, { method: "POST", headers: { "X-Yaxb-Claim": mine.value.claim } });
  const body = (await res.json().catch(() => null)) as { key?: string; error?: string } | null;
  if (body?.key) {
    key.value = body.key;
    status.value = "collected";
    keep(null);
    if (timer) clearInterval(timer);
  } else if (body?.error) error.value = body.error;
}
onMounted(async () => {
  if (mine.value) {
    await check();
  } else {
    try {
      offer.value = await api(`/api/join/${encodeURIComponent(token.value)}`);
    } catch (e) {
      error.value = (e as Error).message;
    }
  }
  timer = setInterval(() => void check(), 5000);
});
onBeforeUnmount(() => timer && clearInterval(timer));

async function ask() {
  busy.value = true;
  error.value = null;
  try {
    const r = await api<{ request: { id: string; status: string }; claim: string }>(`/api/join/${encodeURIComponent(token.value)}`, { name: name.value.trim() });
    mine.value = { token: token.value, id: r.request.id, claim: r.claim };
    keep(mine.value);
    status.value = r.request.status;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function copyKey() {
  if (key.value) await navigator.clipboard?.writeText(key.value).catch(() => {});
  copied.value = true;
}
</script>

<template>
  <section class="mx-auto max-w-lg px-4 py-12" aria-labelledby="join-h">
    <div class="card space-y-5 p-6">
      <div class="flex items-center gap-3">
        <span class="grid size-11 place-items-center rounded-full bg-mist text-brand"><UserPlus class="size-5" aria-hidden="true" /></span>
        <div>
          <h1 id="join-h" class="text-xl font-semibold text-ink">{{ offer ? `Join ${offer.tenant.name}` : "Join a business" }}</h1>
          <p v-if="offer?.role" class="text-sm text-gray-600">as {{ offer.role }}<template v-if="offer.label"> · {{ offer.label }}</template></p>
        </div>
      </div>

      <p v-if="error && !mine" role="alert" class="rounded-lg bg-danger/10 px-3 py-2 text-sm text-red-800">{{ error }}</p>

      <!-- The key, once -->
      <div v-if="key" class="space-y-3">
        <p class="flex items-center gap-2 font-medium text-ink"><CheckCircle2 class="size-5 text-brand" aria-hidden="true" /> You're in. This is your own key: keep it safe; it isn't shown again.</p>
        <div class="flex flex-wrap items-center gap-2">
          <code class="min-w-0 flex-1 break-all rounded-lg bg-mist px-3 py-2 text-sm">{{ key }}</code>
          <button type="button" class="btn-light h-10" @click="copyKey"><Copy class="size-4" aria-hidden="true" /> {{ copied ? "Copied" : "Copy" }}</button>
        </div>
        <button type="button" class="btn-primary h-11" @click="router.push({ path: '/kiosk', query: { screen: 'services', staff: 'work' } })">Sign in to the kiosk with it</button>
      </div>

      <!-- Waiting for an administrator -->
      <div v-else-if="mine" class="space-y-2 text-sm text-body" role="status">
        <p v-if="status === 'declined'">Your request was declined. Ask the business if you think that's a mistake.</p>
        <p v-else class="flex items-center gap-2"><Loader2 class="size-4 animate-spin" aria-hidden="true" /> Your request is with an administrator. Keep this page open, or come back with the same link on this device: your key appears here once they accept.</p>
        <p v-if="error" class="text-red-800">{{ error }}</p>
      </div>

      <!-- Asking -->
      <form v-else-if="offer" class="space-y-3" @submit.prevent="ask">
        <label class="block text-sm"><span class="mb-1 block font-medium text-ink">Your name</span><input v-model="name" class="input" maxlength="80" required autocomplete="name" /></label>
        <p class="text-xs text-gray-500">The business sees your name and decides. Nothing else about you is sent.</p>
        <button type="submit" class="btn-primary h-11" :disabled="busy || !name.trim()"><Loader2 v-if="busy" class="size-4 animate-spin" aria-hidden="true" /> Ask to join</button>
      </form>
    </div>
  </section>
</template>
