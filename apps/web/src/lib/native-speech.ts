// Speech on the device for the native app (PLT-12): Android's web view has no Web Speech API, so
// the app uses the platform's speech recognition and text-to-speech through Capacitor plugins.
// Loaded only in the native app (lib/platform.ts onDevice), never on the web.
import { SpeechRecognition } from "@capacitor-community/speech-recognition";
import { TextToSpeech } from "@capacitor-community/text-to-speech";

export type NativeVoice = { name: string; lang: string; index: number };

export async function recognitionAvailable(): Promise<boolean> {
  try {
    return (await SpeechRecognition.available()).available;
  } catch {
    return false;
  }
}

/**
 * Listen once: asks for the microphone (the reason is in Info.plist; Android asks with its own prompt),
 * reports partial text, and resolves with the final text ("" when nothing was heard).
 */
export async function listenOnce(lang: string, onPartial: (text: string) => void): Promise<string> {
  const perm = await SpeechRecognition.requestPermissions();
  if (perm.speechRecognition !== "granted") throw new Error("Microphone permission was not given.");
  let latest = "";
  const partial = await SpeechRecognition.addListener("partialResults", (e: { matches?: string[] }) => {
    latest = e.matches?.[0] ?? latest;
    onPartial(latest);
  });
  return new Promise<string>((resolve) => {
    let done = false;
    const finish = async () => {
      if (done) return;
      done = true;
      await partial.remove();
      await state.remove();
      resolve(latest.trim());
    };
    const state = { remove: async () => {} };
    void SpeechRecognition.addListener("listeningState", (e: { status: "started" | "stopped" }) => {
      if (e.status === "stopped") void finish();
    }).then((h) => (state.remove = () => h.remove()));
    SpeechRecognition.start({ language: lang, partialResults: true, popup: false, maxResults: 1 })
      .then((r) => {
        // Some devices return the matches here instead of through events.
        const m = (r as { matches?: string[] } | undefined)?.matches?.[0];
        if (m) latest = m;
      })
      .catch(() => void finish());
  });
}

export const stopListening = () => SpeechRecognition.stop().catch(() => {});

export async function nativeVoices(): Promise<NativeVoice[]> {
  try {
    const { voices } = await TextToSpeech.getSupportedVoices();
    return voices.map((v, index) => ({ name: v.name, lang: v.lang, index }));
  } catch {
    return [];
  }
}

export async function speakNative(text: string, opts: { lang?: string; rate?: number; voice?: number }) {
  await TextToSpeech.speak({ text, lang: opts.lang ?? "en-US", rate: opts.rate ?? 1, ...(opts.voice !== undefined ? { voice: opts.voice } : {}) });
}

export const stopSpeaking = () => TextToSpeech.stop().catch(() => {});
