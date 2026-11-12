// Each device's own history of its team chats (TEAM-11): IndexedDB in this browser, never on the
// server. Kept per signed-in member, so two moderators sharing a computer don't see each other's.

export type ChatMessage = { id: string; me: string; peer: string; at: string; dir: "sent" | "received"; text: string };

const DB = "yaxb-team";
const STORE = "messages";
const MAX_PER_THREAD = 500;

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memory: ChatMessage[] = [];

function db(): Promise<IDBDatabase | null> {
  return (dbPromise ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" }).createIndex("thread", ["me", "peer", "at"]);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  }));
}

export async function history(me: string, peer: string): Promise<ChatMessage[]> {
  const d = await db();
  if (!d) return memory.filter((m) => m.me === me && m.peer === peer);
  return new Promise((resolve) => {
    const range = IDBKeyRange.bound([me, peer, ""], [me, peer, "￿"]);
    const req = d.transaction(STORE).objectStore(STORE).index("thread").getAll(range);
    req.onsuccess = () => resolve((req.result as ChatMessage[]).slice(-MAX_PER_THREAD));
    req.onerror = () => resolve([]);
  });
}

export async function append(me: string, peer: string, dir: ChatMessage["dir"], text: string): Promise<ChatMessage> {
  const m: ChatMessage = { id: crypto.randomUUID(), me, peer, at: new Date().toISOString(), dir, text };
  const d = await db();
  if (!d) memory.push(m);
  else
    await new Promise<void>((resolve) => {
      const tx = d.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(m);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  return m;
}

/** Forget a conversation on this device. */
export async function clear(me: string, peer: string) {
  const d = await db();
  if (!d) {
    for (let i = memory.length - 1; i >= 0; i--) if (memory[i]!.me === me && memory[i]!.peer === peer) memory.splice(i, 1);
    return;
  }
  const all = await history(me, peer);
  await new Promise<void>((resolve) => {
    const tx = d.transaction(STORE, "readwrite");
    for (const m of all) tx.objectStore(STORE).delete(m.id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}
