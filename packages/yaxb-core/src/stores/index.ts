// Storage contracts the agent depends on, and in-memory implementations (tests, single-process use).
// Surfaces pick the backend: Cloudflare D1 (`/stores/d1`), files (`/stores/node`), or memory.
import type { StoredMessage } from "@langchain/core/messages";
import type { Todo } from "../events/index.js";

/** What survives between turns of a conversation: the transcript, the plan and the agent's virtual files. */
export type ThreadState = {
  messages: StoredMessage[];
  todos: Todo[];
  files: Record<string, unknown>;
};

export interface ThreadStore {
  get(threadId: string): Promise<ThreadState | null>;
  put(threadId: string, state: ThreadState): Promise<void>;
  delete(threadId: string): Promise<void>;
}

export type ModerationItem = { id: string; question: string; reason: string; created_at: string };

export interface ModerationStore {
  add(question: string, reason: string): Promise<ModerationItem>;
  list(limit?: number): Promise<ModerationItem[]>;
}

/** `limit(key)` returns true when the call is allowed. */
export interface RateLimiter {
  limit(key: string): Promise<boolean>;
}

export const MODERATION_QUESTION_MAX = 1000;
export const MODERATION_REASON_MAX = 500;

export function newModerationItem(question: string, reason: string): ModerationItem {
  return {
    id: crypto.randomUUID().replace(/-/g, ""),
    question: question.slice(0, MODERATION_QUESTION_MAX),
    reason: reason.slice(0, MODERATION_REASON_MAX),
    created_at: new Date().toISOString(),
  };
}

export function createMemoryThreadStore(): ThreadStore {
  const threads = new Map<string, string>();
  return {
    async get(id) {
      const raw = threads.get(id);
      return raw ? (JSON.parse(raw) as ThreadState) : null;
    },
    async put(id, state) {
      threads.set(id, JSON.stringify(state));
    },
    async delete(id) {
      threads.delete(id);
    },
  };
}

export function createMemoryModerationStore(maxItems = 500): ModerationStore {
  const items: ModerationItem[] = [];
  return {
    async add(question, reason) {
      const item = newModerationItem(question, reason);
      items.push(item);
      if (items.length > maxItems) items.splice(0, items.length - maxItems);
      return item;
    },
    async list(limit = 100) {
      return items.slice(-limit).reverse();
    },
  };
}

/** Sliding-window limiter for one process. On Workers use the Rate Limiting binding instead. */
export function createMemoryRateLimiter({ limit, windowMs = 60_000 }: { limit: number; windowMs?: number }): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    async limit(key) {
      const now = Date.now();
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      if (hits.size > 10_000) {
        for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
      }
      return true;
    },
  };
}
