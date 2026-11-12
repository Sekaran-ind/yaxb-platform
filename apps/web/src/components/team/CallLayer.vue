<script setup lang="ts">
// A ringing call and the call window (TEAM-20, TEAM-21, TEAM-23), above every page, so a call
// carries on while a moderator moves between pages.
import { Mic, MicOff, MonitorUp, Phone, PhoneOff, Video, VideoOff, X } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { useTeam } from "@/composables/team";
import { cn } from "@/lib/cn";

const team = useTeam();
const localVideo = ref<HTMLVideoElement | null>(null);
const remoteVideo = ref<HTMLVideoElement | null>(null);
const tick = ref(0);

const STATE_TEXT = { idle: "", starting: "Starting the camera and microphone…", waiting: "Calling…", connecting: "Connecting…", connected: "", ended: "Call ended", failed: "The call couldn't connect" } as const;
const peerName = computed(() => team.nameOf(team.callPeer.value));
const v = computed(() => team.call.value);
// The call object isn't reactive: these re-read it when its streams or controls change.
const micOn = computed(() => (tick.value, team.call.value?.micOn ?? true));
const cameraOn = computed(() => (tick.value, team.call.value?.cameraOn ?? true));
const sharing = computed(() => (team.streamsTick.value, team.call.value?.sharing ?? false));
const hasRemote = computed(() => (team.streamsTick.value, Boolean(team.call.value?.remote)));
const hasLocal = computed(() => (team.streamsTick.value, Boolean(team.call.value?.local)));

watch(
  [() => team.streamsTick.value, localVideo, remoteVideo],
  () => {
    const c = team.call.value;
    if (localVideo.value) localVideo.value.srcObject = c?.local ?? null;
    if (remoteVideo.value) remoteVideo.value.srcObject = c?.remote ?? null;
  },
  { flush: "post" },
);

const toggle = (fn: () => void) => {
  fn();
  tick.value++;
};
const over = computed(() => team.callState.value === "ended" || team.callState.value === "failed");
</script>

<template>
  <!-- ringing -->
  <div v-if="team.incoming.value" role="alertdialog" aria-live="assertive" :aria-label="`${team.nameOf(team.incoming.value)} is calling`" class="fixed top-16 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] items-center gap-3 rounded-2xl bg-console p-4 text-white shadow-[var(--shadow-lift)] ring-1 ring-white/10">
    <span class="grid size-10 shrink-0 animate-pulse place-items-center rounded-full bg-brand text-console"><Video class="size-5" aria-hidden="true" /></span>
    <div class="min-w-0 flex-1">
      <p class="truncate font-medium">{{ team.nameOf(team.incoming.value) }}</p>
      <p class="text-xs text-white/60">Video call</p>
    </div>
    <button type="button" class="grid size-10 place-items-center rounded-full bg-danger text-white" aria-label="Decline" @click="team.decline()"><PhoneOff class="size-4" aria-hidden="true" /></button>
    <button type="button" class="grid size-10 place-items-center rounded-full bg-success text-white" aria-label="Answer" @click="team.answer()"><Phone class="size-4" aria-hidden="true" /></button>
  </div>

  <!-- the call -->
  <div v-if="v" role="dialog" aria-modal="true" :aria-label="`Call with ${peerName}`" class="fixed inset-0 z-50 flex flex-col bg-console text-white">
    <div class="relative min-h-0 flex-1">
      <video v-show="hasRemote" ref="remoteVideo" autoplay playsinline class="size-full object-contain" />
      <div v-if="!hasRemote" class="absolute inset-0 grid place-items-center text-center">
        <div>
          <p class="text-2xl font-medium tracking-tight">{{ peerName }}</p>
          <p :class="cn('mt-2 text-sm', team.callState.value === 'failed' ? 'text-red-300' : 'text-white/60')" role="status">{{ team.callError.value || STATE_TEXT[team.callState.value] }}</p>
        </div>
      </div>
      <video v-show="hasLocal" ref="localVideo" autoplay playsinline muted class="absolute right-4 bottom-4 aspect-video w-40 rounded-2xl bg-black object-cover ring-1 ring-white/20 sm:w-56" />
      <p v-if="hasRemote && team.callState.value === 'connected'" class="absolute top-4 left-4 rounded-full bg-black/40 px-3 py-1 text-xs backdrop-blur">{{ peerName }} · end-to-end encrypted</p>
    </div>
    <div class="flex items-center justify-center gap-3 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
      <template v-if="!over">
        <button type="button" class="console-btn size-12" :aria-pressed="!micOn" :aria-label="micOn ? 'Mute' : 'Unmute'" @click="toggle(() => v!.toggleMic())">
          <Mic v-if="micOn" class="size-5" aria-hidden="true" /><MicOff v-else class="size-5" aria-hidden="true" />
        </button>
        <button type="button" class="console-btn size-12" :aria-pressed="!cameraOn" :aria-label="cameraOn ? 'Turn camera off' : 'Turn camera on'" @click="toggle(() => v!.toggleCamera())">
          <Video v-if="cameraOn" class="size-5" aria-hidden="true" /><VideoOff v-else class="size-5" aria-hidden="true" />
        </button>
        <button type="button" :class="cn('console-btn size-12', sharing && 'bg-brand text-console')" :aria-pressed="sharing" aria-label="Share screen" :disabled="team.callState.value !== 'connected'" @click="v.shareScreen()">
          <MonitorUp class="size-5" aria-hidden="true" />
        </button>
        <button type="button" class="grid size-14 place-items-center rounded-full bg-danger text-white" aria-label="Hang up" @click="team.hangUp()"><PhoneOff class="size-5" aria-hidden="true" /></button>
      </template>
      <button v-else type="button" class="btn h-11 bg-white/10 px-5 text-white ring-1 ring-white/20 hover:bg-white/15" @click="team.closeCall()"><X class="size-4" aria-hidden="true" /> Close</button>
    </div>
  </div>
</template>
