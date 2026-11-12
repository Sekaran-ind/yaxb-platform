#!/usr/bin/env node
// Entry point for yaxb-box (deploy/yaxb-box.service runs this).
import { networkInterfaces } from 'node:os';
import { createBoxServer, loadConfig } from './server.js';

const lan = () =>
  Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);

const config = loadConfig();
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
