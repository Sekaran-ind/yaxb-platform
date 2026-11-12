// Device-to-device chat and video between team members (TEAM-10..12, TEAM-20, TEAM-21, TEAM-23),
// after clinux-desk's p2pChat.js and p2pVideo.js. The server only introduces the two devices
// (worker/team.ts); messages, camera, microphone and screen go over WebRTC, encrypted end to end
// (TEAM-51). The only other server in the path is the STUN server that finds a route.

const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.cloudflare.com:3478" }];

/** Close codes from the relay (yaxb-core team). */
const CLOSE_REASONS: Record<number, string> = {
  4403: "You can't join this conversation.",
  4409: "You're already in this with them on another device.",
};

const wsUrl = (path: string) => `${location.origin.replace(/^http/, "ws")}${path}`;

export type Online = { id: string; availability: "available" | "busy" | "away" };
export type Invitation = { type: "invite" | "cancel" | "decline" | "unavailable"; from?: string; to?: string; channel: "chat" | "video" };

// ---- presence ---------------------------------------------------------------------------------------

/** Who is online, and invitations to a chat or a call. Reconnects on its own. */
export class TeamPresence {
  private ws: WebSocket | null = null;
  private closed = false;
  private retry = 1000;
  constructor(
    private on: { presence: (online: Online[]) => void; invitation: (i: Invitation) => void; connected?: (yes: boolean) => void },
    private open: (url: string) => WebSocket = (url) => new WebSocket(url),
  ) {}

  connect() {
    this.closed = false;
    const ws = this.open(wsUrl("/api/team/presence"));
    this.ws = ws;
    ws.addEventListener("open", () => {
      this.retry = 1000;
      this.on.connected?.(true);
    });
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(String(e.data)) as { type: string; online?: Online[] };
      if (msg.type === "presence") this.on.presence(msg.online ?? []);
      else this.on.invitation(msg as Invitation);
    });
    ws.addEventListener("close", () => {
      this.on.connected?.(false);
      if (this.closed) return;
      setTimeout(() => !this.closed && this.connect(), this.retry);
      this.retry = Math.min(this.retry * 2, 30_000);
    });
  }

  private send(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
  invite = (to: string, channel: "chat" | "video") => this.send({ type: "invite", to, channel });
  cancel = (to: string, channel: "chat" | "video") => this.send({ type: "cancel", to, channel });
  decline = (to: string, channel: "chat" | "video") => this.send({ type: "decline", to, channel });
  availability = (value: Online["availability"]) => this.send({ type: "availability", value });

  close() {
    this.closed = true;
    this.ws?.close();
  }
}

// ---- signaling, shared by chat and video ----------------------------------------------------------------

type Signal = { type: "ready"; initiator: boolean } | { type: "offer" | "answer"; sdp: RTCSessionDescriptionInit } | { type: "ice"; candidate: RTCIceCandidateInit } | { type: "peer-left" };

/** One RTCPeerConnection negotiated over the relay's room for this pair and channel. */
abstract class PeerLink {
  protected ws: WebSocket | null = null;
  protected pc: RTCPeerConnection | null = null;
  private pendingIce: RTCIceCandidateInit[] = [];

  constructor(
    readonly peerId: string,
    private channel: "chat" | "video",
  ) {}

  protected openSignaling(onClose: (reason: string | null) => void) {
    const ws = new WebSocket(wsUrl(`/api/team/signal?peer=${encodeURIComponent(this.peerId)}&channel=${this.channel}`));
    this.ws = ws;
    ws.addEventListener("message", (e) => void this.onSignal(JSON.parse(String(e.data)) as Signal));
    ws.addEventListener("close", (e) => onClose(CLOSE_REASONS[e.code] ?? null));
  }

  protected signal(msg: Signal) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  protected peerConnection(): RTCPeerConnection {
    if (this.pc) return this.pc;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pc.addEventListener("icecandidate", (e) => e.candidate && this.signal({ type: "ice", candidate: e.candidate.toJSON() }));
    pc.addEventListener("connectionstatechange", () => this.onConnectionState(pc.connectionState));
    this.pc = pc;
    this.setup(pc);
    return pc;
  }

