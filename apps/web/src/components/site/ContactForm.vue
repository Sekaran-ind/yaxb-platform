<script setup lang="ts">
import { reactive, ref } from "vue";
import { z } from "zod";
import { cn } from "@/lib/cn";

withDefaults(defineProps<{ buttonText?: string }>(), { buttonText: "Send message" });

const contactSchema = z.strictObject({
  name: z.string().trim().min(1, "Please enter your name").max(120),
  email: z.email("Please enter a valid email").max(254),
  message: z.string().trim().min(1, "Please enter a message").max(5000),
  company: z.string().max(0).optional().default(""),
});

const form = reactive({ name: "", email: "", message: "", company: "" });
const errors = ref<Record<string, string>>({});
const pending = ref(false);
const alert = ref<{ type: "success" | "error"; message: string } | null>(null);

async function submit() {
  const parsed = contactSchema.safeParse(form);
  if (!parsed.success) {
    errors.value = Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message]));
    return;
  }
  errors.value = {};
  pending.value = true;
  try {
    const res = await fetch("/api/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(body.error ?? "Something went wrong.");
    Object.assign(form, { name: "", email: "", message: "", company: "" });
    alert.value = { type: "success", message: "Your message has been sent! We will contact you shortly." };
  } catch (e) {
    alert.value = { type: "error", message: (e as Error).message };
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <form novalidate class="space-y-4" @submit.prevent="submit">
    <div v-if="alert" :role="alert.type === 'error' ? 'alert' : 'status'" :class="cn('rounded-md px-4 py-3 text-sm', alert.type === 'success' ? 'bg-success/15 text-green-800' : 'bg-danger/10 text-red-800')">
      {{ alert.message }}
    </div>
    <div class="grid gap-4 sm:grid-cols-2">
      <div>
        <label class="sr-only" for="contact-name">Name</label>
        <input id="contact-name" v-model="form.name" class="input" placeholder="Name" autocomplete="name" :aria-invalid="!!errors.name" />
        <p v-if="errors.name" class="mt-1 text-sm text-danger">{{ errors.name }}</p>
      </div>
      <div>
        <label class="sr-only" for="contact-email">Email</label>
        <input id="contact-email" v-model="form.email" type="email" class="input" placeholder="Email" autocomplete="email" :aria-invalid="!!errors.email" />
        <p v-if="errors.email" class="mt-1 text-sm text-danger">{{ errors.email }}</p>
      </div>
    </div>
    <div>
      <label class="sr-only" for="contact-message">Message</label>
      <textarea id="contact-message" v-model="form.message" rows="5" placeholder="Message" class="input" maxlength="5000" />
      <p v-if="errors.message" class="mt-1 text-sm text-danger">{{ errors.message }}</p>
    </div>
    <!-- Honeypot for bots; hidden from people and assistive tech. -->
    <input v-model="form.company" type="text" tabindex="-1" autocomplete="off" class="hidden" aria-hidden="true" />
    <button type="submit" class="btn-primary" :disabled="pending">{{ pending ? "Sending…" : buttonText }}</button>
  </form>
</template>
