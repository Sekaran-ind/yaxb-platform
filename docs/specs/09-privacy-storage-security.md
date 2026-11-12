# 09 Privacy, storage and security

## What is kept where

| Data | Where | Leaves the device? |
|---|---|---|
| Settings | Browser (localStorage) | Sent with each question; no secrets |
| Notebooks (sources, memory) | Browser (IndexedDB), session memory, or a local box | Sent with a question to the agent, as that turn's context; never stored on the server |
| Conversations | As Settings → Storage says: browser, session, local box, or the server (D1, 30 days) | Only to the chosen store |
| Visitor profile and activity log | Browser (IndexedDB), encrypted | Never, except an export the visitor makes |
| Escalated questions | Server (D1) moderation queue | Yes: that is their purpose |
| Session feedback | Server (D1) | Yes, without identifying the visitor |
| Moderator profiles and reviews (planned) | Server | Yes |

## Requirements

| ID | Requirement | Status |
|---|---|---|
| PRV-1 | AI provider keys, search keys, the session secret and moderator secrets must stay in the server's secrets; none ever reaches a browser. | Built |
| PRV-2 | The server must never log message content, notebook text or answers; failure logs carry only the kind of failure, provider, model and a short thread suffix. | Built |
| PRV-3 | On-device mode, on-device search, slot filling's on-device passes, summaries and translation must work without sending the visitor's text anywhere. | Built |
| PRV-4 | Features that send text off the device must say so where they are switched on: the AI agent (to the chosen provider), web search (to the search service), speech recognition (to the browser's maker). | Built (agent, web); Planned (speech, LNG-7) |
| PRV-5 | A client-held conversation must be validated (no system messages, size limit) before the agent uses it. | Built |
| PRV-6 | Everything a client sends that names knowledge (references, journey forms) must be resolved by the server from its own data. | Built |

## Security

| ID | Requirement | Status |
|---|---|---|
| SEC-1 | Every page must carry a strict Content-Security-Policy (no inline scripts), with model hosts and the local box's address as the only extra origins. | Built |
| SEC-2 | State-changing requests must come from the kiosk's own origin, belong to a session (an HMAC-signed cookie), and be rate-limited; bodies have size limits and are validated. | Built |
| SEC-3 | The agent has no shell, no file deletion and no arbitrary network access (ANS-43); MCP servers and web search are only those the organisation configured. | Built |
| SEC-4 | Server-side fetching of websites (KNW-21) must refuse private and local addresses, re-check redirects, and cap size and time. | Planned |
| SEC-5 | Moderator keys (MOD-20) must be random, at least 128 bits, shown once, stored hashed, revocable and optionally expiring; administrator access uses a separate secret. | Planned |
| SEC-6 | A local box must use TLS and a bearer token, and accept browser requests only from the kiosk's configured origins. | Built |
