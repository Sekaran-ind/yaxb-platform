// The team's signaling relay (TEAM-10, TEAM-20, TEAM-50): one Durable Object holds who is online
// (presence and invitations) and pairs two members' devices for a chat or a call. It forwards
// offers, answers and ICE candidates unread; messages and media then go device to device. It
// never sees or stores a chat message.
import { PairingHub, Presence, type Availability } from "@sekaran-ind/yaxb-core/team";
import { DurableObject } from "cloudflare:workers";

/** Headers the Worker sets after checking the member (never taken from the browser). */
export const HUB_HEADERS = { kind: "x-yaxb-kind", member: "x-yaxb-member", room: "x-yaxb-room", availability: "x-yaxb-availability" } as const;

export class TeamHub extends DurableObject {
  private hub = new PairingHub<WebSocket>();
  private presence = new Presence<WebSocket>();

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
    const kind = request.headers.get(HUB_HEADERS.kind);
    const member = request.headers.get(HUB_HEADERS.member) ?? "";
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();

    if (kind === "presence") {
      const availability = (request.headers.get(HUB_HEADERS.availability) ?? "available") as Availability;
      this.presence.add(server, member, availability);
      server.addEventListener("message", (e) => typeof e.data === "string" && e.data.length < 2000 && this.presence.message(server, e.data));
      const gone = () => this.presence.remove(server);
      server.addEventListener("close", gone);
      server.addEventListener("error", gone);
    } else {
      const room = request.headers.get(HUB_HEADERS.room) ?? "";
      if (this.hub.join(room, server, member)) {
        // Offers carry SDP (a few KB); anything far larger isn't signaling.
        server.addEventListener("message", (e) => typeof e.data === "string" && e.data.length < 64_000 && this.hub.relay(room, server, e.data));
        const gone = () => this.hub.leave(room, server);
        server.addEventListener("close", gone);
        server.addEventListener("error", gone);
      }
    }
    return new Response(null, { status: 101, webSocket: client });
  }
}
