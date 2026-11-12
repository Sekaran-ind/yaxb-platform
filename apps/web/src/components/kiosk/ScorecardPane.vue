<script setup lang="ts">
// The Scorecard screen: team cards and the curation timeline (from the original ModelOutput).
import { ref } from "vue";
import { cn } from "@/lib/cn";
import CurateTimeline from "./CurateTimeline.vue";

const tab = ref<"team" | "curate">("team");
const TEAM = [
  { image: "/rotating_card_profile.png", title: "Elizabeth John (Health Coach)", body: "I provide personalized precision care plan to suit every individual's unique needs!", footer: "Last seen 30 mins ago" },
  { image: "/Cook_team.png", title: "Sam W, Raghuram K & Susan V", body: "Care Team of chiropractor, nutritionist, physiotherapy, maternal gestational health...", footer: "Last updated 15 days ago" },
];
const SCORES = [
  ["88%", "Accuracy"],
  ["70%", "Precision"],
  ["27%", "Recall"],
];
</script>

<template>
  <div>
    <div role="tablist" class="mb-5 flex justify-center gap-1">
      <button v-for="t in ['team', 'curate'] as const" :key="t" type="button" role="tab" :aria-selected="tab === t" :class="cn('rounded-full px-4 py-1.5 text-sm font-medium capitalize', tab === t ? 'bg-brand text-white' : 'bg-mist text-gray-600 hover:text-ink')" @click="tab = t">{{ t }}</button>
    </div>
    <div v-if="tab === 'team'" class="grid gap-4 md:grid-cols-3">
      <article v-for="c in TEAM" :key="c.title" class="card flex flex-col overflow-hidden">
        <img :src="c.image" alt="" class="h-[200px] w-full object-cover" loading="lazy" />
        <div class="flex-1 p-4">
          <h3 class="mb-2 font-semibold text-ink">{{ c.title }}</h3>
          <p class="text-xs">{{ c.body }}</p>
        </div>
        <p class="border-t border-gray-100 bg-mist px-4 py-2 text-xs text-gray-500">{{ c.footer }}</p>
      </article>
      <article class="card flex flex-col overflow-hidden">
        <img src="/soundcircle.png" alt="" class="h-[200px] w-full object-cover" loading="lazy" />
        <div class="flex-1 p-4">
          <h3 class="mb-2 font-semibold text-ink">Performance Scores</h3>
          <div class="grid grid-cols-3 gap-2 text-center">
            <div v-for="[v, k] in SCORES" :key="k">
              <p class="text-lg font-semibold text-ink">{{ v }}</p>
              <p class="text-xs">{{ k }}</p>
            </div>
          </div>
        </div>
        <p class="border-t border-gray-100 bg-mist px-4 py-2 text-xs text-gray-500">Sample metrics</p>
      </article>
    </div>
    <CurateTimeline v-else />
  </div>
</template>
