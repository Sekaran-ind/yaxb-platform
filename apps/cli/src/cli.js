// yaxb: the command-line surface of yaxb-core. Every command goes through createKiosk, the same
// entry point the web and device surfaces use; this file only parses arguments and prints.
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';

export const HELP = `yaxb: talk to the YAXB kiosk agent from a terminal.

Usage
  yaxb ask "<question>" [options]   one question; the answer streams to stdout
  yaxb chat [options]                interactive conversation (/new, /providers, /exit)
  yaxb providers                     LLM providers and models, and which are configured
  yaxb sources                       the knowledge sources the kiosk answers from
  yaxb curated [--search <words>]    the moderated Q&A set
  yaxb moderation [--limit <n>]      questions the agent escalated
  yaxb help | --version

Options
  --provider <id>       anthropic | openai | google_genai | workers_ai | huggingface | mistralai | ollama
                        (default: first configured)
  --model <id>          a model from \`yaxb providers\`
  --temperature <0-1>   default 0.3
  --thread <uuid>       continue an earlier conversation (ask prints its id)
  --json                print events as JSON lines (for scripts and devices)
  --quiet               don't show tool activity

Configuration
  Provider keys come from the environment: ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY,
  CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID, HF_TOKEN, MISTRAL_API_KEY, OLLAMA_BASE_URL. If $YAXB_HOME/.env exists (default ~/.yaxb/.env) it is loaded first.
  Conversations and escalations are kept in $YAXB_HOME. With YAXB_BOX_URL and YAXB_BOX_TOKEN
  set, conversations and the agent's memory live on that yaxb-box instead.`;

const TOOL_LABELS = {
  search_knowledge_base: 'searching the knowledge base',
  list_knowledge_sources: 'checking knowledge sources',
  flag_for_moderation: 'escalating to a moderator',
  write_todos: 'planning',
  read_file: 'reading notes',
  write_file: 'writing notes',
  edit_file: 'updating notes',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class UsageError extends Error {}

function parse(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      provider: { type: 'string' },
      model: { type: 'string' },
      temperature: { type: 'string' },
      thread: { type: 'string' },
      search: { type: 'string' },
      limit: { type: 'string' },
      json: { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
  });
  return { values, command: positionals[0] ?? (values.version ? 'version' : 'help'), rest: positionals.slice(1) };
}

function selectionFrom(kiosk, values) {
  const { providers, default: fallback } = kiosk.providers();
  const provider = values.provider ?? fallback.provider;
  const entry = providers.find((p) => p.id === provider);
  const model = values.model ?? (provider === fallback.provider ? fallback.model : entry?.models[0]?.id);
  const temperature = values.temperature === undefined ? 0.3 : Number(values.temperature);
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 1) throw new UsageError('--temperature must be between 0 and 1');
  if (!model) throw new UsageError(`Unknown provider "${provider}". See \`yaxb providers\`.`);
  return { provider, model, temperature };
}

function threadFrom(values) {
  if (values.thread === undefined) return randomUUID();
  if (!UUID.test(values.thread)) throw new UsageError('--thread must be a UUID printed by an earlier `yaxb ask`');
  return values.thread.toLowerCase();
}

/** Stream one turn to the terminal. Returns true when it ended with `done`. */
async function turn(kiosk, { threadId, message, selection, values, out, err, signal }) {
  let ok = false;
  let wroteText = false;
  for await (const ev of kiosk.ask({ threadId: `cli:${threadId}`, message, selection, settings: { storage: "server" } }, { signal })) {
    if (values.json) {
      out.write(`${JSON.stringify(ev)}\n`);
      if (ev.type === 'done') ok = true;
      continue;
    }
    switch (ev.type) {
      case 'token':
        out.write(ev.text);
        wroteText = true;
        break;
      case 'tool_start':
        if (!values.quiet && ev.name !== 'write_todos') {
          const label = ev.name === 'task' && ev.subagent ? `asking the ${ev.subagent.replace(/-/g, ' ')}` : (TOOL_LABELS[ev.name] ?? ev.name);
          err.write(`  · ${label}${ev.nested ? ' (helper)' : ''}\n`);
        }
        break;
      case 'todos':
        if (!values.quiet) for (const t of ev.todos) err.write(`  ${t.status === 'completed' ? '[x]' : t.status === 'in_progress' ? '[>]' : '[ ]'} ${t.content}\n`);
        break;
      case 'error':
        if (wroteText) out.write('\n');
        err.write(`error: ${ev.message}\n`);
        return false;
      case 'done':
        ok = true;
        break;
    }
  }
  if (!values.json && wroteText) out.write('\n');
  return ok;
}

