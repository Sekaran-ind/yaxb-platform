#!/usr/bin/env node
// Entry point for yaxb-box (deploy/yaxb-box.service runs this).
import { networkInterfaces } from 'node:os';
import { createBoxServer, loadConfig } from './server.js';
import { createSiteLink } from './trust.js';
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
