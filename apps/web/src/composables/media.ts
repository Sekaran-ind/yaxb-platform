// The kiosk's media host (MED-1..5, MED-10) for photo fields (yaxb-journeys MediaCapture):
// - kept on this device by hash; put on the box whenever one is connected (decided 2026-11-20),
//   unless the field says `keep: device`; later (`flushMedia`) when the box can't be reached now.
//   Cloud storage (`keep: server`, R2) is the paid tier: until then such media goes to the box too;
// - shown from this device, else fetched from the box (a staff device opening a request);
// - read on this device: text with Tesseract.js in English and the kiosk's language (ocrImage), a
//   description with Florence-2 (readImage); never by a cloud model here;
// - no camera while the child safety lock is on (MED-10).
import type { MediaHost } from "@sekaran-ind/yaxb-journeys/vue";
import type { MediaRef } from "@sekaran-ind/yaxb-core/journeys";
import { getMediaRow, pullFromBox, pushToBox, putMedia, setMediaText } from "@/lib/browser/media";
import { readImage, transcribeAudio } from "@/lib/browser/offline";
import { ocrImage } from "@/lib/browser/ocr";
import { settings } from "./settings";
import { useChildMode } from "./child";

const urls = new Map<string, string>();
/** Photos waiting for the box (it couldn't be reached when they were taken). */
const waiting = new Set<string>();
const box = () => (settings.box.url && settings.box.token ? settings.box : null);

/** Try again to put waiting photos on the box. */
export async function flushMedia() {
  const b = box();
  if (!b) return;
  for (const hash of [...waiting]) if (await pushToBox(b, hash)) waiting.delete(hash);
}
if (typeof window !== "undefined") window.addEventListener("online", () => void flushMedia());

export function kioskMediaHost(): MediaHost {
  // Child mode is read when a field asks (the host is made before the app mounts).
  let child: ReturnType<typeof useChildMode> | null = null;
  return {
    async save(blob, field) {
      const ref = await putMedia(blob);
      // The box whenever one is connected; a field may keep its media on this device only.
      const b = box();
      if (field.keep !== "device" && (b || field.keep === "box" || field.keep === "server")) {
        if (!b || !(await pushToBox(b, ref.hash))) waiting.add(ref.hash);
      }
      return ref;
    },
    async url(ref: MediaRef) {
      const known = urls.get(ref.hash);
      if (known) return known;
      let blob = (await getMediaRow(ref.hash))?.blob ?? null;
      const b = box();
      if (!blob && b) blob = await pullFromBox(b, ref);
      if (!blob) return null;
      const u = URL.createObjectURL(blob);
      urls.set(ref.hash, u);
      return u;
    },
    async read(ref, mode) {
      const row = await getMediaRow(ref.hash);
      if (!row) return null;
      const text = mode === "ocr" ? await ocrImage(row.blob, settings.agent.language) : await readImage(row.blob, mode);
      if (text) await setMediaText(ref.hash, text);
      return text || null;
    },
    async transcribe(ref) {
      const row = await getMediaRow(ref.hash);
      if (!row) return null;
      const text = await transcribeAudio(row.blob);
      if (text) await setMediaText(ref.hash, text);
      return text || null;
    },
    allowed: () => !(child ??= useChildMode()).on.value,
  };
}

/** One host for the app: photo fields, handlers (media.read, media.transcribe) and thumbnails share it. */
export const mediaHost = kioskMediaHost();
