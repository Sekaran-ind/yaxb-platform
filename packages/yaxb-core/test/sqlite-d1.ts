// D1's prepare/bind/first/all/run over node:sqlite, with every migration applied, for store tests.
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { D1Like } from "../src/stores/d1.js";

/** D1's prepare/bind/first/all/run over node:sqlite, with every migration applied. */
export function sqliteD1(): D1Like {
  const db = new DatabaseSync(":memory:");
  const dir = new URL("../migrations/", import.meta.url);
  for (const f of readdirSync(dir).sort()) db.exec(readFileSync(new URL(f, dir), "utf8"));
  // D1 binds ?1..?N positionally (a number may repeat); node:sqlite doesn't, so expand them to plain ?s.
  const expand = (sql: string, values: unknown[]) => {
    const args: unknown[] = [];
    const text = sql.replace(/\?(\d+)/g, (_, n: string) => (args.push(values[Number(n) - 1] ?? null), "?"));
    return { text, args: args as never[] };
  };
  const statement = (sql: string, values: unknown[] = []) => ({
    bind: (...v: unknown[]) => statement(sql, v),
    first: async <T>() => {
      const { text, args } = expand(sql, values);
      return (db.prepare(text).get(...args) as T | undefined) ?? null;
    },
    all: async <T>() => {
      const { text, args } = expand(sql, values);
      return { results: db.prepare(text).all(...args) as T[] };
    },
    run: async () => {
      const { text, args } = expand(sql, values);
      return db.prepare(text).run(...args);
    },
  });
  return { prepare: (sql) => statement(sql) };
}
