#!/usr/bin/env node
// Entry point for yaxb-box (deploy/yaxb-box.service runs this).
import { networkInterfaces } from 'node:os';
import { createBoxServer, loadConfig } from './server.js';
import { createSiteLink } from './trust.js';
import { readFileSync } from 'node:fs';
import { checkConnector } from './connectors.js';
import { openDb } from './db.js';
import { hostname } from 'node:os';

const lan = () =>
  Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);

const config = loadConfig();

// `yaxb-box login --site https://anjalai.cc`: sign the box in to its owner's account (IDN-42).
if (process.argv[2] === 'login') {
  const i = process.argv.indexOf('--site');
  const site = i > 0 ? process.argv[i + 1] : 'https://anjalai.cc';
  try {
    const r = await createSiteLink(config.linkPath).login({
      site,
      name: `Box on ${hostname()}`.slice(0, 60),
      show: (s) => console.log(`\nTo sign this box in, open\n\n  ${s.verification_uri_complete}\n\non a device where you are signed in, check the code ${s.user_code}, and approve it. Waiting…`),
    });
    console.log(`yaxb-box: signed in on ${r.site} as ${r.name}. Restart the box to use it.`);
    process.exit(0);
  } catch (e) {
    console.error(`yaxb-box: ${e.message}`);
    process.exit(1);
  }
}
// `yaxb-box connector add|list|remove|secret …` (CNX-4): only whoever runs the box installs the
// connectors it may call on the office network, and sets their secrets (read from stdin, never an argument).
if (process.argv[2] === 'connector') {
  const [, , , cmd, a, b] = process.argv;
  const db = openDb(config.dbPath);
  try {
    if (cmd === 'add' && a) {
      const c = checkConnector(JSON.parse(readFileSync(a, 'utf8')));
      db.connectorPut(c);
      const need = c.auth.secret && !db.connectorSecretNames(c.id).some((x) => x.name === c.auth.secret);
      console.log(`yaxb-box: installed ${c.id} (${c.title}) → ${new URL(c.base).host}, operations ${c.operations.map((o) => o.id).join(', ')}.`);
      if (need) console.log(`Set its secret: yaxb-box connector secret ${c.id} ${c.auth.secret}  (type the value, then Ctrl-D)`);
    } else if (cmd === 'list') {
      const list = db.connectorList();
      if (!list.length) console.log('yaxb-box: no connectors installed.');
      for (const c of list) console.log(`${c.id}\t${c.title}\t${new URL(c.base).host}\t${c.operations.map((o) => o.id).join(',')}\tsecrets: ${db.connectorSecretNames(c.id).map((x) => x.name).join(',') || '-'}`);
    } else if (cmd === 'remove' && a) {
      console.log(db.connectorRemove(a) ? `yaxb-box: removed ${a} and its secrets.` : `yaxb-box: ${a} isn't installed.`);
    } else if (cmd === 'secret' && a && /^[A-Z][A-Z0-9_]{1,47}$/.test(b ?? '')) {
      if (!db.connectorGet(a)) throw new Error(`${a} isn't installed.`);
      const value = readFileSync(0, 'utf8').trim();
      if (!value) throw new Error('Give the value on stdin.');
      db.connectorSecretPut(a, b, value);
      console.log(`yaxb-box: secret ${b} set for ${a}.`);
    } else {
      console.log('Usage: yaxb-box connector add <file.json> | list | remove <id> | secret <id> <NAME>  (the value on stdin)');
      process.exitCode = 2;
    }
  } catch (e) {
    console.error(`yaxb-box: ${e.message}`);
    process.exitCode = 1;
  } finally {
    db.close();
  }
  process.exit();
}

let box;
try {
  box = createBoxServer(config);
} catch (e) {
  console.error(`yaxb-box: ${e.message}`);
  process.exit(1);
}
await box.listen();

const scheme = box.tls ? 'https' : 'http';
console.log(`yaxb-box: database ${config.dbPath}`);
for (const ip of lan()) console.log(`yaxb-box: listening on ${scheme}://${ip}:${config.port}`);
if (box.tls) console.log(`yaxb-box: certificate download on http://<box-ip>:${config.certPort}/`);
else console.warn('yaxb-box: no TLS certificate -- a kiosk served over https (Cloudflare) cannot reach an http box');
if (!config.origins.length) console.warn('yaxb-box: YAXB_BOX_ORIGINS is empty -- browsers are refused; only the CLI can use the box');

// Close the database cleanly so the last WAL frames are on disk for Litestream.
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    await box.close().catch(() => {});
    process.exit(0);
  });
}
