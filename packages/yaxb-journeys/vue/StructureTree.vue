<script setup lang="ts">
// The bundle as a tree: Service → item → Journey → steps → Questionnaire → sections. Each node
// names its document; choosing one asks the editor to show that document's line.
import type { Bundle } from "@sekaran-ind/yaxb-journeys/bundle";
import type { Journey, Step } from "@sekaran-ind/yaxb-journeys/journeys";
import { computed } from "vue";

const props = defineProps<{ bundle: Bundle }>();
const emit = defineEmits<{ reveal: [line: number] }>();

const lineOf = (kind: string, id: string) => props.bundle.documents.find((d) => d.kind === kind && d.id === id)?.line;
const go = (kind: string, id: string) => {
  const line = lineOf(kind, id);
  if (line) emit("reveal", line);
};
const journey = (id?: string) => props.bundle.journeys.find((j) => j.id === id);
const questionnaire = (id?: string) => props.bundle.questionnaires.find((q) => q.id === id);
const stepKind = (s: Step) => (s.final ? "end" : s.ask !== undefined ? "ask" : s.service ? s.service : "decide");
const targets = (s: Step) => {
  const n = s.decide ?? s.next;
  if (!n) return "";
  return typeof n === "string" ? n : n.map((b) => b.to).join(" | ");
};
const steps = (j: Journey) => Object.values(j.steps);

const linked = computed(() => new Set(props.bundle.services.flatMap((s) => s.items.flatMap((i) => (i.journey ? [i.journey] : [])))));
const unlinked = computed(() => props.bundle.journeys.filter((j) => !linked.value.has(j.id)));
const used = computed(() => new Set(props.bundle.journeys.flatMap((j) => steps(j).flatMap((s) => (s.questionnaire ? [s.questionnaire] : [])))));
const unused = computed(() => props.bundle.questionnaires.filter((q) => !used.value.has(q.id)));
</script>

<template>
  <div class="yj yj-stack">
    <p v-if="!bundle.services.length && !bundle.journeys.length && !bundle.questionnaires.length" class="yj-note">Nothing has compiled yet.</p>

    <ul class="yj-tree" aria-label="Structure">
      <li v-for="s in bundle.services" :key="s.id">
        <button type="button" class="yj-node" @click="go('service', s.id)"><span class="yj-kind">service</span>{{ s.title }}<span class="yj-code">{{ s.id }}</span></button>
        <ul>
          <li v-for="i in s.items" :key="i.key">
            <span class="yj-node"><span class="yj-kind">item</span>{{ i.label }}</span>
            <ul v-if="i.journey">
              <li>
                <button type="button" class="yj-node" @click="go('journey', i.journey)"><span class="yj-kind">journey</span>{{ journey(i.journey)?.title ?? i.journey }}<span v-if="!journey(i.journey)" class="yj-status-bad yj-small">(not compiled)</span></button>
                <ul v-if="journey(i.journey)">
                  <li v-for="st in steps(journey(i.journey)!)" :key="st.id">
                    <span class="yj-node"><span class="yj-kind">{{ stepKind(st) }}</span>{{ st.label ?? st.id }}<span v-if="targets(st)" class="yj-code">→ {{ targets(st) }}</span></span>
                    <ul v-if="st.questionnaire && questionnaire(st.questionnaire)">
                      <li>
                        <button type="button" class="yj-node" @click="go('questionnaire', st.questionnaire)">
                          <span class="yj-kind">questionnaire</span>{{ questionnaire(st.questionnaire)!.title }}
                          <span class="yj-code">{{ questionnaire(st.questionnaire)!.sections.length }} sections · {{ st.fields?.length ?? 0 }} questions</span>
                        </button>
                        <ul>
                          <li v-for="sec in questionnaire(st.questionnaire)!.sections" :key="sec.id">
                            <span class="yj-node"><span class="yj-kind">section</span>{{ sec.title }}<span class="yj-code">{{ sec.fields.map((f) => f.id).join(", ") }}</span></span>
                          </li>
                        </ul>
                      </li>
                    </ul>
                    <ul v-else-if="st.fields?.length">
                      <li><span class="yj-node"><span class="yj-kind">fields</span><span class="yj-code">{{ st.fields.map((f) => f.id).join(", ") }}</span></span></li>
                    </ul>
                  </li>
                </ul>
              </li>
            </ul>
            <ul v-else-if="i.screen">
              <li><span class="yj-node"><span class="yj-kind">screen</span>{{ i.screen }}</span></li>
            </ul>
            <ul v-else-if="i.staff">
              <li><span class="yj-node"><span class="yj-kind">staff</span>{{ i.staff }}</span></li>
            </ul>
          </li>
        </ul>
      </li>
    </ul>

    <div v-if="unlinked.length || unused.length">
      <h3 class="yj-title yj-small">Not reached from a service</h3>
      <ul class="yj-tree">
        <li v-for="j in unlinked" :key="j.id">
          <button type="button" class="yj-node" @click="go('journey', j.id)"><span class="yj-kind">journey</span>{{ j.title }}<span class="yj-code">{{ j.id }}</span></button>
        </li>
        <li v-for="q in unused" :key="q.id">
          <button type="button" class="yj-node" @click="go('questionnaire', q.id)"><span class="yj-kind">questionnaire</span>{{ q.title }}<span class="yj-code">{{ q.id }}</span></button>
        </li>
      </ul>
    </div>
  </div>
</template>
