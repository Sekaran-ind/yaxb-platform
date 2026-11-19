// Where photos go (MED-1, MED-2): the host app provides a media host with provideMedia(). The kiosk's
// keeps them in IndexedDB by content hash and on the box when the service keeps them there; without
// one, photos stay in memory (the designer's preview). Components never keep the image in an
// answer: only its MediaRef.
import { inject, provide, type InjectionKey } from "vue";
import type { Field, MediaRef } from "@sekaran-ind/yaxb-journeys/journeys";

export type MediaHost = {
  /** Keep a photo and return its reference (its SHA-256, type, size). */
  save(blob: Blob, field: Field): Promise<MediaRef>;
  /** An address to show it (an object URL), or null when it isn't on this device. */
  url(ref: MediaRef): Promise<string | null>;
  /** Read it on the device (OCR or a caption, MED-5); null when it can't be read here. */
  read?(ref: MediaRef, mode: "ocr" | "caption"): Promise<string | null>;
  /** Turn a voice note into text on the device (MED-9); null when it can't here. */
  transcribe?(ref: MediaRef): Promise<string | null>;
  /** False while cameras are off (the child lock, MED-10). */
  allowed?(): boolean;
};

export const MEDIA_KEY: InjectionKey<MediaHost> = Symbol("yaxb-journeys.media");

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
/** A photo's reference: its SHA-256 (content addressed, MED-1). */
export async function mediaRefOf(blob: Blob): Promise<MediaRef> {
  return { hash: hex(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())), type: blob.type || "image/jpeg", size: blob.size };
}

/** Kept in memory: the preview's photos are gone when the page closes. */
function memoryHost(): MediaHost {
  const urls = new Map<string, string>();
  return {
    async save(blob) {
      const ref = await mediaRefOf(blob);
      if (!urls.has(ref.hash)) urls.set(ref.hash, URL.createObjectURL(blob));
      return ref;
    },
    async url(ref) {
      return urls.get(ref.hash) ?? null;
    },
  };
}
let fallback: MediaHost | null = null;

export function provideMedia(host: MediaHost) {
  provide(MEDIA_KEY, host);
}
export function useMedia(): MediaHost {
  return inject(MEDIA_KEY, null) ?? (fallback ??= memoryHost());
}

/** The longest side a photo is kept at, and its largest size: enough to read, small to send. */
export const PHOTO_MAX_SIDE = 1600;
export const PHOTO_MAX_BYTES = 2_000_000;

/** A photo from the camera, made smaller (JPEG, at most PHOTO_MAX_SIDE) before it is kept. */
export async function shrinkPhoto(file: Blob): Promise<Blob> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  for (const quality of [0.85, 0.7, 0.55]) {
    const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
    if (out && out.size <= PHOTO_MAX_BYTES) return out;
  }
  throw new Error("That photo is too large to keep.");
}
