# YAXB Kiosk: native app

The kiosk as an Android and iOS app (Capacitor 8, following clinux-diary). The app is the kiosk alone: it opens straight into it, with Settings one tap away, and no website pages, moderator or administration screens.

It is the same Vue app as `apps/web`, built in native mode (`vite build --mode native` → `apps/web/dist/native`), which:

- routes only `/kiosk` and `/settings` (hash URLs, so no server is needed for pages);
- sends every `/api` call to the kiosk server at `VITE_API_BASE`, with the device's session id in `X-Yaxb-Session` (app web views block third-party cookies);
- uses the device's speech recognition and text-to-speech (`@capacitor-community/speech-recognition`, `@capacitor-community/text-to-speech`), since Android's web view has no Web Speech API;
- keeps notebooks, profiles and on-device models on the device, as the web kiosk does.

## Build

1. Set the kiosk server in `apps/web/.env.native.local` (git-ignored):

   ```
   VITE_API_BASE=https://kiosk.example.org
   ```

2. The server must allow the app's origins. `KIOSK_APP_ORIGINS` defaults to `capacitor://localhost,https://localhost` (iOS and Android); set it as a Worker var only to change that.

3. Build the web bundle and copy it into both platforms:

   ```bash
   npm run build -w @sekaran-ind/yaxb-native     # build:native, then cap sync
   ```

4. Open and run:

   ```bash
   npm run android -w @sekaran-ind/yaxb-native   # Android Studio (needs a JDK 21 and the Android SDK)
   npm run ios -w @sekaran-ind/yaxb-native       # Xcode, on a Mac
   ```

The microphone permission texts are in `android/app/src/main/AndroidManifest.xml` and `ios/App/App/Info.plist`.

## Testing without a device

Build with `VITE_API_BASE=http://localhost:3000`, serve the bundle with `npx vite preview --mode native --port 4173` in `apps/web`, and add `http://localhost:4173` to `KIOSK_APP_ORIGINS` in `apps/web/.dev.vars`. In a browser the app uses the browser's speech instead of the device's.
