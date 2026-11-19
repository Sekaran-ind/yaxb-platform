<script setup lang="ts">
// A photo or voice-note field (MED-2, MED-4, MED-9). Photo: take one with the camera (or choose
// one), see it, take it again or remove it, up to the field's `max`. Voice note: record up to
// `max_seconds`, hear it back, record it again; `transcribe: device` turns it into text on the device. Each photo is made smaller, kept by the host (media.ts) and
// read on the device when the field asks (`read: ocr | caption`, MED-5); the answer holds only the
// references and the text read (MED-3).
import type { Field, MediaRef } from "@sekaran-ind/yaxb-journeys/journeys";
import { computed, onMounted, ref, useId, watch } from "vue";
import { shrinkPhoto, useMedia } from "./media";

const props = defineProps<{ field: Field; value: unknown }>();
/** `noted`: what happened, for the service's events (MED-11): never the media itself. */
const emit = defineEmits<{ change: [value: MediaRef[]]; noted: [event: { kind: "media.captured" | "media.read"; ms: number; ok: boolean }] }>();
const media = useMedia();
const uid = useId();
const list = computed<MediaRef[]>(() => (Array.isArray(props.value) ? (props.value as MediaRef[]) : []));
const max = computed(() => props.field.max ?? 1);
const urls = ref<Record<string, string | null>>({});
const busy = ref<string | null>(null);
const error = ref<string | null>(null);
const allowed = computed(() => media.allowed?.() ?? true);

async function show() {
  for (const r of list.value) if (!(r.hash in urls.value)) urls.value = { ...urls.value, [r.hash]: await media.url(r) };
}
onMounted(show);
watch(list, show);

async function picked(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  error.value = null;
  busy.value = "Keeping the photo…";
  try {
    const small = await shrinkPhoto(file);
    const t0 = Date.now();
    const r = await media.save(small, props.field);
    emit("noted", { kind: "media.captured", ms: Date.now() - t0, ok: true });
    // Shown at once; the text read from it is added when it comes (the first read fetches a model).
    const kept = [...list.value.filter((x) => x.hash !== r.hash), r].slice(-max.value);
    emit("change", kept);
    if (props.field.read && props.field.read !== "none" && media.read) {
      busy.value = props.field.read === "ocr" ? "Reading the text in it, on this device…" : "Describing it, on this device…";
      const t1 = Date.now();
      const text = await media.read(r, props.field.read).catch(() => null);
      emit("noted", { kind: "media.read", ms: Date.now() - t1, ok: Boolean(text) });
      if (text) emit("change", list.value.map((x) => (x.hash === r.hash ? { ...x, text: text.slice(0, 2000) } : x)));
    }
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    busy.value = null;
  }
}
const remove = (hash: string) => emit("change", list.value.filter((r) => r.hash !== hash));

// ---- voice notes (MED-9) ----
const audio = computed(() => props.field.type === "audio");
const seconds = computed(() => props.field.max_seconds ?? 60);
const recording = ref(false);
const elapsed = ref(0);
let recorder: MediaRecorder | null = null;
let ticking: ReturnType<typeof setInterval> | null = null;
async function record() {
  error.value = null;
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    error.value = "The microphone isn't available here.";
    return;
  }
  const chunks: Blob[] = [];
  recorder = new MediaRecorder(stream);
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    if (ticking) clearInterval(ticking);
    recording.value = false;
    const blob = new Blob(chunks, { type: recorder?.mimeType || "audio/webm" });
    busy.value = "Keeping the voice note…";
    try {
      const t0 = Date.now();
      const r = await media.save(blob, props.field);
      emit("noted", { kind: "media.captured", ms: Date.now() - t0, ok: true });
      // Playable at once; the words are added when they come (the first time fetches a model).
      emit("change", [r]);
      if (props.field.transcribe === "device" && media.transcribe) {
        busy.value = "Writing it down, on this device…";
        const t1 = Date.now();
        const text = await media.transcribe(r).catch(() => null);
        emit("noted", { kind: "media.read", ms: Date.now() - t1, ok: Boolean(text) });
        if (text && list.value[0]?.hash === r.hash) emit("change", [{ ...r, text: text.slice(0, 4000) }]);
      }
    } catch (err) {
      error.value = (err as Error).message;
    } finally {
      busy.value = null;
    }
  };
  recorder.start();
  recording.value = true;
  elapsed.value = 0;
  ticking = setInterval(() => {
    elapsed.value++;
    if (elapsed.value >= seconds.value) recorder?.stop();
  }, 1000);
}
const stop = () => recorder?.state === "recording" && recorder.stop();
</script>

<template>
  <div class="yj-media">
    <p v-if="!allowed" class="yj-help">{{ audio ? "The microphone is off here" : "The camera is off here" }} (the child safety lock).</p>
    <template v-else-if="audio">
      <div v-for="r in list" :key="r.hash" class="yj-media-item">
        <audio v-if="urls[r.hash]" :src="urls[r.hash]!" controls class="yj-media-audio" />
        <span class="yj-media-text">{{ r.text ?? "" }}</span>
      </div>
      <div class="yj-row">
        <button v-if="!recording" type="button" class="yj-btn" :disabled="Boolean(busy)" @click="record">{{ list.length ? "Record it again" : "Record a voice note" }}</button>
        <button v-else type="button" class="yj-btn yj-btn-primary" @click="stop">Stop ({{ seconds - elapsed }} s left)</button>
        <button v-if="list.length && !recording" type="button" class="yj-btn yj-select-sm" @click="emit('change', [])">Remove</button>
      </div>
      <p v-if="busy" class="yj-help" role="status">{{ busy }}</p>
      <p v-if="error" role="alert" class="yj-error">{{ error }}</p>
    </template>
    <template v-else>
      <ul v-if="list.length" class="yj-media-list">
        <li v-for="r in list" :key="r.hash" class="yj-media-item">
          <img v-if="urls[r.hash]" :src="urls[r.hash]!" :alt="r.text ? `Photo: ${r.text.slice(0, 80)}` : `Photo for ${field.label}`" class="yj-media-thumb" />
          <span v-else class="yj-media-thumb yj-muted">Photo</span>
          <span class="yj-media-text">{{ r.text ?? "" }}</span>
          <button type="button" class="yj-btn yj-select-sm" @click="remove(r.hash)">{{ max === 1 ? "Take it again" : "Remove" }}</button>
        </li>
      </ul>
      <label v-if="list.length < max" :for="`${uid}-camera`" class="yj-btn" :aria-busy="Boolean(busy) || undefined">
        {{ busy ?? (list.length ? "Add another photo" : "Take a photo") }}
      </label>
      <input :id="`${uid}-camera`" class="yj-visually-hidden" type="file" accept="image/*" capture="environment" :disabled="Boolean(busy)" @change="picked" />
      <p v-if="error" role="alert" class="yj-error">{{ error }}</p>
    </template>
  </div>
</template>
