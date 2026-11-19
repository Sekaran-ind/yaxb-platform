// The kiosk on a site, from a device signed in with a code (IDN-41): the CLI, a voice device. It has
// the same shape as createKiosk's for what a terminal uses (ask, providers, sources, curated,
// moderation), but runs nothing itself: every turn goes to the site's /api/agent/chat with the
// device's credential, so the device keeps no provider keys.
import { readSSE, type AgentEvent } from "../events/index.js";

export type RemoteKioskOptions = {
  /** The site, e.g. https://anjalai.cc (or an edition's address). */
  site: string;
  /** The device's credential (`anj_dev_…`). */
  token: string;
  fetch?: typeof fetch;
};

type Providers = { providers: { id: string; label?: string; configured: boolean; models: { id: string }[] }[]; default: { provider: string; model: string } };

export class RemoteError extends Error {
  override name = "RemoteError";
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** A remote kiosk: its catalogues are read once, then each turn streams from the site. */
export async function createRemoteKiosk({ site, token, fetch: f = fetch }: RemoteKioskOptions) {
  const base = site.replace(/\/+$/, "");
  const headers = { Authorization: `Bearer ${token}` };
  async function get<T>(path: string): Promise<T> {
    const res = await f(`${base}${path}`, { headers });
    const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!res.ok) throw new RemoteError(body?.error ?? `The site answered ${res.status}.`, res.status);
    return body as T;
  }
  const [providers, sources, curated] = await Promise.all([
    get<Providers>("/api/agent/providers"),
    get<{ sources: unknown[] }>("/api/agent/sources").then((r) => r.sources),
    get<{ items?: unknown[]; curated?: unknown[] }>("/api/agent/curated").then((r) => r.items ?? r.curated ?? []),
  ]);
  return {
    remote: true as const,
    providers: () => providers,
    sources: () => sources,
    curated: () => curated,
    moderation: (limit = 50) => get<{ items: unknown[] }>(`/api/agent/moderation?limit=${limit}`).then((r) => r.items),
    /** One turn. `threadId` may carry a surface prefix (`cli:<uuid>`): the site namespaces threads itself. */
    async *ask(input: { threadId: string; message: string; selection: { provider: string; model: string; temperature?: number }; settings?: unknown }, { signal }: { signal?: AbortSignal } = {}): AsyncGenerator<AgentEvent> {
      const threadId = input.threadId.replace(/^[a-z]+:/, "");
      const res = await f(`${base}/api/agent/chat`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, message: input.message, ...input.selection, ...(input.settings ? { settings: input.settings } : {}) }),
        signal,
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        yield { type: "error", message: body?.error ?? `The site answered ${res.status}.` } as AgentEvent;
        return;
      }
      yield* readSSE(res.body);
    },
  };
}
export type RemoteKiosk = Awaited<ReturnType<typeof createRemoteKiosk>>;

// ---- signing a device in (IDN-41) --------------------------------------------------------------------

export type DeviceStart = { device_code: string; user_code: string; expires_in: number; interval: number; verification_uri: string; verification_uri_complete: string };

/**
 * Sign a device in with a code: ask the site for one, tell the person where to approve it, then wait
 * until they do (or turn it down, or it expires). Returns the device's credential.
 */
export async function signInDevice({
  site,
  client,
  name,
  show,
  fetch: f = fetch,
  sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)),
  signal,
}: {
  site: string;
  client: "cli" | "box" | "kiosk" | "voice";
  name: string;
  show: (start: DeviceStart) => void;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<unknown>;
  signal?: AbortSignal;
}): Promise<{ token: string; credential: { id: string; name: string; client: string; expires_at: string } }> {
  const base = site.replace(/\/+$/, "");
  const post = async <T>(path: string, body: unknown): Promise<{ status: number; body: T & { error?: string } }> => {
    const res = await f(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify(body), signal });
    return { status: res.status, body: ((await res.json().catch(() => ({}))) ?? {}) as T & { error?: string } };
  };
  const start = await post<DeviceStart>("/api/identity/device/start", { client, name });
  if (start.status !== 200) throw new RemoteError(start.body.error ?? `The site answered ${start.status}.`, start.status);
  show(start.body);
  const until = Date.now() + start.body.expires_in * 1000;
  while (Date.now() < until) {
    if (signal?.aborted) throw new RemoteError("Stopped.", 499);
    await sleep(start.body.interval * 1000);
    const r = await post<{ status: string; token?: string; credential?: { id: string; name: string; client: string; expires_at: string } }>("/api/identity/device/token", { device_code: start.body.device_code });
    if (r.status !== 200) throw new RemoteError(r.body.error ?? `The site answered ${r.status}.`, r.status);
    if (r.body.status === "approved" && r.body.token && r.body.credential) return { token: r.body.token, credential: r.body.credential };
    if (r.body.status === "denied") throw new RemoteError("The sign-in was turned down.", 403);
    if (r.body.status === "expired") break;
  }
  throw new RemoteError("The code expired before it was approved. Run it again.", 410);
}