function table(rows, out) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length)));
  for (const r of rows) out.write(`${r.map((c, i) => String(c).padEnd(widths[i])).join('  ').trimEnd()}\n`);
}

/**
 * Run the CLI. `createKiosk` is injected so tests can pass a fake.
 * Returns the process exit code.
 */
export async function run(argv, { createKiosk, version = '0.0.0', stdout = process.stdout, stderr = process.stderr, stdin = process.stdin, signal } = {}) {
  let parsed;
  try {
    parsed = parse(argv);
  } catch (e) {
    stderr.write(`${e.message}\n\nRun \`yaxb help\` for usage.\n`);
    return 2;
  }
  const { values, command, rest } = parsed;
  if (values.help || command === 'help') {
    stdout.write(`${HELP}\n`);
    return 0;
  }
  if (command === 'version') {
    stdout.write(`${version}\n`);
    return 0;
  }

  try {
    const kiosk = await createKiosk();
    switch (command) {
      case 'ask': {
        const message = rest.join(' ').trim();
        if (!message) throw new UsageError('Usage: yaxb ask "<question>"');
        const threadId = threadFrom(values);
        const ok = await turn(kiosk, { threadId, message, selection: selectionFrom(kiosk, values), values, out: stdout, err: stderr, signal });
        if (!values.json) stderr.write(`(thread ${threadId}: continue with --thread ${threadId})\n`);
        return ok ? 0 : 1;
      }
      case 'chat': {
        let threadId = threadFrom(values);
        const selection = selectionFrom(kiosk, values);
        stderr.write(`yaxb chat · ${selection.provider} · ${selection.model}. /new starts over, /exit quits.\n`);
        // The line iterator buffers input, so piped lines aren't lost while a turn is streaming.
        const rl = createInterface({ input: stdin, terminal: false, crlfDelay: Infinity });
        const prompt = () => stderr.write('you> ');
        try {
          prompt();
          for await (const raw of rl) {
            const line = raw.trim();
            if (line === '/exit' || line === '/quit') break;
            if (line === '/new') {
              threadId = randomUUID();
              stderr.write('(new conversation)\n');
            } else if (line === '/providers') {
              await run(['providers'], { createKiosk: async () => kiosk, stdout, stderr });
            } else if (line) {
              stdout.write('yaxb> ');
              await turn(kiosk, { threadId, message: line, selection, values, out: stdout, err: stderr, signal });
            }
            prompt();
          }
        } finally {
          rl.close();
        }
        stderr.write('\n');
        return 0;
      }
      case 'providers': {
        const { providers, default: d } = kiosk.providers();
        if (values.json) {
          stdout.write(`${JSON.stringify({ providers, default: d })}\n`);
          return 0;
        }
        const rows = [['PROVIDER', 'MODEL', 'CONFIGURED', '']];
        for (const p of providers)
          for (const m of p.models) rows.push([p.id, m.id, p.configured ? 'yes' : 'no', p.id === d.provider && m.id === d.model ? '(default)' : '']);
        table(rows, stdout);
        return 0;
      }
      case 'sources': {
        const sources = kiosk.sources();
        if (values.json) stdout.write(`${JSON.stringify(sources)}\n`);
        else for (const s of sources) stdout.write(`${s.id.padEnd(14)} ${s.title}\n${' '.repeat(15)}moderator: ${s.moderator}\n`);
        return 0;
      }
      case 'curated': {
        const words = (values.search ?? '').toLowerCase().split(/\s+/).filter(Boolean);
        const items = kiosk.curated().filter((i) => words.every((w) => `${i.question} ${i.answer} ${i.category ?? ''}`.toLowerCase().includes(w)));
        if (values.json) stdout.write(`${JSON.stringify(items)}\n`);
        else for (const i of items) stdout.write(`${i.id}${i.red_flag ? ' [red flag]' : ''}  ${i.question}\n  ${i.answer}\n\n`);
        if (!values.json) stderr.write(`${items.length} item(s)\n`);
        return 0;
      }
      case 'moderation': {
        const limit = values.limit === undefined ? 50 : Number.parseInt(values.limit, 10);
        if (!Number.isInteger(limit) || limit < 1) throw new UsageError('--limit must be a positive number');
        const items = await kiosk.moderation(limit);
        if (values.json) stdout.write(`${JSON.stringify(items)}\n`);
        else for (const i of items) stdout.write(`${i.created_at}  ${i.reason}\n  ${i.question}\n`);
        if (!values.json && !items.length) stderr.write('Nothing escalated yet.\n');
        return 0;
      }
      default:
        throw new UsageError(`Unknown command "${command}". Run \`yaxb help\`.`);
    }
  } catch (e) {
    if (e instanceof UsageError) {
      stderr.write(`${e.message}\n`);
      return 2;
    }
    throw e;
  }
}
