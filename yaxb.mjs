#!/usr/bin/env node
/**
 * YAXB runner: one script for Windows (cmd / PowerShell), macOS and Linux. Needs only Node 22+.
 *
 *   node yaxb.mjs start              Vite dev server: the Vue app + the Worker in local workerd (hot reload)
 *   node yaxb.mjs start --preview    the production build on local workerd (vite preview)
 *   node yaxb.mjs stop | restart | status | logs
 *   node yaxb.mjs cli <args>         the yaxb CLI, with provider keys from apps/web/.dev.vars
 *   node yaxb.mjs test               core tests, CLI tests, web typecheck + lint
 *   node yaxb.mjs deploy             D1 migrations + Worker deploy to Cloudflare
 *
 * Commands also work as flags (--start, --stop, ...). Options: --preview (alias --prod), --port N.
 * First start installs dependencies, builds yaxb-core, creates apps/web/.dev.vars with generated
 * secrets, and applies the D1 migrations locally. Logs and PIDs live in .run/ (git-ignored).
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const CORE_DIR = join(ROOT, "packages", "yaxb-core");
const WEB_DIR = join(ROOT, "apps", "web");
const CLI_MAIN = join(ROOT, "apps", "cli", "src", "main.js");
const DEV_VARS = join(WEB_DIR, ".dev.vars");
const RUN_DIR = join(ROOT, ".run");
const LOG_DIR = join(RUN_DIR, "logs");
const WIN = process.platform === "win32";
const SERVICES = ["core", "web", "box"];
const BOX_DIR = join(ROOT, "apps", "box");
const BOX_RUN = join(RUN_DIR, "box");
const PROVIDER_KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY", "HF_TOKEN", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "MISTRAL_API_KEY", "OLLAMA_BASE_URL"];
const bin = (pkg, ...path) => join(ROOT, "node_modules", pkg, ...path);
const VITE = bin("vite", "bin", "vite.js");
const VUE_TSC = bin("vue-tsc", "bin", "vue-tsc.js");
const TSC = bin("typescript", "bin", "tsc");
const WRANGLER = bin("wrangler", "bin", "wrangler.js");

// ---------- output ----------
const paint = (code) => (s) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const cyan = paint(36), yellow = paint(33), red = paint(31), green = paint(32), dim = paint(2);
const info = (m) => console.log(cyan(`[yaxb] ${m}`));
const warn = (m) => console.log(yellow(`[yaxb] ${m}`));
class Fail extends Error {}
const fail = (m) => {
  throw new Fail(m);
};

// ---------- args ----------
const COMMANDS = ["start", "stop", "restart", "status", "logs", "cli", "test", "deploy", "box", "box-deploy", "help"];

function parseArgs(argv) {
  const opts = { command: null, mode: "dev", port: 3000, rest: [], host: null, origins: null, boxPort: 47870 };
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (opts.command === "cli") {
      opts.rest.push(raw); // everything after `cli` belongs to the CLI
      continue;
    }
    const [flag, inline] = raw.split("=", 2);
    const value = () => inline ?? argv[++i];
    const name = flag.replace(/^-{1,2}/, "");
    if (COMMANDS.includes(name)) opts.command = name;
    else if (name === "h") opts.command = "help";
    else if (name === "preview" || name === "prod") opts.mode = "preview";
    else if (name === "dev") opts.mode = "dev";
    else if (name === "port" || name === "web-port") opts.port = Number(value());
    else if (name === "host") opts.host = value();
    else if (name === "origins") opts.origins = value();
    else if (name === "box-port") opts.boxPort = Number(value());
    else fail(`Unknown option "${raw}". Run: node yaxb.mjs help`);
  }
  if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) fail(`Invalid port: ${opts.port}`);
  opts.command ??= "help";
  return opts;
}

const HELP = `
YAXB runner

  node yaxb.mjs <command> [options]

Commands (also accepted as flags, e.g. --start):
  start      Start the web app in the background
  stop       Stop it
  restart    Stop, then start
  status     Show what's running and whether it responds
  logs       Print the last 40 lines of each log
  cli ...    Run the yaxb CLI, e.g.  node yaxb.mjs cli ask "visiting hours?"
  test       yaxb-core tests, CLI tests, web typecheck and lint
  deploy     Apply D1 migrations and deploy the Worker (needs \`npx wrangler login\`)
  box        Run a yaxb-box on this computer (local storage for testing; stop with stop)
  box-deploy Install yaxb-box on a Raspberry Pi over SSH:
               node yaxb.mjs box-deploy --host <user>@192.168.1.14 [--origins "http://localhost:3000 https://…"]

Options:
  --preview         Run the production build on local workerd (vite preview) instead of vite dev
                    (alias: --prod)
  --port <n>        Web port (default 3000)

Examples:
  node yaxb.mjs start
  node yaxb.mjs --start --preview --port 8787
  node yaxb.mjs cli chat
`;

// ---------- state ----------
const pidFile = (name) => join(RUN_DIR, `${name}.pid`);
const stateFile = join(RUN_DIR, "state.json");

function readPid(name) {
  try {
    return Number(readFileSync(pidFile(name), "utf8").trim()) || null;
  } catch {
    return null;
  }
}

function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

const running = (name) => alive(readPid(name));

function readState() {
  try {
    return JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    return null;
  }
}

// ---------- secrets (.dev.vars) ----------
const secret = (bytes = 48) => randomBytes(bytes).toString("base64url");

function readVars(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

function setVar(file, key, value) {
  const text = readFileSync(file, "utf8");
  const re = new RegExp(`^\\s*${key}\\s*=.*$`, "m");
  const next = re.test(text) ? text.replace(re, `${key}=${value}`) : `${text.replace(/\s*$/, "\n")}${key}=${value}\n`;
  writeFileSync(file, next, { mode: 0o600 });
}

function ensureDevVars() {
  if (!existsSync(DEV_VARS)) {
    copyFileSync(join(WEB_DIR, ".dev.vars.example"), DEV_VARS);
    info("Created apps/web/.dev.vars");
  }
  const vars = readVars(DEV_VARS);
  if (!vars.SESSION_SECRET || vars.SESSION_SECRET.length < 32) {
    setVar(DEV_VARS, "SESSION_SECRET", secret());
    info("Generated SESSION_SECRET");
  }
  if (!vars.MODERATOR_TOKEN) {
    const token = secret(24);
    setVar(DEV_VARS, "MODERATOR_TOKEN", token);
    info(`Generated MODERATOR_TOKEN (moderator sign-in on /kiosk/curate): ${token}`);
  }
  if (!vars.ADMIN_TOKEN) {
    const token = secret(32);
    setVar(DEV_VARS, "ADMIN_TOKEN", token);
    info(`Generated ADMIN_TOKEN (administrator sign-in on /kiosk/admin: issue and manage moderator keys): ${token}`);
  }
  if (!PROVIDER_KEYS.some((k) => vars[k])) {
    warn("No LLM provider configured. Add a key to apps/web/.dev.vars (e.g. ANTHROPIC_API_KEY) to chat in the kiosk.");
  }
}

// ---------- setup ----------
function run(cmd, args, cwd, what, { quiet = false } = {}) {
  const r = spawnSync(cmd, args, { cwd, stdio: quiet ? "pipe" : "inherit", encoding: "utf8" });
  if (r.status !== 0) {
    if (quiet) console.log(dim(`${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n").slice(-25).join("\n")));
    fail(`${what} failed.`);
  }
  return r;
}

const node = (script, args, cwd, what, o) => run(process.execPath, [script, ...args], cwd, what, o);

function ensureSetup() {
  if (!existsSync(VITE) || !existsSync(WRANGLER)) {
    info("Installing dependencies (first run)...");
    // npm is a .cmd shim on Windows, which needs a shell to execute.
    const r = spawnSync(WIN ? "npm.cmd" : "npm", ["install", "--no-audit", "--no-fund"], { cwd: ROOT, stdio: "inherit", shell: WIN });
    if (r.status !== 0) fail("npm install failed.");
  }
  info("Building yaxb-core...");
  node(TSC, ["-p", "tsconfig.build.json"], CORE_DIR, "Building yaxb-core", { quiet: true });
  ensureDevVars();
  node(WRANGLER, ["d1", "migrations", "apply", "yaxb", "--local"], WEB_DIR, "Applying local D1 migrations", { quiet: true });
}

// ---------- process control ----------
function portInUse(port) {
  const probe = (host) =>
    new Promise((resolve) => {
      const s = net.connect({ port, host });
      s.setTimeout(500);
      s.once("connect", () => (s.destroy(), resolve(true)));
      s.once("timeout", () => (s.destroy(), resolve(false)));
      s.once("error", () => resolve(false));
    });
  return Promise.all([probe("127.0.0.1"), probe("::1")]).then((r) => r.some(Boolean));
}

function launch(name, args, cwd) {
  const out = openSync(join(LOG_DIR, `${name}.log`), "w");
  // Run tools with this Node binary (no npm/cmd shim), so the PID is the real process.
  // detached: own process group on POSIX (stop kills the group); own console on Windows.
  const child = spawn(process.execPath, args, { cwd, detached: true, windowsHide: true, stdio: ["ignore", out, out] });
  child.unref();
  writeFileSync(pidFile(name), String(child.pid));
  return child.pid;
}

function killTree(pid) {
  if (WIN) {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function responds(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(3000), redirect: "manual" });
    return true; // any HTTP status means the server is up
  } catch {
    return false;
  }
}

async function waitFor(name, url, seconds) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (await responds(url)) return;
    if (!running(name)) {
      warn(`${name} exited during startup. Last log lines:`);
      printTail(name, 25);
      fail(`${name} failed to start.`);
    }
    await sleep(700);
  }
  fail(`${name} did not respond at ${url} within ${seconds}s. See .run/logs/${name}.log`);
}

function printTail(name, lines) {
  const file = join(LOG_DIR, `${name}.log`);
  if (!existsSync(file)) return console.log(dim(`  (no ${name} log yet)`));
  const text = readFileSync(file, "utf8").trimEnd().split(/\r?\n/).slice(-lines).join("\n");
  console.log(dim(text || `  (${name} log is empty)`));
}

// ---------- commands ----------
async function start(opts) {
  mkdirSync(LOG_DIR, { recursive: true });
  for (const s of SERVICES) if (running(s)) fail(`${s} is already running. Run: node yaxb.mjs stop`);
  if (await portInUse(opts.port)) fail(`Port ${opts.port} is in use. Free it or pass --port.`);

  ensureSetup();
  const preview = opts.mode === "preview";
  if (preview) {
    info("Building the app and the Worker (Vite)...");
    const build = spawnSync(process.execPath, [VITE, "build"], { cwd: WEB_DIR, encoding: "utf8" });
    writeFileSync(join(LOG_DIR, "web-build.log"), `${build.stdout ?? ""}${build.stderr ?? ""}`);
    if (build.status !== 0) fail("Build failed. See .run/logs/web-build.log");
    info(`Starting the production build on http://localhost:${opts.port} (local workerd) ...`);
    launch("web", [VITE, "preview", "--port", String(opts.port), "--strictPort"], WEB_DIR);
  } else {
    launch("core", [TSC, "-p", "tsconfig.build.json", "--watch", "--preserveWatchOutput"], CORE_DIR);
    info(`Starting web on http://localhost:${opts.port} (vite dev, Worker in local workerd) ...`);
    launch("web", [VITE, "--port", String(opts.port), "--strictPort"], WEB_DIR);
  }
  await waitFor("web", `http://localhost:${opts.port}/faq`, 180);

  writeFileSync(stateFile, JSON.stringify({ mode: opts.mode, port: opts.port, startedAt: new Date().toISOString() }));
  const base = `http://localhost:${opts.port}`;
  console.log(`
  ${green("YAXB is running")} ${dim(`(${preview ? "Worker preview" : "dev"})`)}
    Site      ${base}
    Kiosk     ${base}/kiosk
    Settings  ${base}/settings
    CLI       node yaxb.mjs cli chat
    Logs      .run/logs/   (node yaxb.mjs logs)
    Stop      node yaxb.mjs stop
`);
}

async function stop({ quiet = false } = {}) {
  let stopped = 0;
  for (const name of ["web", "core", "box"]) {
    const pid = readPid(name);
    if (alive(pid)) {
      killTree(pid);
      for (let i = 0; i < 20 && alive(pid); i++) await sleep(250);
      if (alive(pid) && !WIN) {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          /* gone */
        }
      }
      if (!quiet) info(`Stopped ${name} (pid ${pid})`);
      stopped++;
    }
    rmSync(pidFile(name), { force: true });
  }
  rmSync(stateFile, { force: true });
  if (!quiet && stopped === 0) warn("Nothing was running.");
}

