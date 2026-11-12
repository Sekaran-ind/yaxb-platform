<script setup lang="ts">
// Demo patient card from the original kiosk. Static sample data, not a real record.
const VITALS = [
  ["BP (mmHg)", "180/100 → 127/72"],
  ["HR (bpm)", "100 → 79"],
  ["Weight", "107.7 kg → 85 kg"],
  ["BMI", "33.8 → 26.3 kg/m²"],
];
</script>

<template>
  <div class="flex justify-center py-6">
    <article class="card w-full max-w-md p-7 text-center">
      <img src="/liz.jpg" alt="" width="96" height="96" class="mx-auto size-24 rounded-full object-cover" />
      <p class="mt-4 text-lg text-ink">Elizabeth C</p>
      <p class="text-xs font-semibold tracking-wide uppercase">42 Female</p>
      <dl class="mt-5 grid grid-cols-2 gap-3 text-left text-sm">
        <div v-for="[k, v] in VITALS" :key="k" class="rounded-md bg-mist px-3 py-2">
          <dt class="text-xs text-gray-500">{{ k }}</dt>
          <dd class="font-medium text-ink">{{ v }}</dd>
        </div>
      </dl>
      <p class="mt-5 text-xs text-gray-400">Demo data for illustration.</p>
    </article>
  </div>
</template>