  /** Add tracks or channels before negotiating. */
  protected abstract setup(pc: RTCPeerConnection): void;
  protected abstract onReady(initiator: boolean): void;
  protected abstract onPeerLeft(): void;
  protected abstract onConnectionState(state: RTCPeerConnectionState): void;

  private async onSignal(msg: Signal) {
    if (msg.type === "ready") {
      const pc = this.peerConnection();
      this.onReady(msg.initiator);
      if (msg.initiator) {
        await pc.setLocalDescription(await pc.createOffer());
        this.signal({ type: "offer", sdp: pc.localDescription!.toJSON() });
      }
    } else if (msg.type === "offer") {
      const pc = this.peerConnection();
      await pc.setRemoteDescription(msg.sdp);
      await this.flushIce();
      await pc.setLocalDescription(await pc.createAnswer());
      this.signal({ type: "answer", sdp: pc.localDescription!.toJSON() });
    } else if (msg.type === "answer") {
      await this.pc?.setRemoteDescription(msg.sdp);
      await this.flushIce();
    } else if (msg.type === "ice") {
      if (this.pc?.remoteDescription) await this.pc.addIceCandidate(msg.candidate).catch(() => {});
      else this.pendingIce.push(msg.candidate);
    } else if (msg.type === "peer-left") {
      this.onPeerLeft();
    }
  }

  private async flushIce() {
    for (const c of this.pendingIce.splice(0)) await this.pc?.addIceCandidate(c).catch(() => {});
  }

  protected teardown() {
    this.pc?.close();
    this.pc = null;
    this.ws?.close();
    this.ws = null;
  }
}

// ---- chat -------------------------------------------------------------------------------------------

export type ChatState = "idle" | "waiting" | "connecting" | "connected" | "disconnected" | "failed";

/** A text chat over a data channel. Messages exist only on the two devices (TEAM-10, TEAM-11). */
export class P2PChat extends PeerLink {
  state: ChatState = "idle";
  error = "";
  private channelRef: RTCDataChannel | null = null;

  constructor(
    peerId: string,
    private on: { state: (s: ChatState, error: string) => void; message: (text: string) => void },
  ) {
    super(peerId, "chat");
  }

  private set(state: ChatState, error = "") {
    this.state = state;
    this.error = error;
    this.on.state(state, error);
  }

  connect() {
    if (this.state === "waiting" || this.state === "connecting" || this.state === "connected") return;
    this.set("waiting");
    this.openSignaling((reason) => {
      if (reason) this.set("failed", reason);
      else if (this.state !== "connected") this.set("disconnected");
    });
  }

  protected setup(pc: RTCPeerConnection) {
    pc.addEventListener("datachannel", (e) => this.bind(e.channel));
  }
  protected onReady(initiator: boolean) {
    this.set("connecting");
    if (initiator) this.bind(this.peerConnection().createDataChannel("chat"));
  }
  protected onPeerLeft() {
    this.channelRef = null;
    this.pc?.close();
    this.pc = null;
    this.set("waiting");
  }
  protected onConnectionState(s: RTCPeerConnectionState) {
    if (s === "failed") this.set("failed", "The network between you blocks device-to-device traffic.");
  }

  private bind(ch: RTCDataChannel) {
    this.channelRef = ch;
    ch.addEventListener("open", () => this.set("connected"));
    ch.addEventListener("close", () => this.state === "connected" && this.set("waiting"));
    ch.addEventListener("message", (e) => {
      try {
        const { text } = JSON.parse(String(e.data)) as { text?: unknown };
        if (typeof text === "string" && text.length <= 4000) this.on.message(text);
      } catch {
        /* not a chat message */
      }
    });
  }

  /** Only while connected: otherwise nothing is sent, and the caller says so (TEAM-12). */
  send(text: string): boolean {
    if (this.state !== "connected" || this.channelRef?.readyState !== "open") return false;
    this.channelRef.send(JSON.stringify({ text }));
    return true;
  }

