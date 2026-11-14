<script setup lang="ts">
// A consent form before someone starts or takes part in a journey (CON-6): the service's form for
// their role, from its Legal Guardian. Agree carries on; No thanks stops (nothing was asked yet).
import type { ConsentForm } from "@sekaran-ind/yaxb-journeys";
import { Scale } from "@lucide/vue";
import { ref, useId } from "vue";

defineProps<{ form: ConsentForm; service: string; version: number }>();
const emit = defineEmits<{ agree: []; decline: [] }>();
const ticked = ref(false);
const uid = useId();
</script>

<template>
  <section class="card space-y-3 p-4" :aria-labelledby="`${uid}-t`">
    <div class="flex items-start gap-3">
      <span class="grid size-9 shrink-0 place-items-center rounded-full bg-mist text-brand"><Scale class="size-4" aria-hidden="true" /></span>
      <div class="min-w-0">
        <h3 :id="`${uid}-t`" class="font-semibold text-ink">{{ form.title }}</h3>
        <p class="text-xs text-gray-500">{{ service }} · consent version {{ version }}</p>
      </div>
    </div>
    <ul class="list-disc space-y-1.5 pl-5 text-sm text-body">
      <li v-for="(p, i) in form.points" :key="i">{{ p }}</li>
    </ul>
    <label class="flex items-start gap-2 text-sm text-ink">
      <input v-model="ticked" type="checkbox" class="mt-0.5 size-4" />
      <span>I have read this.</span>
    </label>
    <div class="flex flex-wrap gap-2">
      <button type="button" class="btn-primary h-10" :disabled="!ticked" @click="emit('agree')">{{ form.agree }}</button>
      <button type="button" class="btn-light h-10" @click="emit('decline')">No thanks</button>
    </div>
  </section>
</template>
