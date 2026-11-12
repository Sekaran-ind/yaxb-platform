// A LangGraph store (BaseStore) over a small key-value interface, so Deep Agents' StoreBackend can
// keep the agent's files (its /memories/) in whatever storage the deployment has: Cloudflare D1,
// a yaxb-box on the local network, or memory. Namespaces are stored joined with ".".
import { BaseStore, type Item, type ListNamespacesOperation, type Operation, type OperationResults, type SearchItem } from "@langchain/langgraph-checkpoint";

export type KvItem = { namespace: string[]; key: string; value: Record<string, unknown>; createdAt: string; updatedAt: string };

/** What a storage needs to provide. `search` returns items in `prefix` and every namespace below it. */
export interface Kv {
  get(namespace: string, key: string): Promise<KvItem | null>;
  put(namespace: string, key: string, value: Record<string, unknown> | null): Promise<void>;
  search(prefix: string, options: { limit: number; offset: number }): Promise<KvItem[]>;
  namespaces(options: { limit: number; offset: number }): Promise<string[][]>;
}

const NS = /^[A-Za-z0-9_:-]{1,60}$/;
/** Namespace parts are limited, so "." can join them without ambiguity. */
export function joinNamespace(parts: string[]): string {
  if (!parts.length || parts.some((p) => !NS.test(p))) throw new Error(`Bad store namespace: ${parts.join("/")}`);
  return parts.join(".");
}

const toItem = (i: KvItem): Item => ({ namespace: i.namespace, key: i.key, value: i.value, createdAt: new Date(i.createdAt), updatedAt: new Date(i.updatedAt) });

function matches(value: Record<string, unknown>, filter?: Record<string, unknown>) {
  if (!filter) return true;
  return Object.entries(filter).every(([k, v]) => JSON.stringify(value[k]) === JSON.stringify(v));
}

export class KvStore extends BaseStore {
  constructor(private readonly kv: Kv) {
    super();
  }

  async batch<Op extends Operation[]>(operations: Op): Promise<OperationResults<Op>> {
    const results: unknown[] = [];
    for (const op of operations) {
      if ("namespacePrefix" in op) {
        const limit = op.limit ?? 10;
        const offset = op.offset ?? 0;
        const items = op.namespacePrefix.length ? await this.kv.search(joinNamespace(op.namespacePrefix), { limit: limit + offset + 200, offset: 0 }) : [];
        results.push(
          items
            .filter((i) => matches(i.value, op.filter as Record<string, unknown> | undefined))
            .slice(offset, offset + limit)
            .map((i): SearchItem => ({ ...toItem(i) })),
        );
      } else if ("value" in op) {
        await this.kv.put(joinNamespace(op.namespace), op.key, op.value as Record<string, unknown> | null);
        results.push(undefined);
      } else if ("namespace" in op && "key" in op) {
        const i = await this.kv.get(joinNamespace(op.namespace), op.key);
        results.push(i ? toItem(i) : null);
      } else {
        const l = op as ListNamespacesOperation;
        let list = await this.kv.namespaces({ limit: 1000, offset: 0 });
        for (const c of l.matchConditions ?? []) {
          list = list.filter((ns) => {
            const path = c.matchType === "prefix" ? ns.slice(0, c.path.length) : ns.slice(-c.path.length);
            return path.length === c.path.length && path.every((p, idx) => c.path[idx] === "*" || c.path[idx] === p);
          });
        }
        if (l.maxDepth !== undefined) list = [...new Map(list.map((ns) => [ns.slice(0, l.maxDepth).join("."), ns.slice(0, l.maxDepth)])).values()];
        results.push(list.slice(l.offset, l.offset + l.limit));
      }
    }
    return results as OperationResults<Op>;
  }
}

/** A Kv in memory (tests, single process). */
export function createMemoryKv(): Kv {
  const items = new Map<string, KvItem>();
  const id = (ns: string, key: string) => `${ns}\u0000${key}`;
  return {
    async get(ns, key) {
      return structuredClone(items.get(id(ns, key)) ?? null);
    },
    async put(ns, key, value) {
      if (value === null) {
        items.delete(id(ns, key));
        return;
      }
      const at = new Date().toISOString();
      const prev = items.get(id(ns, key));
      items.set(id(ns, key), { namespace: ns.split("."), key, value: structuredClone(value), createdAt: prev?.createdAt ?? at, updatedAt: at });
    },
    async search(prefix, { limit, offset }) {
      return [...items.values()]
        .filter((i) => {
          const ns = i.namespace.join(".");
          return ns === prefix || ns.startsWith(`${prefix}.`);
        })
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(offset, offset + limit)
        .map((i) => structuredClone(i));
    },
    async namespaces({ limit, offset }) {
      return [...new Set([...items.values()].map((i) => i.namespace.join(".")))].sort().slice(offset, offset + limit).map((n) => n.split("."));
    },
  };
}
