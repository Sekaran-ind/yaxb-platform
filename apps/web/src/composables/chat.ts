// The kiosk's conversation with the agent: each turn is sent with the agent settings and the
// notebook, and kept where the Storage setting says (browser or box: the `state` event; server: D1).
import { readSSE, type AgentEvent } from "@sekaran-ind/yaxb-core/events";
import type { RetrievedRef } from "@sekaran-ind/yaxb-core/schemas";
import type { AgentSettings } from "@sekaran-ind/yaxb-core/settings";
import type { ThreadState } from "@sekaran-ind/yaxb-core/stores";
import { ref, type Ref } from "vue";
import { notebookForAgent, nowIso, type KioskStore, type NotebookRecord, type ThreadRecord } from "@/lib/browser/store";
import type { ChatTurn } from "@/lib/types";

export type Selection = { provider: string; model: string; temperature: number };
type TurnContext = {
  settings: AgentSettings;
  notebook: NotebookRecord | null;
  thread: ThreadState | null;
  /** What the on-device sentence-transformer found for this question (references only). */
  retrieved?: RetrievedRef[];
};

/** POST one turn and yield its events. Throws with the server's message on an HTTP error. */
async function* postTurn(threadId: string, message: string, selection: Selection, ctx: TurnContext, signal: AbortSignal): AsyncGenerator<AgentEvent> {
  const browserHeld = ctx.settings.storage !== "server";
  const res = await fetch("/api/agent/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      threadId,
      message,
      ...selection,
      settings: ctx.settings,
      client: { thread: browserHeld ? ctx.thread : null, notebook: ctx.notebook ? notebookForAgent(ctx.notebook) : null, retrieved: ctx.retrieved ?? [] },
    }),
    signal,
  });
  if (!res.ok || !res.body) {
    const err = ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "The assistant is unavailable.";
    throw new Error(err);
  }
  yield* readSSE(res.body);
}

async function saveMemory(store: KioskStore, notebookId: string, memory: string) {
  const latest = await store.getNotebook(notebookId);
  if (latest && latest.memory !== memory) await store.putNotebook({ ...latest, memory, updatedAt: nowIso() });
}

/** Ask once, outside the visible conversation (journeys' agent.ask steps). Memory the agent writes is still kept. */
export async function askOnce(message: string, selection: Selection, ctx: Omit<TurnContext, "thread"> & { store: KioskStore }, signal?: AbortSignal) {
  let text = "";
  const settings: AgentSettings = { ...ctx.settings, storage: ctx.settings.storage === "server" ? "session" : ctx.settings.storage };
  for await (const ev of postTurn(crypto.randomUUID(), message, selection, { settings, notebook: ctx.notebook, thread: null }, signal ?? new AbortController().signal)) {
    if (ev.type === "token") text += ev.text;
    else if (ev.type === "error") throw new Error(ev.message);
    else if (ev.type === "state" && ev.memory !== null && ctx.notebook) await saveMemory(ctx.store, ctx.notebook.id, ev.memory);
  }
  return text.trim();
}

const titleOf = (message: string) => (message.length > 60 ? `${message.slice(0, 57)}…` : message);

export function useChat(store: Ref<KioskStore>, onStored?: () => void) {
  const turns = ref<ChatTurn[]>([]);
  const busy = ref(false);
  const threadId = ref<string>(crypto.randomUUID());
  let record: ThreadRecord | null = null;
  let controller: AbortController | null = null;

  const last = () => turns.value[turns.value.length - 1]!;

  /** Sends a message; resolves with the final assistant text (for speech output). */
  async function send(message: string, selection: Selection, ctx: Omit<TurnContext, "thread">): Promise<string> {
    controller?.abort();
    controller = new AbortController();
    busy.value = true;
    const userTurn: ChatTurn = { id: crypto.randomUUID(), role: "user", text: message, tools: [], todos: [] };
    turns.value.push(userTurn, { id: crypto.randomUUID(), role: "assistant", text: "", tools: [], todos: [], pending: true });
    let answer = "";
    let state: ThreadState | null = record?.state ?? null;
    try {
      for await (const ev of postTurn(threadId.value, message, selection, { ...ctx, thread: state }, controller.signal)) {
        const turn = last();
        switch (ev.type) {
          case "token":
            answer += ev.text;
            turn.text += ev.text;
            break;
          case "tool_start":
            turn.tools.push({ id: ev.id, name: ev.name, subagent: ev.subagent, nested: ev.nested, done: false });
            break;
          case "tool_end": {
            const t = turn.tools.find((x) => x.id === ev.id);
            if (t) t.done = true;
            break;
          }
          case "todos":
            turn.todos = ev.todos;
            break;
          case "state":
            if (ev.thread) state = ev.thread;
            if (ev.memory !== null && ctx.notebook) await saveMemory(store.value, ctx.notebook.id, ev.memory);
            break;
          case "error":
            throw new Error(ev.message);
        }
      }
      last().pending = false;
      await keep(message, ctx, ctx.settings.storage === "server" ? null : state);
      return answer;
    } catch (e) {
      if ((e as Error).name === "AbortError") return answer;
      last().pending = false;
      last().error = (e as Error).message;
      throw e;
    } finally {
      busy.value = false;
    }
  }

  /** Keep the conversation: its turns for the Transcript, and the agent's state. */
  async function keep(message: string, ctx: Omit<TurnContext, "thread">, state: ThreadState | null) {
    if (!ctx.notebook) return;
    record = {
      id: threadId.value,
      notebookId: ctx.notebook.id,
      title: record?.title ?? titleOf(message),
      updatedAt: nowIso(),
      turns: JSON.parse(JSON.stringify(turns.value)) as ChatTurn[],
      state,
    };
    await store.value.putThread(record).catch(() => undefined);
    onStored?.();
  }

  /**
   * A turn answered on this device, without the agent (Settings → Knowledge → On this device).
   * `work` searches and composes the answer; the agent's state is left as it was.
   */
  async function sendLocal(message: string, ctx: Omit<TurnContext, "thread">, work: (signal: AbortSignal) => Promise<{ text: string; spoken: string }>): Promise<string> {
    controller?.abort();
    controller = new AbortController();
    busy.value = true;
    turns.value.push(
      { id: crypto.randomUUID(), role: "user", text: message, tools: [], todos: [] },
      { id: crypto.randomUUID(), role: "assistant", text: "", tools: [{ id: "local-search", name: "local_search", subagent: null, nested: false, done: false }], todos: [], pending: true, local: true },
    );
    try {
      const out = await work(controller.signal);
      const turn = last();
      turn.tools[0]!.done = true;
      turn.text = out.text;
      turn.pending = false;
      await keep(message, ctx, record?.state ?? null);
      return out.spoken;
    } catch (e) {
      if ((e as Error).name === "AbortError") return "";
      last().pending = false;
      last().error = (e as Error).message;
      throw e;
    } finally {
      busy.value = false;
    }
  }

  function reset() {
    controller?.abort();
    record = null;
    threadId.value = crypto.randomUUID();
    turns.value = [];
  }

  async function open(id: string) {
    controller?.abort();
    const t = await store.value.getThread(id);
    if (!t) return;
    record = t;
    threadId.value = t.id;
    turns.value = t.turns;
  }

  return { turns, busy, threadId, send, sendLocal, reset, open, stop: () => controller?.abort() };
}