async function status() {
  const state = readState();
  const url = `http://localhost:${state?.port ?? 3000}`;
  for (const name of SERVICES) {
    const pid = readPid(name);
    if (!alive(pid)) {
      console.log(`  ${name.padEnd(5)} ${dim("stopped")}`);
      continue;
    }
    const detail = name === "web" ? `${(await responds(`${url}/faq`)) ? green("running") : yellow("starting/unresponsive")}  pid ${pid}  ${dim(url)}` : `${green("watching")}  pid ${pid}`;
    console.log(`  ${name.padEnd(5)} ${detail}`);
  }
  if (state) console.log(dim(`  mode ${state.mode}, started ${state.startedAt}`));
}

function logs() {
  for (const name of SERVICES) {
    console.log(cyan(`--- ${name} ---`));
    printTail(name, 40);
  }
}

function cli(rest) {
  if (!existsSync(join(CORE_DIR, "dist", "agent", "index.js"))) {
    info("Building yaxb-core...");
    node(TSC, ["-p", "tsconfig.build.json"], CORE_DIR, "Building yaxb-core", { quiet: true });
  }
  // Same provider keys as the local web app; real environment variables win.
  const vars = readVars(DEV_VARS);
  const env = { ...process.env };
  for (const k of PROVIDER_KEYS) if (vars[k] && !env[k]) env[k] = vars[k];
  const r = spawnSync(process.execPath, [CLI_MAIN, ...rest], { stdio: "inherit", env });
  process.exitCode = r.status ?? 1;
}

