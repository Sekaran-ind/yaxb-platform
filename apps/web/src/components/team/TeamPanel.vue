<script setup lang="ts">
// The team (TEAM-1..4, TEAM-10..13): members with their roles and who is online, and a
// device-to-device chat with each. A call starts from the chat header (TEAM-20).
import { ArrowUp, Lock, MessagesSquare, Video } from "@lucide/vue";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import ModeratorSignIn from "@/components/moderation/ModeratorSignIn.vue";
import { useTeam } from "@/composables/team";
import { cn } from "@/lib/cn";

const team = useTeam();
const route = useRoute();
const router = useRouter();
const draft = ref("");
const notice = ref<string | null>(null);
const scroller = ref<HTMLElement | null>(null);

const AVAILABILITY_LABEL = { available: "Available", busy: "Busy", away: "Away" } as const;
const DOT = { available: "bg-success", busy: "bg-warning", away: "bg-gray-400" } as const;
const ROLE_LABEL: Record<string, string> = { administrator: "Administrator", moderator: "Moderator", curator: "Curator" };

const peer = computed(() => team.members.value.find((m) => m.id === team.open.value) ?? null);
const t = computed(() => (team.open.value ? team.thread(team.open.value) : null));
const peerOnline = computed(() => Boolean(peer.value && team.onlineIds.value.has(peer.value.id)));
const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
const statusLine = computed(() => {
  if (!peer.value || !t.value) return "";
  if (t.value.state === "connected") return "Connected · device to device";
  if (t.value.state === "failed") return t.value.error;
  if (!peerOnline.value) return `${peer.value.name} isn't online`;
  return t.value.state === "connecting" ? "Connecting…" : `Waiting for ${peer.value.name}…`;
});

