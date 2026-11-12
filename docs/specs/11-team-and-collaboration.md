# 11 Team and collaboration

The people who run the kiosk (the administrator, moderators and curators) work as a team: they manage who is in it, message each other, and call each other by video, as clinux-desk's staff do (`TeamChat.vue`, `p2pChat.js`, `p2pVideo.js`, the clinic box's signaling relay).

## Team management

| ID | Requirement | Status |
|---|---|---|
| TEAM-1 | The team must be a list of members, each with a display name, a role, a status (invited, active, suspended) and when they last signed in. Roles: *administrator* (manages the team and keys), *moderator* (handles the queue, reviews answers, MOD), *curator* (edits the curated knowledge base, KNW-1). A member may hold several roles. | Planned |
| TEAM-2 | The administrator must be able to invite a member (which issues their moderator key, MOD-20), change their roles, suspend or reinstate them, and remove them. Removing or suspending a member revokes their key and ends their sessions. | Planned |
| TEAM-3 | Every member must have a profile page (MOD-24) showing their name, roles, languages, the knowledge sources they look after, and their own activity. Members can see each other's names, roles and availability, not each other's activity logs. | Planned |
| TEAM-4 | A member must be able to set their availability (available, busy, away), shown in the team list and used for calls (TEAM-30). | Planned |
| TEAM-5 | Team changes must be recorded in the audit log (MOD-25): who invited, changed, suspended or removed whom, and when. | Planned |
| TEAM-6 | There must always be at least one active administrator: the last one can't be removed, suspended or lose the role. | Planned |

## Chat

| ID | Requirement | Status |
|---|---|---|
| TEAM-10 | Two members must be able to message each other directly. Messages go device to device (a WebRTC data channel); the server only introduces the two devices (signaling) and never sees or stores a message. | Planned |
| TEAM-11 | Each device must keep its own history of its conversations, in the browser, as clinux does. There is no server copy. | Planned |
| TEAM-12 | A message can only be sent while the other person is connected; when they aren't, the kiosk must say so plainly ("Ravi isn't online. Your message wasn't sent.") rather than appear to send it. | Planned |
| TEAM-13 | A member must be able to share a moderation item, a reviewed answer (MOD-10) or a notebook score (MOD-33) in a chat as a link that opens it for the other person, if they are allowed to see it. Sharing never copies visitor content into the chat beyond what the item already shows. | Planned |
| TEAM-14 | A team channel (all active members) should be available for announcements. Because chat is device to device, a channel message reaches the members online at the time. | Proposed |

## Video calls

| ID | Requirement | Status |
|---|---|---|
| TEAM-20 | Two members must be able to start a video call with camera, microphone and screen share, device to device (WebRTC), using the same signaling as chat on its own channel, so a call doesn't interrupt an open chat. | Planned |
| TEAM-21 | A call must show its state: starting (asking for the camera and microphone), waiting for the other person, connecting, connected, ended, failed, with a clear reason when it fails (for example "already in a call on another device", or a network that blocks device-to-device traffic). | Planned |
| TEAM-22 | Calls of three or more members (a team meeting) must use a hosted service (Cloudflare RealtimeKit, as clinux), started from the team list or a chat. | Planned |
| TEAM-23 | The camera and microphone must be used only during a call, with the browser's permission, and released when it ends. | Planned |

## Working without the internet

| ID | Requirement | Status |
|---|---|---|
| TEAM-30 | When the kiosk is served alongside a yaxb-box on the local network, the box must relay signaling between members on that network, so chat and one-to-one calls keep working while the internet is down. The box only forwards; it never reads or stores what it relays. | Planned |
| TEAM-31 | Offline, the box must admit a pair only when both members belong to the same deployment (their session claims match); members elsewhere reach each other through the cloud relay. | Planned |
| TEAM-32 | Team meetings (TEAM-22) need the internet; the kiosk must say so when it is offline. | Planned |

## A visitor talking to a person

| ID | Requirement | Status |
|---|---|---|
| TEAM-40 | A visitor should be able to ask to talk to a person ("I want to talk to someone", or the *Talk to a person* button), which calls the available moderators by video or voice; the first to answer takes it. Escalated items may offer this too. | Proposed |
| TEAM-41 | Such a call must say who the visitor is talking to (name and role), must not be recorded, and must never share the visitor's notebook or profile unless the visitor chooses to. | Proposed |
| TEAM-42 | When no one is available, the kiosk must say so and offer to pass the question to the moderators instead (MOD-1). | Proposed |

## Security

| ID | Requirement | Status |
|---|---|---|
| TEAM-50 | Signaling must admit only signed-in, active members, and only pair two members (or a visitor and an answering member, TEAM-40); the relay forwards opaque offers, answers and ICE candidates and parses nothing else. | Planned |
| TEAM-51 | Media and messages must be encrypted end to end by WebRTC (DTLS-SRTP, SCTP over DTLS); the only server in the path for one-to-one calls is the STUN server used to find a route. | Planned |
