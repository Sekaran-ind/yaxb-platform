// File-backed stores for Node surfaces (the CLI): one JSON file per thread, moderation as JSON lines.
// Node only: imports node:fs. Don't import this from a Worker or browser bundle.
import { appendFile, mkdir, readFile, rm, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { newModerationItem, type ModerationItem, type ModerationStore, type ThreadState, type ThreadStore } from "./index.js";

const fileFor = (dir: string, id: string) => join(dir, `${createHash("sha256").update(id).digest("hex").slice(0, 32)}.json`);

export function createFileThreadStore(dir: string): ThreadStore {
  const ready = mkdir(dir, { recursive: true, mode: 0o700 });
  return {
    async get(id) {
      await ready;
      try {
        return JSON.parse(await readFile(fileFor(dir, id), "utf8")) as ThreadState;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    },
    async put(id, state) {
      await ready;
      const file = fileFor(dir, id);
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(state), { mode: 0o600 });
      await rename(tmp, file);
    },
    async delete(id) {
      await ready;
      await rm(fileFor(dir, id), { force: true });
    },
  };
}

export function createFileModerationStore(file: string): ModerationStore {
  return {
    async add(question, reason) {
      const item = newModerationItem(question, reason);
      await appendFile(file, `${JSON.stringify(item)}\n`, { mode: 0o600 });
      return item;
    },
    async list(limit = 100) {
      let text = "";
      try {
        text = await readFile(file, "utf8");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw e;
      }
      const items: ModerationItem[] = [];
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
          items.push(JSON.parse(line) as ModerationItem);
        } catch {
          /* skip a torn line */
        }
      }
      return items.slice(-limit).reverse();
    },
  };
}