/** Kiosk links in a message (TEAM-13): shown as links that open the item for the reader. */
function parts(text: string) {
  return text.split(/(\/kiosk\/[A-Za-z0-9\-/?=&%._]+)/g).map((p) => ({ text: p, link: /^\/kiosk\//.test(p) }));
}
const linkLabel = (path: string) => (path.startsWith("/kiosk/review") ? "Reviewed answer" : path.startsWith("/kiosk/quality") ? "Quality scores" : path.startsWith("/kiosk/curate") ? "Moderation queue" : "Kiosk page");

async function submit() {
  const text = draft.value.trim();
  if (!text || !peer.value) return;
  notice.value = null;
  if (await team.send(peer.value.id, text)) draft.value = "";
  else notice.value = `${peer.value.name} isn't online. Your message wasn't sent.`;
}

watch(
  () => t.value?.messages.length,
  async () => {
    await nextTick();
    scroller.value?.scrollTo({ top: scroller.value.scrollHeight, behavior: "smooth" });
  },
);

onMounted(async () => {
  await team.load();
  // "Share in team chat" from a review or the quality page: the link waits in the composer.
  const share = route.query.share;
  if (typeof share === "string" && share.startsWith("/kiosk/")) {
    draft.value = share;
    const { share: _, ...rest } = route.query;
    void router.replace({ query: rest });
  }
});
</script>

<template>
  <div>
    <ModeratorSignIn v-if="team.signedOut.value" why="Team members: sign in with your own moderator key." @signed-in="team.load()" />
    <p v-if="team.error.value" role="alert" class="mb-4 rounded-md bg-danger/10 px-4 py-3 text-sm text-red-800">{{ team.error.value }}</p>

    <div v-if="team.me.value" class="grid gap-4 @2xl:grid-cols-[18rem_minmax(0,1fr)]">
      <!-- members -->
      <aside class="card p-3">
        <div class="flex items-center gap-3 rounded-xl bg-mist p-3">
          <span class="grid size-9 place-items-center rounded-full bg-brand-dark text-xs font-semibold text-on-brand">{{ initials(team.me.value.name) }}</span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-semibold text-ink">{{ team.me.value.name }}</p>
            <label class="sr-only" for="my-availability">Your availability</label>
            <select id="my-availability" class="mt-0.5 rounded-full border-0 bg-surface py-0.5 pr-7 pl-2 text-xs text-ink" :value="team.me.value.availability" @change="team.setAvailability(($event.target as HTMLSelectElement).value as 'available')">
              <option v-for="(label, v) in AVAILABILITY_LABEL" :key="v" :value="v">{{ label }}</option>
            </select>
          </div>
          <span :class="cn('size-2 rounded-full', team.connected.value ? 'bg-success' : 'bg-gray-300')" :title="team.connected.value ? 'Online' : 'Connecting…'" />
        </div>
        <p class="eyebrow mt-4 mb-2 px-2">Team</p>
        <p v-if="!team.members.value.length" class="px-2 text-sm text-gray-500">No one else yet. The administrator invites members from Administration.</p>
        <ul class="space-y-0.5">
          <li v-for="m in team.members.value" :key="m.id">
            <button type="button" :class="cn('flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-mist', team.open.value === m.id && 'bg-mist')" @click="team.openChat(m.id)">
              <span class="relative grid size-9 shrink-0 place-items-center rounded-full bg-mist text-xs font-semibold text-ink ring-1 ring-gray-200">
                {{ initials(m.name) }}
                <span :class="cn('absolute -right-0.5 -bottom-0.5 size-3 rounded-full ring-2 ring-surface', team.onlineIds.value.has(m.id) ? DOT[team.availabilityOf(m.id) ?? 'available'] : 'bg-gray-300')" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-medium text-ink">{{ m.name }}</span>
                <span class="block truncate text-xs text-gray-500">
                  {{ m.roles.map((r) => ROLE_LABEL[r] ?? r).join(", ") }} · {{ team.onlineIds.value.has(m.id) ? AVAILABILITY_LABEL[team.availabilityOf(m.id) ?? "available"] : m.status === "invited" ? "Invited" : "Offline" }}
                </span>
              </span>
              <span v-if="team.threads.get(m.id)?.unread" class="grid min-w-5 place-items-center rounded-full bg-brand-dark px-1.5 text-[11px] font-semibold text-on-brand">{{ team.threads.get(m.id)?.unread }}</span>
            </button>
          </li>
        </ul>
      </aside>

      <!-- chat -->
      <section class="card relative flex h-[min(72dvh,640px)] flex-col p-4" aria-label="Chat">
        <div v-if="!peer" class="m-auto max-w-sm text-center">
          <MessagesSquare class="mx-auto size-8 text-gray-400" aria-hidden="true" />
          <p class="mt-3 font-medium text-ink">Message or call a team member</p>
          <p class="mt-1 text-sm text-gray-500">Chats and calls go device to device. Messages are kept only on your device and theirs, never on the server.</p>
        </div>
        <template v-else-if="t">
          <header class="flex items-center justify-between gap-3 border-b border-gray-200/70 pb-3">
            <div class="min-w-0">
              <h2 class="truncate text-base font-semibold text-ink">{{ peer.name }}</h2>
              <p :class="cn('truncate text-xs', t.state === 'failed' ? 'text-red-800' : 'text-gray-500')" role="status">{{ statusLine }}</p>
            </div>
            <button type="button" class="btn-light h-9 px-3" :disabled="!peerOnline" :title="peerOnline ? `Video call with ${peer.name}` : `${peer.name} isn't online`" @click="team.placeCall(peer.id)">
              <Video class="size-4" aria-hidden="true" /> Call
            </button>
          </header>
          <div ref="scroller" class="-mx-1 min-h-0 flex-1 space-y-2 overflow-y-auto px-1 pt-3 pb-24 [scrollbar-width:thin]" aria-live="polite">
            <p v-if="!t.messages.length" class="pt-10 text-center text-sm text-gray-400">No messages yet.</p>
            <div v-for="m in t.messages" :key="m.id" :class="cn('flex', m.dir === 'sent' ? 'justify-end' : 'justify-start')">
              <p :class="cn('max-w-[80%] rounded-3xl px-4 py-2 text-[15px] whitespace-pre-wrap', m.dir === 'sent' ? 'rounded-br-lg bg-brand-dark text-on-brand' : 'rounded-bl-lg bg-mist text-ink')">
                <template v-for="(p, i) in parts(m.text)" :key="i">
                  <RouterLink v-if="p.link" :to="p.text" :class="cn('font-medium underline underline-offset-2', m.dir === 'sent' ? 'text-on-brand' : 'text-ink')">{{ linkLabel(p.text) }}</RouterLink>
                  <template v-else>{{ p.text }}</template>
                </template>
                <time :datetime="m.at" :class="cn('mt-0.5 block text-[10px]', m.dir === 'sent' ? 'text-on-brand/60' : 'text-gray-400')">{{ new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }}</time>
              </p>
            </div>
          </div>
          <div class="pointer-events-none absolute inset-x-4 bottom-4 bg-linear-to-t from-surface from-60% to-transparent pt-8">
            <p v-if="notice" role="alert" class="pointer-events-auto mb-2 rounded-lg bg-warning/25 px-3 py-1.5 text-xs text-ink">{{ notice }}</p>
            <form class="pointer-events-auto flex items-center gap-1.5 rounded-[1.75rem] border border-gray-200 bg-surface py-1.5 pr-1.5 pl-5 shadow-[var(--shadow-lift)] focus-within:border-gray-400" @submit.prevent="submit">
              <label for="team-message" class="sr-only">Message {{ peer.name }}</label>
              <input id="team-message" v-model="draft" class="min-w-0 flex-1 bg-transparent py-2.5 text-ink outline-none placeholder:text-gray-400" :placeholder="`Message ${peer.name}`" maxlength="4000" autocomplete="off" />
              <button type="submit" class="btn-primary size-10 shrink-0 p-0" :disabled="!draft.trim()" aria-label="Send"><ArrowUp class="size-4" aria-hidden="true" /></button>
            </form>
            <p class="mt-1.5 flex items-center justify-center gap-1 text-[11px] text-gray-400"><Lock class="size-3" aria-hidden="true" /> End-to-end encrypted, device to device. Kept only on this device.</p>
          </div>
        </template>
      </section>
    </div>
  </div>
</template>