function test() {
  info("yaxb-core tests");
  node(bin("vitest", "vitest.mjs"), ["run"], CORE_DIR, "yaxb-core tests");
  node(TSC, ["--noEmit"], CORE_DIR, "yaxb-core typecheck");
  node(TSC, ["-p", "tsconfig.build.json"], CORE_DIR, "Building yaxb-core", { quiet: true });
  info("CLI tests");
  run(process.execPath, ["--test", "src/cli.test.js"], join(ROOT, "apps", "cli"), "CLI tests");
  info("yaxb-box tests");
  run(process.execPath, ["--disable-warning=ExperimentalWarning", "--test", "test/box.test.js"], BOX_DIR, "yaxb-box tests");
  info("Web typecheck and lint");
  node(VUE_TSC, ["-b"], WEB_DIR, "Web typecheck");
  node(bin("eslint", "bin", "eslint.js"), ["."], WEB_DIR, "Web lint");
  console.log(green("\n  All checks passed.\n"));
}

function deploy() {
  const config = readFileSync(join(WEB_DIR, "wrangler.jsonc"), "utf8");
  if (config.includes('"database_id": "00000000-0000-0000-0000-000000000000"')) {
    fail("Set the D1 database id first: run `npx wrangler d1 create yaxb` in apps/web and put the id in wrangler.jsonc.");
  }
  ensureSetup();
  info("Applying D1 migrations (remote)...");
  node(WRANGLER, ["d1", "migrations", "apply", "yaxb", "--remote"], WEB_DIR, "Remote D1 migrations");
  info("Building and deploying the Worker...");
  node(VITE, ["build"], WEB_DIR, "Build");
  node(WRANGLER, ["deploy"], WEB_DIR, "Worker deploy");
  console.log(`
  ${green("Deployed.")} Set any missing secrets with:  cd apps/web && npx wrangler secret put <NAME>
  ${dim("Required: SESSION_SECRET and at least one provider key. Optional: MODERATOR_TOKEN, AIRTABLE_*, MAILCHIMP_*.")}
`);
}