  disconnect() {
    this.channelRef?.close();
    this.teardown();
    this.set("idle");
  }
}

// ---- video ------------------------------------------------------------------------------------------

export type CallState = "idle" | "starting" | "waiting" | "connecting" | "connected" | "ended" | "failed";

/** A one-to-one call with camera, microphone and screen share (TEAM-20, TEAM-21, TEAM-23). */
export class P2PVideo extends PeerLink {
  state: CallState = "idle";
  error = "";
  local: MediaStream | null = null;
  remote: MediaStream | null = null;
  private screen: MediaStream | null = null;
  micOn = true;
  cameraOn = true;

  constructor(
    peerId: string,
    private on: { state: (s: CallState, error: string) => void; streams: () => void },
  ) {
    super(peerId, "video");
  }

  private set(state: CallState, error = "") {
    this.state = state;
    this.error = error;
    this.on.state(state, error);
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) return this.set("failed", "Calls need a secure (https) page.");
    this.set("starting");
    try {
      this.local = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    } catch (e) {
      const name = (e as { name?: string }).name;
      return this.set("failed", name === "NotAllowedError" ? "Camera or microphone permission was refused." : name === "NotFoundError" ? "No camera or microphone was found." : "The camera or microphone couldn't be started.");
    }
    this.on.streams();
    this.set("waiting");
    this.openSignaling((reason) => {
      if (reason) this.fail(reason);
      else if (this.state !== "ended" && this.state !== "failed") this.end();
    });
  }

  protected setup(pc: RTCPeerConnection) {
    for (const t of this.local?.getTracks() ?? []) pc.addTrack(t, this.local!);
    pc.addEventListener("track", (e) => {
      this.remote = e.streams[0] ?? new MediaStream([e.track]);
      this.on.streams();
    });
  }
  protected onReady() {
    this.set("connecting");
  }
  protected onPeerLeft() {
    this.end();
  }
  protected onConnectionState(s: RTCPeerConnectionState) {
    if (s === "connected") this.set("connected");
    else if (s === "failed") this.fail("The network between you blocks device-to-device calls.");
  }

  toggleMic() {
    this.micOn = !this.micOn;
    for (const t of this.local?.getAudioTracks() ?? []) t.enabled = this.micOn;
  }
  toggleCamera() {
    this.cameraOn = !this.cameraOn;
    for (const t of this.local?.getVideoTracks() ?? []) t.enabled = this.cameraOn;
  }

  /** Share the screen in place of the camera; stops when the browser's "Stop sharing" is pressed. */
  async shareScreen() {
    const sender = this.pc?.getSenders().find((s) => s.track?.kind === "video");
    if (!sender || !navigator.mediaDevices?.getDisplayMedia) return;
    if (this.screen) return this.stopScreen();
    try {
      this.screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
    } catch {
      return;
    }
    const track = this.screen.getVideoTracks()[0]!;
    track.addEventListener("ended", () => void this.stopScreen());
    await sender.replaceTrack(track);
    this.on.streams();
  }
  async stopScreen() {
    const sender = this.pc?.getSenders().find((s) => s.track?.kind === "video");
    for (const t of this.screen?.getTracks() ?? []) t.stop();
    this.screen = null;
    const cam = this.local?.getVideoTracks()[0];
    if (sender && cam) await sender.replaceTrack(cam);
    this.on.streams();
  }
  get sharing() {
    return Boolean(this.screen);
  }

  /** Hang up: the camera, microphone and screen are released at once (TEAM-23). */
  end() {
    this.release();
    this.set("ended");
  }
  private fail(reason: string) {
    this.release();
    this.set("failed", reason);
  }
  private release() {
    for (const s of [this.local, this.screen]) for (const t of s?.getTracks() ?? []) t.stop();
    this.local = null;
    this.screen = null;
    this.remote = null;
    this.teardown();
    this.on.streams();
  }
}
