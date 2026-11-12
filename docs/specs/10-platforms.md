# 10 Platforms

## Web kiosk

| ID | Requirement | Status |
|---|---|---|
| PLT-1 | The kiosk must run in current Chrome, Edge, Safari and Firefox, as one Cloudflare Workers deployment serving the app and its API. | Built |
| PLT-2 | On-device models must run in Web Workers so the screen stays responsive, and be cached by the browser after their first download. | Built |
| PLT-3 | The server bundle must stay small (under about 1.5 MB compressed); on-device model data must not be bundled into it. | Built |

## Native app

| ID | Requirement | Status |
|---|---|---|
| PLT-10 | The kiosk must be packaged as a native Android and iOS app with Capacitor, from the same Vue app, following clinux-diary's setup. | Planned |
| PLT-11 | The app must talk to the organisation's kiosk server for the agent and moderation (its address set at build time), and keep notebooks, profiles and on-device models on the device as the web kiosk does. | Planned |
| PLT-12 | The app must use the device's microphone and speech where the web APIs aren't available in the app's web view, asking for permission with a clear reason. | Planned |
| PLT-13 | The app should support a kiosk (single-app) mode on Android tablets. | Proposed |
| PLT-14 | The server must accept the app's requests (its origin) with the same session, rate-limit and validation rules as the web kiosk. | Planned |

## Command line

| ID | Requirement | Status |
|---|---|---|
| PLT-20 | `yaxb ask` and `yaxb chat` must run the same agent from a terminal, with provider keys from the environment, conversations saved locally or on a local box. | Built |

## Local box

| ID | Requirement | Status |
|---|---|---|
| PLT-30 | yaxb-box must store notebooks, conversations and memory on a Raspberry Pi on the local network (SQLite, replicated by Litestream), installable with one command. | Built |

## Voice device

| ID | Requirement | Status |
|---|---|---|
| PLT-40 | An ESP32-S3 voice device is planned; see `apps/esp32-s3-audio` for the design notes. | Planned (design only) |