// ---------- yaxb-box ----------
function boxToken() {
  mkdirSync(BOX_RUN, { recursive: true });
  const file = join(BOX_RUN, "token");
  if (!existsSync(file)) writeFileSync(file, secret(36), { mode: 0o600 });
  return readFileSync(file, "utf8").trim();
}

/** A yaxb-box on this computer: plain HTTP on localhost, data in .run/box (no Litestream). */
async function boxLocal(opts) {
  mkdirSync(LOG_DIR, { recursive: true });
  if (running("box")) fail("yaxb-box is already running. Run: node yaxb.mjs stop");
  if (await portInUse(opts.boxPort)) fail(`Port ${opts.boxPort} is in use. Pass --box-port.`);
  const token = boxToken();
  const out = openSync(join(LOG_DIR, "box.log"), "w");
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", join(BOX_DIR, "src", "main.js")], {
    cwd: BOX_DIR,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", out, out],
    env: {
      ...process.env,
      YAXB_BOX_PORT: String(opts.boxPort),
      YAXB_BOX_HOST: "127.0.0.1",
      YAXB_BOX_DB: join(BOX_RUN, "yaxb-box.sqlite3"),
      YAXB_BOX_TOKEN: token,
      YAXB_BOX_ORIGINS: opts.origins ?? `http://localhost:${opts.port} http://127.0.0.1:${opts.port}`,
    },
  });
  child.unref();
  writeFileSync(pidFile("box"), String(child.pid));
  await waitFor("box", `http://127.0.0.1:${opts.boxPort}/health`, 20);
  console.log(`
  ${green("yaxb-box is running")} ${dim("(local, for testing; the Pi version adds HTTPS and Litestream)")}
    URL     http://localhost:${opts.boxPort}
    Token   ${token}
    Use it  Kiosk Settings -> Storage -> Local box, or for the CLI:
            YAXB_BOX_URL=http://localhost:${opts.boxPort} YAXB_BOX_TOKEN=<token> node yaxb.mjs cli chat
`);
}

