<script setup lang="ts">
// A photo field (MED-2, MED-4): take a photo with the camera (or choose one), see it, take it again
// or remove it, up to the field's `max`. Each photo is made smaller, kept by the host (media.ts) and
// read on the device when the field asks (`read: ocr | caption`, MED-5); the answer holds only the
// references and the text read (MED-3).
import type { Field, MediaRef } from "@sekaran-ind/yaxb-journeys/journeys";
import { computed, onMounted, ref, useId, watch } from "vue";
import { shrinkPhoto, useMedia } from "./media";

const props = defineProps<{ field: Field; value: unknown }>();
const emit = defineEmits<{ change: [value: MediaRef[]] }>();
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
    let r = await media.save(small, props.field);
    if (props.field.read && props.field.read !== "none" && media.read) {
      busy.value = props.field.read === "ocr" ? "Reading the text in it, on this device…" : "Describing it, on this device…";
      const text = await media.read(r, props.field.read).catch(() => null);
      if (text) r = { ...r, text: text.slice(0, 2000) };
    }
    emit("change", [...list.value.filter((x) => x.hash !== r.hash), r].slice(-max.value));
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    busy.value = null;
  }
}
const remove = (hash: string) => emit("change", list.value.filter((r) => r.hash !== hash));
</script>

<template>
  <div class="yj-media">
    <p v-if="!allowed" class="yj-help">The camera is off here (the child safety lock).</p>
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
