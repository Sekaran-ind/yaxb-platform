import { onBeforeUnmount, onMounted, ref } from "vue";

/** The width of an element, kept current with a ResizeObserver (containers resize, not only windows). */
export function useWidth(fallback = 1280) {
  const el = ref<HTMLElement | null>(null);
  const width = ref(fallback);
  let observer: ResizeObserver | null = null;
  onMounted(() => {
    if (!el.value) return;
    width.value = el.value.getBoundingClientRect().width || fallback;
    if (typeof ResizeObserver === "undefined") return;
    observer = new ResizeObserver(([entry]) => entry && (width.value = entry.contentRect.width));
    observer.observe(el.value);
  });
  onBeforeUnmount(() => observer?.disconnect());
  return { el, width };
}
