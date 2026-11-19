// The kiosk on a site, from a device signed in with a code (IDN-41): a fake site here.
import { describe, expect, it } from "vitest";
import { encodeSSE, type AgentEvent } from "../src/events/index.js";
import { createRemoteKiosk, signInDevice } from "../src/remote/index.js";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("the remote kiosk", () => {
  it("reads the catalogues once and streams a turn with the device's credential", async () => {
    const seen: { url: string; auth: string | null; body?: unknown }[] = [];
    const fake: typeof fetch = async (input, init) => {
      const url = String(input);
      const auth = new Headers(init?.headers).get("authorization");
      seen.push({ url, auth, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith("/api/agent/providers")) return json({ providers: [{ id: "workers_ai", configured: true, models: [{ id: "m" }] }], default: { provider: "workers_ai", model: "m" } });
      if (url.endsWith("/api/agent/sources")) return json({ sources: [{ id: "s", title: "S" }] });
      if (url.endsWith("/api/agent/curated")) return json({ items: [{ id: "q1" }] });
      if (url.endsWith("/api/agent/chat")) {
        const events: AgentEvent[] = [{ type: "token", text: "Hello" } as AgentEvent, { type: "done" } as AgentEvent];
        return new Response(new ReadableStream({ start: (c) => (events.forEach((e) => c.enqueue(encodeSSE(e))), c.close()) }), { headers: { "content-type": "text/event-stream" } });
      }
      if (url.includes("/api/agent/moderation")) return json({ error: "Moderator sign-in required." }, 401);
      return json({ error: "no" }, 404);
    };
    const k = await createRemoteKiosk({ site: "https://anjalai.cc/", token: "anj_dev_x", fetch: fake });
    expect(k.providers().default.provider).toBe("workers_ai");
    expect(k.sources()).toHaveLength(1);
    expect(k.curated()).toHaveLength(1);
    const out: AgentEvent[] = [];
    for await (const e of k.ask({ threadId: "cli:3f1c0a52-8d3e-4a7e-9a55-0b8d6a1e2c11", message: "Hi", selection: { provider: "workers_ai", model: "m", temperature: 0.3 }, settings: { storage: "server" } })) out.push(e);
    expect(out.map((e) => e.type)).toEqual(["token", "done"]);
    const chat = seen.find((s) => s.url.endsWith("/chat"))!;
    expect(chat.auth).toBe("Bearer anj_dev_x");
    expect(chat.body).toMatchObject({ threadId: "3f1c0a52-8d3e-4a7e-9a55-0b8d6a1e2c11", message: "Hi", provider: "workers_ai", model: "m" });
    await expect(k.moderation()).rejects.toThrow(/Moderator sign-in required/);
    expect(seen.every((s) => s.auth === "Bearer anj_dev_x")).toBe(true);
  });

  it("signs a device in: shows the code, waits, and gets its credential", async () => {
    let polls = 0;
    const fake: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/device/start")) return json({ device_code: "dc", user_code: "BCDF-GHJK", expires_in: 600, interval: 5, verification_uri: "https://anjalai.cc/link", verification_uri_complete: "https://anjalai.cc/link?code=BCDF-GHJK" });
      if (url.endsWith("/device/token")) return json(++polls < 3 ? { status: "pending" } : { status: "approved", token: "anj_dev_t", credential: { id: "c1", name: "Laptop", client: "cli", expires_at: "2027-11-19" } });
      return json({}, 404);
    };
    let shown = "";
    const r = await signInDevice({ site: "https://anjalai.cc", client: "cli", name: "Laptop", show: (s) => (shown = s.user_code), fetch: fake, sleep: async () => undefined });
    expect(shown).toBe("BCDF-GHJK");
    expect(r.token).toBe("anj_dev_t");
    expect(polls).toBe(3);
    const denied: typeof fetch = async (input) => (String(input).endsWith("/device/start") ? fake(input) : json({ status: "denied" }));
    await expect(signInDevice({ site: "https://anjalai.cc", client: "cli", name: "x", show: () => undefined, fetch: denied, sleep: async () => undefined })).rejects.toThrow(/turned down/);
  });
});
