// This device's key pair for sealed steps (core `seal`): made once, kept in IndexedDB as a CryptoKey
// that can't be exported (so the private key never leaves the device, not even into a backup), and
// only its public half is ever shared (the key directory). Memory when IndexedDB is unavailable (a
// private window): then the key lasts as long as the page, and what was sealed for it can't be read
// later. Framework-free.
import { generateKeyPair, type KeyPair } from "@sekaran-ind/yaxb-core/seal";

const DB = "yaxb-keys";
let pair: Promise<KeyPair> | null = null;

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore("keys", { keyPath: "name" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}
const request = <T>(r: IDBRequest<T>) => new Promise<T | undefined>((resolve) => ((r.onsuccess = () => resolve(r.result)), (r.onerror = () => resolve(undefined))));

async function load(): Promise<KeyPair> {
  const db = await open();
  if (db) {
    const kept = (await request(db.transaction("keys").objectStore("keys").get("device"))) as ({ name: string } & KeyPair) | undefined;
    if (kept?.id && kept.privateKey && kept.jwk) return { id: kept.id, jwk: kept.jwk, privateKey: kept.privateKey };
  }
  const made = await generateKeyPair();
  if (db) await request(db.transaction("keys", "readwrite").objectStore("keys").put({ name: "device", ...made }));
  return made;
}

/** This device's key pair. */
export const deviceKey = (): Promise<KeyPair> => (pair ??= load());
