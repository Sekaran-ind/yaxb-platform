// The app's own text dialog (never the browser's prompt()): `askText` opens one modal overlay
// (`TextDialog`, mounted once in App.vue) and resolves with what was typed, or null on Cancel/Esc.
import { shallowRef } from "vue";

export type TextAsk = {
  title: string;
  label: string;
  value?: string;
  placeholder?: string;
  /** The button that accepts (Save, Create…). */
  confirm?: string;
  maxLength?: number;
  /** An empty answer is refused (the button stays off). */
  required?: boolean;
};
type Pending = TextAsk & { resolve: (v: string | null) => void };

export const pendingText = shallowRef<Pending | null>(null);

/** Ask for a line of text in a modal overlay. Resolves with the trimmed text, or null when cancelled. */
export function askText(ask: TextAsk): Promise<string | null> {
  pendingText.value?.resolve(null);
  return new Promise((resolve) => {
    pendingText.value = { required: true, maxLength: 200, confirm: "Save", ...ask, resolve };
  });
}

export function answerText(value: string | null) {
  const p = pendingText.value;
  pendingText.value = null;
  p?.resolve(value === null ? null : value.trim());
}
