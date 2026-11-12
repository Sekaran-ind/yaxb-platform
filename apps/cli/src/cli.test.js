import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { run } from './cli.js';

function sink() {
  let text = '';
  return { write: (s) => ((text += s), true), get text() { return text; } };
}

function fakeKiosk(events = [{ type: 'token', text: 'Hel' }, { type: 'token', text: 'lo.' }, { type: 'done' }]) {
  const asked = [];
  return {
    asked,
    providers: () => ({
      default: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
      providers: [
        { id: 'anthropic', label: 'Anthropic Claude', configured: true, local: false, models: [{ id: 'claude-sonnet-5-5', label: 'Sonnet' }] },
        { id: 'openai', label: 'OpenAI', configured: false, local: false, models: [{ id: 'gpt-5.5', label: 'GPT-5.5' }] },
      ],
    }),
    sources: () => [{ id: 'ehr', title: 'EHR', moderator: 'M' }],
    curated: () => [
      { id: 'qa-001', question: 'Shortcut in procedures?', answer: 'Tell your supervisor.', category: null, red_flag: false },
      { id: 'qa-002', question: 'Gifts?', answer: 'Decline.', category: null, red_flag: true },
    ],
    moderation: async () => [],
    async *ask(input) {
      asked.push(input);
      yield { type: 'tool_start', id: '1', name: 'search_knowledge_base', subagent: null, nested: false };
      yield* events;
    },
  };
}

const opts = (kiosk, extra = {}) => ({ createKiosk: async () => kiosk, stdout: sink(), stderr: sink(), ...extra });

test('ask streams the answer to stdout and activity to stderr', async () => {
  const kiosk = fakeKiosk();
  const o = opts(kiosk);
  const code = await run(['ask', 'what', 'now?'], o);
  assert.equal(code, 0);
  assert.equal(o.stdout.text, 'Hello.\n');
  assert.match(o.stderr.text, /searching the knowledge base/);
  assert.match(kiosk.asked[0].threadId, /^cli:[0-9a-f-]{36}$/);
  assert.equal(kiosk.asked[0].message, 'what now?');
  assert.deepEqual(kiosk.asked[0].selection, { provider: 'anthropic', model: 'claude-sonnet-5-5', temperature: 0.3 });
  assert.equal(kiosk.asked[0].settings.storage, 'server'); // the CLI keeps conversations in its own file store
});

test('ask --json prints one event per line', async () => {
  const o = opts(fakeKiosk());
  await run(['ask', 'hi', '--json'], o);
  const lines = o.stdout.text.trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((e) => e.type), ['tool_start', 'token', 'token', 'done']);
});

test('ask exits 1 on an agent error', async () => {
  const o = opts(fakeKiosk([{ type: 'error', message: 'OpenAI is not configured. Add its key to enable it.' }]));
  assert.equal(await run(['ask', 'hi', '--provider', 'openai'], o), 1);
  assert.match(o.stderr.text, /error: OpenAI is not configured/);
});

test('--thread continues a conversation and must be a uuid', async () => {
  const kiosk = fakeKiosk();
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
  await run(['ask', 'hi', '--thread', id], opts(kiosk));
  assert.equal(kiosk.asked[0].threadId, `cli:${id}`);
  const o = opts(kiosk);
  assert.equal(await run(['ask', 'hi', '--thread', '../../etc'], o), 2);
});

test('usage errors exit 2', async () => {
  assert.equal(await run(['ask'], opts(fakeKiosk())), 2);
  assert.equal(await run(['nope'], opts(fakeKiosk())), 2);
  assert.equal(await run(['ask', 'x', '--temperature', '5'], opts(fakeKiosk())), 2);
  assert.equal(await run(['--bogus'], opts(fakeKiosk())), 2);
});

test('providers lists models and marks the default', async () => {
  const o = opts(fakeKiosk());
  await run(['providers'], o);
  assert.match(o.stdout.text, /anthropic\s+claude-sonnet-5-5\s+yes\s+\(default\)/);
  assert.match(o.stdout.text, /openai\s+gpt-5\.5\s+no/);
});

test('curated --search filters', async () => {
  const o = opts(fakeKiosk());
  await run(['curated', '--search', 'gifts'], o);
  assert.match(o.stdout.text, /qa-002 \[red flag\]/);
  assert.doesNotMatch(o.stdout.text, /qa-001/);
});

test('chat runs turns until /exit and /new starts a new thread', async () => {
  const kiosk = fakeKiosk();
  const stdin = new PassThrough();
  const o = opts(kiosk, { stdin });
  const done = run(['chat'], o);
  stdin.write('first\n');
  stdin.write('/new\n');
  stdin.write('second\n');
  stdin.end('/exit\n');
  assert.equal(await done, 0);
  assert.deepEqual(kiosk.asked.map((a) => a.message), ['first', 'second']);
  assert.notEqual(kiosk.asked[0].threadId, kiosk.asked[1].threadId);
});

test('help and version', async () => {
  const o = opts(fakeKiosk());
  await run(['help'], o);
  assert.match(o.stdout.text, /yaxb ask/);
  const v = opts(fakeKiosk(), { version: '9.9.9' });
  await run(['--version'], v);
  assert.equal(v.stdout.text, '9.9.9\n');
});
