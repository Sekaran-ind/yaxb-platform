// The team, for one signed-in member: who is on the team and online, device-to-device chats with
// each, and calls (TEAM-3, TEAM-4, TEAM-10..12, TEAM-20, TEAM-21). One instance for the app, so a
// chat or call survives moving between moderator pages.
//
// Opening a chat joins the pair's room and invites the other member, whose device joins
// automatically (a chat is just a data channel); a call rings until it's answered, declined or
// cancelled. Messages are kept only on each device (lib/browser/team-chat.ts).
import type { TeamMember } from "@sekaran-ind/yaxb-core/team";
import { computed, reactive, ref, shallowRef } from "vue";
import { api, ApiError } from "@/lib/api";
import { P2PChat, P2PVideo, TeamPresence, type CallState, type ChatState, type Invitation, type Online } from "@/lib/browser/p2p";
import { append, history, type ChatMessage } from "@/lib/browser/team-chat";

type Thread = { state: ChatState; error: string; messages: ChatMessage[]; unread: number };

const me = ref<TeamMember | null>(null);
const members = ref<TeamMember[]>([]);
const online = ref<Online[]>([]);
const connected = ref(false);
const signedOut = ref(false);
const error = ref<string | null>(null);
const threads = reactive(new Map<string, Thread>());
/** The live chat sessions (not reactive: they hold a WebSocket and a peer connection). */
const sessions = new Map<string, P2PChat>();
const open = ref<string | null>(null);

/** The call in progress, or ringing in. */
const call = shallowRef<P2PVideo | null>(null);
const callState = ref<CallState>("idle");
const callError = ref("");
const callPeer = ref<string | null>(null);
const incoming = ref<string | null>(null);
const streamsTick = ref(0);

let presence: TeamPresence | null = null;

function thread(peer: string): Thread {
  let t = threads.get(peer);
  if (!t) {
    t = { state: "idle", error: "", messages: [], unread: 0 };
    threads.set(peer, t);
  }
  return threads.get(peer)!;
}

async function load() {
  error.value = null;
  try {
    const r = await api<{ me: TeamMember; members: TeamMember[] }>("/api/team");
    me.value = r.me;
    members.value = r.members.filter((m) => m.id !== r.me.id);
    signedOut.value = false;
    if (!presence) {
      presence = new TeamPresence({ presence: (o) => (online.value = o), invitation: onInvitation, connected: (yes) => (connected.value = yes) });
      presence.connect();
    }
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) signedOut.value = true;
    else error.value = (e as Error).message;
  }
}

/** Join the chat room with a member (both sides do; the relay pairs them). */
async function joinChat(peer: string) {
  const t = thread(peer);
  if (!me.value) return;
  if (!t.messages.length) t.messages = await history(me.value.id, peer);
  if (sessions.has(peer) && t.state !== "failed" && t.state !== "disconnected" && t.state !== "idle") return;
  const session = new P2PChat(peer, {
    state: (s, err) => {
      t.state = s;
      t.error = err;
    },
    message: async (text) => {
      t.messages.push(await append(me.value!.id, peer, "received", text));
      if (open.value !== peer) t.unread++;
    },
  });
  sessions.set(peer, session);
  session.connect();
}

async function openChat(peer: string) {
  open.value = peer;
  thread(peer).unread = 0;
  await joinChat(peer);
  presence?.invite(peer, "chat");
}

/** Send only when the other device is connected; otherwise say so (TEAM-12). */
async function send(peer: string, text: string): Promise<boolean> {
  const t = thread(peer);
  if (!me.value || !sessions.get(peer)?.send(text)) return false;
  t.messages.push(await append(me.value.id, peer, "sent", text));
  return true;
}

function onInvitation(i: Invitation) {
  if (i.type === "invite" && i.from && i.channel === "chat") void joinChat(i.from);
  else if (i.type === "invite" && i.from && i.channel === "video") {
    if (call.value && callState.value !== "ended" && callState.value !== "failed") presence?.decline(i.from, "video");
    else incoming.value = i.from;
  } else if (i.type === "cancel" && i.channel === "video" && incoming.value === i.from) incoming.value = null;
  else if (i.type === "decline" && i.channel === "video" && callPeer.value === i.from) {
    call.value?.end();
    callError.value = "They can't take the call now.";
  } else if (i.type === "unavailable" && i.channel === "video" && callPeer.value === i.to) {
    call.value?.end();
    callError.value = "They aren't online.";
  }
}

function startCall(peer: string, ring: boolean) {
  call.value?.end();
  callPeer.value = peer;
  callError.value = "";
  const v = new P2PVideo(peer, {
    state: (s, err) => {
      callState.value = s;
      if (err) callError.value = err;
    },
    streams: () => streamsTick.value++,
  });
  call.value = v;
  void v.start().then(() => ring && v.state === "waiting" && presence?.invite(peer, "video"));
}

const placeCall = (peer: string) => startCall(peer, true);
function answer() {
  if (!incoming.value) return;
  startCall(incoming.value, false);
  incoming.value = null;
}
function decline() {
  if (incoming.value) presence?.decline(incoming.value, "video");
  incoming.value = null;
}
function hangUp() {
  const peer = callPeer.value;
  if (peer && callState.value === "waiting") presence?.cancel(peer, "video");
  call.value?.end();
}
function closeCall() {
  call.value = null;
  callPeer.value = null;
  callState.value = "idle";
  callError.value = "";
}

async function setAvailability(value: Online["availability"]) {
  await api("/api/team/availability", { value }, "PUT");
  presence?.availability(value);
  if (me.value) me.value = { ...me.value, availability: value };
}

const onlineIds = computed(() => new Set(online.value.map((o) => o.id)));
const availabilityOf = (id: string) => online.value.find((o) => o.id === id)?.availability ?? null;
const nameOf = (id: string | null) => members.value.find((m) => m.id === id)?.name ?? "A team member";

export function useTeam() {
  return {
    me,
    members,
    online,
    onlineIds,
    connected,
    signedOut,
    error,
    threads,
    open,
    thread,
    load,
    openChat,
    send,
    call,
    callState,
    callError,
    callPeer,
    incoming,
    streamsTick,
    placeCall,
    answer,
    decline,
    hangUp,
    closeCall,
    setAvailability,
    availabilityOf,
    nameOf,
  };
}
