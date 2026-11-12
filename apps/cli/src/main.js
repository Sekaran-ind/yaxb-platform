#!/usr/bin/env node
// Entry point: wires yaxb-core to the environment and files under $YAXB_HOME, then runs the CLI.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createKiosk } from '@sekaran-ind/yaxb-core/agent';
import { createBoxClient, createBoxThreadStore } from '@sekaran-ind/yaxb-core/stores/box';
import { KvStore } from '@sekaran-ind/yaxb-core/stores/kv';
import { createFileModerationStore, createFileThreadStore } from '@sekaran-ind/yaxb-core/stores/node';
import { run } from './cli.js';

const home = process.env.YAXB_HOME || join(homedir(), '.yaxb');
const envFile = join(home, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const controller = new AbortController();
process.once('SIGINT', () => {
  controller.abort();
  process.stderr.write('\n');
  process.exit(130);
});

const code = await run(process.argv.slice(2), {
  version,
  signal: controller.signal,
  createKiosk: async () => {
    mkdirSync(home, { recursive: true, mode: 0o700 });
    // With a yaxb-box configured, conversations and the agent's long-term memory (Deep Agents
    // StoreBackend) live on the box; otherwise conversations are files in $YAXB_HOME.
    const { YAXB_BOX_URL: boxUrl, YAXB_BOX_TOKEN: boxToken } = process.env;
    const box = boxUrl && boxToken ? createBoxClient({ url: boxUrl, token: boxToken }) : null;
    return createKiosk({
      env: process.env,
      threads: box ? createBoxThreadStore(box) : createFileThreadStore(join(home, 'threads')),
      store: box ? new KvStore(box.kv()) : undefined,
      moderation: createFileModerationStore(join(home, 'moderation.jsonl')),
      // Failures go to stderr without message content.
      onError: (e, ctx) => process.stderr.write(`[yaxb] ${ctx.where} failed: ${e?.name ?? 'Error'}${process.env.YAXB_DEBUG ? `: ${e?.message}` : ''}\n`),
    });
  },
});
process.exitCode = code;
