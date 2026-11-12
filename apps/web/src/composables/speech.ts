// Speech in (Web Speech API recognition) and speech out (the browser's voices).
import { onBeforeUnmount, onMounted, ref } from "vue";

type RecognitionResultEvent = { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> };
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Speech-to-text: calls onFinal with the transcript when the visitor stops speaking. `lang` is read at each start. */
export function useSpeechInput(onFinal: (text: string) => void, lang: () => string = () => "en-US") {
  const supported = ref(false);
  const listening = ref(false);
  const interim = ref("");
  let rec: Recognition | null = null;

  onMounted(() => (supported.value = recognitionCtor() !== null));
  onBeforeUnmount(() => rec?.abort());

  function start() {
    const Ctor = recognitionCtor();
    if (!Ctor || rec) return;
    const r = new Ctor();
    r.lang = lang();
    r.interimResults = true;
    r.continuous = false;
    let transcript = "";
    r.onresult = (e) => {
      transcript = Array.from(e.results)
        .map((x) => x[0]?.transcript ?? "")
        .join("");
      interim.value = transcript;
    };
    r.onerror = () => (listening.value = false);
    r.onend = () => {
      rec = null;
      listening.value = false;
      interim.value = "";
      if (transcript.trim()) onFinal(transcript.trim());
    };
    rec = r;
    listening.value = true;
    r.start();
  }

  return { supported, listening, interim, start, stop: () => rec?.stop() };
}

/** Text-to-speech using the browser's built-in voices. */
export function useSpeechOutput() {
  const voices = ref<SpeechSynthesisVoice[]>([]);
  const speaking = ref(false);
  const paused = ref(false);
  const synth = () => (typeof window !== "undefined" ? window.speechSynthesis : undefined);
  const loadVoices = () => (voices.value = synth()?.getVoices() ?? []);

  onMounted(() => {
    loadVoices();
    synth()?.addEventListener("voiceschanged", loadVoices);
  });
  onBeforeUnmount(() => {
    synth()?.removeEventListener("voiceschanged", loadVoices);
    synth()?.cancel();
  });

  function speak(text: string, opts: { voiceName?: string | null; rate?: number; lang?: string } = {}) {
    return new Promise<void>((resolve) => {
      const s = synth();
      if (!s || !text.trim()) return resolve();
      s.cancel();
      // Drop "(sources: ...)" citations from spoken output, wherever they are.
      const u = new SpeechSynthesisUtterance(text.replace(/\(sources?:[^)]*\)/gi, "").trim());
      // The chosen voice only when it speaks the language; otherwise the browser picks one for it.
      const sameLang = (v: SpeechSynthesisVoice) => !opts.lang || v.lang.toLowerCase().startsWith(opts.lang.slice(0, 2).toLowerCase());
      const voice = voices.value.find((v) => v.name === opts.voiceName && sameLang(v)) ?? (opts.lang ? voices.value.find((v) => v.lang === opts.lang) : undefined);
      if (voice) u.voice = voice;
      if (opts.lang) u.lang = opts.lang;
      u.rate = opts.rate ?? 1;
      u.onstart = () => (speaking.value = true);
      u.onend = u.onerror = () => {
        speaking.value = false;
        paused.value = false;
        resolve();
      };
      s.speak(u);
    });
  }

  return {
    voices,
    speaking,
    paused,
    speak,
    pause: () => {
      synth()?.pause();
      paused.value = true;
    },
    resume: () => {
      synth()?.resume();
      paused.value = false;
    },
    cancel: () => {
      synth()?.cancel();
      speaking.value = false;
      paused.value = false;
    },
  };
}

export type SpeechOutput = ReturnType<typeof useSpeechOutput>;
