// Photos on this device (MED-1): kept apart from records, by content hash (SHA-256), in IndexedDB
// `yaxb-media`, with the text read from them beside each (MED-3). Records and requests carry only the
// hash; a photo moves only when someone needs it: up to the box when its field keeps it there, and
// down from the box when a staff device opens the request.
import { mediaRefOf } from "@sekaran-ind/yaxb-journeys/vue";
import type { MediaRef } from "@sekaran-ind/yaxb-core/journeys";

type Row = MediaRef & { blob: Blob; created_at: string; on_box?: boolean };
const DB = "yaxb-media";
let opening: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore("media", { keyPath: "hash" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}
const memory = new Map<string, Row>();
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  const d = await db();
  if (!d) return undefined;
  return new Promise((resolve, reject) => {
    const r = fn(d.transaction("media", mode).objectStore("media"));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function putMedia(blob: Blob, extra: Partial<Row> = {}): Promise<MediaRef> {
  const ref = await mediaRefOf(blob);
  const old = await getMediaRow(ref.hash);
  const row: Row = { ...ref, ...old, ...extra, blob, created_at: old?.created_at ?? new Date().toISOString() };
  if ((await tx("readwrite", (s) => s.put(row)).catch(() => undefined)) === undefined) memory.set(ref.hash, row);
  return ref;
}
export async function getMediaRow(hash: string): Promise<Row | null> {
  return ((await tx("readonly", (s) => s.get(hash)).catch(() => undefined)) as Row | undefined) ?? memory.get(hash) ?? null;
}
export async function markOnBox(hash: string) {
  const row = await getMediaRow(hash);
  if (row) await putMedia(row.blob, { on_box: true, text: row.text });
}
export async function setMediaText(hash: string, text: string) {
  const row = await getMediaRow(hash);
  if (row) await putMedia(row.blob, { text, on_box: row.on_box });
}

// ---- the box (MED-1): /v1/media/<hash> ----------------------------------------------------------------

type Box = { url: string; token: string };
const base = (box: Box) => box.url.replace(/\/+$/, "");

/** Put a photo on the box (it checks the hash). True when it is there. */
export async function pushToBox(box: Box, hash: string): Promise<boolean> {
  const row = await getMediaRow(hash);
  if (!row) return false;
  if (row.on_box) return true;
  const res = await fetch(`${base(box)}/v1/media/${hash}`, { method: "PUT", headers: { Authorization: `Bearer ${box.token}`, "Content-Type": row.type }, body: row.blob }).catch(() => null);
  if (!res?.ok) return false;
  await markOnBox(hash);
  return true;
}
/** Fetch a photo from the box and keep it here. */
export async function pullFromBox(box: Box, ref: MediaRef): Promise<Blob | null> {
  const res = await fetch(`${base(box)}/v1/media/${ref.hash}`, { headers: { Authorization: `Bearer ${box.token}` } }).catch(() => null);
  if (!res?.ok) return null;
  const blob = await res.blob();
  const got = await mediaRefOf(blob);
  if (got.hash !== ref.hash) return null; // not what was asked for
  await putMedia(blob, { on_box: true, text: ref.text });
  return blob;
}