/** Package apps/box, copy it to the Pi and run its install.sh there (asks for your SSH and sudo password). */
function boxDeploy(opts) {
  if (!opts.host || !/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$/.test(opts.host)) fail("Pass the Pi as --host <user>@<address>, e.g. --host pi@192.168.1.14");
  const stage = join(RUN_DIR, "box-bundle", "yaxb-box");
  rmSync(join(RUN_DIR, "box-bundle"), { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  // Scripts and units must reach Linux with LF line endings, whatever git did to them here.
  const copy = (rel) => {
    const src = join(BOX_DIR, rel);
    const dst = join(stage, rel);
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, readFileSync(src, "utf8").replace(/\r\n/g, "\n"), { mode: rel.endsWith(".sh") ? 0o755 : 0o644 });
  };
  for (const rel of ["package.json", "src/main.js", "src/server.js", "src/db.js", "README.md", "deploy/install.sh", "deploy/make-cert.sh", "deploy/restore-if-empty.sh", "deploy/litestream.yml", "deploy/yaxb-box.service", "deploy/yaxb-box.env.example"]) copy(rel);
  const tarball = join(RUN_DIR, "yaxb-box.tar.gz");
  // Relative paths: GNU tar (Git Bash) reads "C:\…" as a remote host; Windows' bsdtar is fine either way.
  run("tar", ["-czf", "yaxb-box.tar.gz", "-C", "box-bundle", "yaxb-box"], RUN_DIR, "Packing yaxb-box");
  info(`Copying yaxb-box to ${opts.host} (you may be asked for the Pi's password)...`);
  run("scp", [tarball, `${opts.host}:/tmp/yaxb-box.tar.gz`], ROOT, "Copying to the Pi");
  const origins = (opts.origins ?? `http://localhost:${opts.port}`).replace(/[^A-Za-z0-9:/.,_ -]/g, "");
  const remote = [
    "set -e",
    "sudo mkdir -p /opt/yaxb-box",
    "sudo tar -xzf /tmp/yaxb-box.tar.gz -C /opt --no-same-owner",
    "rm -f /tmp/yaxb-box.tar.gz",
    `sudo YAXB_BOX_ORIGINS='${origins}' bash /opt/yaxb-box/deploy/install.sh`,
  ].join(" && ");
  info("Installing on the Pi (sudo may ask for the password)...");
  run("ssh", ["-t", opts.host, remote], ROOT, "Installing on the Pi");
  console.log(`
  ${green("yaxb-box is installed.")} Copy the URL and token above into Kiosk Settings -> Storage -> Local box.
  ${dim("On each device: open the certificate page shown above once, and trust the certificate.")}
`);
}

// ---------- main ----------
try {
  const opts = parseArgs(process.argv.slice(2));
  switch (opts.command) {
    case "start":
      await start(opts);
      break;
    case "stop":
      await stop();
      break;
    case "restart":
      await stop({ quiet: true });
      await start(opts);
      break;
    case "status":
      await status();
      break;
    case "logs":
      logs();
      break;
    case "cli":
      cli(opts.rest);
      break;
    case "test":
      test();
      break;
    case "box":
      await boxLocal(opts);
      break;
    case "box-deploy":
      boxDeploy(opts);
      break;
    case "deploy":
      deploy();
      break;
    default:
      console.log(HELP);
  }
} catch (e) {
  if (e instanceof Fail) {
    console.error(red(`[yaxb] ${e.message}`));
    process.exit(1);
  }
  throw e;
}
