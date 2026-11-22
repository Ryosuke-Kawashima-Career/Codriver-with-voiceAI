import type { LanguageCode, SpeechChannel } from '../types';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionErrorEventLike {
  error: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isSpeechRecognitionSupported(): boolean {
  return typeof window !== 'undefined' && getSpeechRecognitionCtor() !== null;
}

export class VoiceClient {
  private audioCache = new Map<string, string>(); // key -> blob object URL
  private activeAudio: HTMLAudioElement | null = null;
  private activeSpeakRejectOrDone: (() => void) | null = null;
  private speakToken = 0;

  private recognition: SpeechRecognitionLike | null = null;
  private listenTimeoutId: number | null = null;
  private listenToken = 0;

  private getCacheKey(text: string, language: LanguageCode, channel: SpeechChannel): string {
    return `${language}|${channel}|${text}`;
  }

  /**
   * Pre-renders and caches audio for maneuver instructions or common phrases via /api/tts.
   * Silently skips if backend signals browser_tts fallback.
   */
  async prefetch(text: string, language: LanguageCode, channel: SpeechChannel): Promise<void> {
    const key = this.getCacheKey(text, language, channel);
    if (this.audioCache.has(key)) return;
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, language, channel }),
      });
      if (!res.ok) return;
      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.includes('audio/')) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        this.audioCache.set(key, url);
      }
    } catch {
      // Non-fatal; runtime speak() will fall back to browser speech
    }
  }

  cancelSpeech(): void {
    this.speakToken += 1;
    if (this.activeAudio) {
      this.activeAudio.pause();
      this.activeAudio.src = '';
      this.activeAudio = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore browser quirks
      }
    }
    if (this.activeSpeakRejectOrDone) {
      const done = this.activeSpeakRejectOrDone;
      this.activeSpeakRejectOrDone = null;
      done();
    }
  }

  /**
   * Speaks a sentence via Murf Falcon 2 (/api/tts) with client cache,
   * automatically falling back to Web Speech Synthesis when Murf key is unset.
   * Resolves true if finished naturally, false if interrupted/cancelled.
   */
  async speak(text: string, language: LanguageCode, channel: SpeechChannel): Promise<boolean> {
    // Always stop microphone before speaking (Section 5.5)
    this.stopListening();
    this.cancelSpeech();

    const token = ++this.speakToken;
    const key = this.getCacheKey(text, language, channel);

    let audioUrl = this.audioCache.get(key);

    if (!audioUrl) {
      try {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, language, channel }),
        });
        if (token !== this.speakToken) return false;
        const contentType = res.headers.get('content-type') ?? '';
        if (res.ok && contentType.includes('audio/')) {
          const blob = await res.blob();
          if (token !== this.speakToken) return false;
          audioUrl = URL.createObjectURL(blob);
          this.audioCache.set(key, audioUrl);
        }
      } catch {
        // Fall through to browser speech synthesis
      }
    }

    if (token !== this.speakToken) return false;

    if (audioUrl) {
      return this.playAudioUrl(audioUrl, token);
    }

    return this.playBrowserSpeech(text, language, channel, token);
  }

  private playAudioUrl(url: string, token: number): Promise<boolean> {
    return new Promise((resolve) => {
      const audio = new Audio(url);
      this.activeAudio = audio;
      let settled = false;

      const finish = (completed: boolean) => {
        if (settled) return;
        settled = true;
        if (this.activeAudio === audio) this.activeAudio = null;
        this.activeSpeakRejectOrDone = null;
        resolve(completed && token === this.speakToken);
      };

      this.activeSpeakRejectOrDone = () => finish(false);
      audio.onended = () => finish(true);
      audio.onerror = () => finish(true);

      audio.play().catch(() => {
        finish(true);
      });
    });
  }

  private playBrowserSpeech(
    text: string,
    language: LanguageCode,
    channel: SpeechChannel,
    token: number
  ): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const estimatedMs = Math.max(1500, Math.min(9000, text.length * 68));
      let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

      const finish = (completed: boolean) => {
        if (settled) return;
        settled = true;
        if (fallbackTimer !== null) {
          clearTimeout(fallbackTimer);
          fallbackTimer = null;
        }
        this.activeSpeakRejectOrDone = null;
        resolve(completed && token === this.speakToken);
      };

      this.activeSpeakRejectOrDone = () => finish(false);

      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        fallbackTimer = setTimeout(() => finish(true), estimatedMs);
        return;
      }

      try {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = language;
        utterance.rate = channel === 'directions' ? 1.05 : 0.98;
        utterance.pitch = channel === 'directions' ? 0.98 : 1.02;

        const voices = window.speechSynthesis.getVoices();
        const langPrefix = language.split('-')[0].toLowerCase();
        const exactVoice = voices.find((v) => v.lang.toLowerCase() === language.toLowerCase());
        const prefixVoice = voices.find((v) => v.lang.toLowerCase().startsWith(langPrefix));
        if (exactVoice) utterance.voice = exactVoice;
        else if (prefixVoice) utterance.voice = prefixVoice;

        utterance.onend = () => finish(true);
        utterance.onerror = () => finish(true);

        // Safety timer in case speechSynthesis stalls in restricted iframes/headless browsers
        fallbackTimer = setTimeout(() => finish(true), estimatedMs + 2500);
        window.speechSynthesis.speak(utterance);
      } catch {
        fallbackTimer = setTimeout(() => finish(true), estimatedMs);
      }
    });
  }

  stopListening(): void {
    this.listenToken += 1;
    if (this.listenTimeoutId !== null) {
      window.clearTimeout(this.listenTimeoutId);
      this.listenTimeoutId = null;
    }
    if (this.recognition) {
      const rec = this.recognition;
      this.recognition = null;
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.abort();
      } catch {
        // Ignore
      }
    }
  }

  /**
   * Opens the browser microphone (Web Speech API) for up to `silenceMs` (8s default).
   * Calls onInterim with live partial transcripts and onFinal when speech completes or times out.
   */
  startListening(options: {
    language: LanguageCode;
    silenceMs?: number;
    onInterim?: (text: string) => void;
    onFinal: (transcript: string | null) => void;
  }): () => void {
    this.stopListening();
    const token = ++this.listenToken;
    const silenceMs = options.silenceMs ?? 8000;
    let settled = false;
    let latestTranscript = '';

    const complete = (result: string | null) => {
      if (settled || token !== this.listenToken) return;
      settled = true;
      this.stopListening();
      options.onFinal(result);
    };

    // 8-second silence timeout (no countdown shown in UI)
    this.listenTimeoutId = window.setTimeout(() => {
      complete(latestTranscript.trim() || null);
    }, silenceMs);

    const Ctor = getSpeechRecognitionCtor();
    if (Ctor) {
      try {
        const rec = new Ctor();
        this.recognition = rec;
        rec.lang = options.language;
        rec.continuous = false;
        rec.interimResults = true;
        rec.maxAlternatives = 1;

        rec.onresult = (event) => {
          if (settled || token !== this.listenToken) return;
          let combined = '';
          let isFinal = false;
          for (let i = 0; i < event.results.length; i++) {
            const res = event.results[i];
            if (res[0]?.transcript) {
              combined += res[0].transcript;
            }
            if (res.isFinal) isFinal = true;
          }
          latestTranscript = combined.trim();
          if (latestTranscript) {
            options.onInterim?.(latestTranscript);
          }
          if (isFinal && latestTranscript) {
            complete(latestTranscript);
          }
        };

        rec.onerror = (ev) => {
          if (settled || token !== this.listenToken) return;
          // Keep timer alive for typed-answer fallback if mic errored or no-speech happened early
          if (ev.error === 'aborted') {
            complete(null);
          }
        };

        rec.onend = () => {
          if (settled || token !== this.listenToken) return;
          if (latestTranscript.trim()) {
            complete(latestTranscript.trim());
          }
          // If nothing heard yet, let the 8s silence window continue so user can still type or speak
        };

        rec.start();
      } catch {
        // Fallback: keep 8s silence window open for Demo Panel typed answer
      }
    }

    return () => {
      if (!settled && token === this.listenToken) {
        settled = true;
        this.stopListening();
      }
    };
  }

  dispose(): void {
    this.stopListening();
    this.cancelSpeech();
    for (const url of this.audioCache.values()) {
      URL.revokeObjectURL(url);
    }
    this.audioCache.clear();
  }
}
