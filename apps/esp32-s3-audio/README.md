# esp32-s3-audio (planned surface)

This surface is for an ESP32-S3 audio board that talks to the kiosk agent by voice. It is not built yet. This file records the design so the core and the web Worker stay ready for it.

## Shape

```
ESP32-S3 board ──HTTPS──▶ yaxb-web Worker: /api/device/v1/*  ──▶ yaxb-core createKiosk().ask()
  mic, speaker,             device auth, STT/TTS (Workers AI),       same agent, tools, stores
  button / wake word        thread namespace device-<id>
```

- **The board stays thin.** It handles capture, playback, a push-to-talk button or wake word, Wi-Fi provisioning and TLS. It holds no LLM keys and no agent logic.
- **The Worker gateway handles speech and calls the core.** It takes audio from the board, transcribes it with Workers AI speech-to-text, calls `kiosk().ask()` with `threadId: "device-<id>:<uuid>"`, and sends speech back from text-to-speech. Text-only first is a useful milestone: the device posts text and reads `AgentEvent`s.
- **Same protocol.** Responses are the `AgentEvent` stream from `@sekaran-ind/yaxb-core/events`, as SSE. `yaxb ask --json` prints the same events and is a quick way to prototype device behaviour.

## Security to build in

- Each device gets its own credential, issued at provisioning and revocable. The Worker stores only a hash. Never share a key across a fleet.
- Device requests have no browser session, so they don't use the cookie and Origin checks. They use the device credential and a per-device rate limit (another Rate Limiting binding).
- The device id becomes the thread namespace, so a device can only continue its own conversations.
- Audio is processed in memory and never stored. Logs carry no transcript.
- Firmware updates are signed and the TLS certificate is pinned or the CA is validated, since a kiosk device sits in a public space.

## What the core already provides

- `createKiosk`, the event protocol, `chatRequestSchema` (text in) and the thread id pattern.
- The rate limiter contract (`/stores`), backed by a Workers Rate Limiting binding on the web.

Still needed later: a device registry (a D1 table and a core `/devices` module) and the `/api/device/v1` routes.
