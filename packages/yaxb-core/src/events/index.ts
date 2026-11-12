// The event protocol between yaxb-core's agent and every surface (web SSE, CLI, devices).
// Changing an event's shape is a breaking change for all surfaces: bump the minor version.
import type { ThreadState } from "../stores/index.js";

export type Todo = { content: string; status: "pending" | "in_progress" | "completed" };

export type AgentEvent =
  | { type: "token"; text: string }
  | { type: "tool_start"; id: string; name: string; subagent: string | null; nested: boolean }
  | { type: "tool_end"; id: string; name: string; nested: boolean }
  | { type: "todos"; todos: Todo[] }
  /**
   * Sent just before `done`: the conversation to keep (browser or box storage; null when the server
   * keeps it) and the notebook memory after the turn (null when memory is off).
   */
  | { type: "state"; thread: ThreadState | null; memory: string | null }
  | { type: "done" }
  | { type: "error"; message: string };

const encoder = new TextEncoder();

/** One Server-Sent Events frame. */
export function encodeSSE(event: AgentEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

/** A ReadableStream of SSE frames from an event iterator, with a keep-alive comment every `pingMs`. */
export function toSSEStream(events: AsyncIterable<AgentEvent>, { pingMs = 15000 } = {}): ReadableStream<Uint8Array> {
  let timer: ReturnType<typeof setInterval> | undefined;
  let iterator: AsyncIterator<AgentEvent> | undefined;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      iterator = events[Symbol.asyncIterator]();
      timer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          clearInterval(timer);
        }
      }, pingMs);
    },
    async pull(controller) {
      const next = await iterator!.next();
      if (next.done) {
        clearInterval(timer);
        controller.close();
      } else {
        controller.enqueue(encodeSSE(next.value));
      }
    },
    async cancel() {
      clearInterval(timer);
      await iterator?.return?.(undefined);
    },
  });
}

/** Parse an SSE byte stream back into AgentEvents. Comments and malformed frames are skipped. */
export async function* readSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<AgentEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const data = frame
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        if (!data) continue;
        try {
          yield JSON.parse(data) as AgentEvent;
        } catch {
          /* malformed frame */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
