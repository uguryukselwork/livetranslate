// Live voice translation ("sesli çeviri"), phone-call style.
// My microphone streams to Gemini Live Translate, which returns my speech translated into the partner's
// language as audio (relayed to the partner) plus both transcripts (saved as a chat message per sentence).
import type { Session } from '@google/genai';
import { getAudioContext } from './utils';

const INPUT_RATE = 16000;
const OUTPUT_RATE = 24000;
/** Echo is judged once a sentence has this many words (or when it ends): one common word is not enough */
const ECHO_MIN_WORDS = 3;
/** Silence after the last transcript before the sentence is saved as a message */
const SEGMENT_IDLE_MS = 1300;
/** Translated audio is relayed in ~200 ms batches to keep the realtime message rate low */
const RELAY_INTERVAL_MS = 200;

const toBase64 = (bytes: Uint8Array) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

/** Plays 24 kHz PCM16 chunks back to back */
export class PcmPlayer {
  private nextTime = 0;
  private endsAt = 0;

  play(b64: string, volume = 1) {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state !== 'running') void ctx.resume().catch(() => {});
    const bytes = fromBase64(b64);
    const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1);
    if (!pcm.length) return;
    const buffer = ctx.createBuffer(1, pcm.length, OUTPUT_RATE);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) data[i] = pcm[i] / 32768;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    src.connect(gain).connect(ctx.destination);
    // A small lead keeps network jitter from causing gaps
    const start = Math.max(this.nextTime, ctx.currentTime + 0.08);
    src.start(start);
    this.nextTime = start + buffer.duration;
    this.endsAt = performance.now() + (this.nextTime - ctx.currentTime) * 1000;
  }

  /** True while partner audio is (about to be) heard, plus a short tail for room echo */
  get isPlaying() {
    // Phone speakers and the room keep sounding a while after the buffer ends
    return performance.now() < this.endsAt + 1000;
  }

  reset() {
    this.nextTime = 0;
    this.endsAt = 0;
  }
}

const WORKLET = `
class LtCapture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('lt-capture', LtCapture);`;
const workletLoaded = new WeakSet<AudioContext>();

// After a deploy, a tab still running the old build asks for a chunk that no longer exists.
// Reload once so it picks up the new build instead of failing the call.
const RELOAD_KEY = 'lt-chunk-reload';
async function loadGenAI() {
  try {
    const mod = await import('@google/genai');
    sessionStorage.removeItem(RELOAD_KEY);
    return mod;
  } catch (err) {
    if (!sessionStorage.getItem(RELOAD_KEY)) {
      sessionStorage.setItem(RELOAD_KEY, '1');
      location.reload();
      await new Promise(() => {});
    }
    throw new Error('Uygulama güncellendi, lütfen sayfayı yenileyin');
  }
}

/** Downsamples mic audio to 16 kHz PCM16 and hands out ~100 ms chunks */
class Downsampler {
  private pos = 0;
  private out: number[] = [];
  constructor(private ratio: number, private onChunk: (pcm: Int16Array) => void) {}

  push(input: Float32Array) {
    while (this.pos < input.length) {
      const start = Math.floor(this.pos);
      const end = Math.min(input.length, Math.floor(this.pos + this.ratio));
      let sum = 0;
      for (let i = start; i < end; i++) sum += input[i];
      const s = end > start ? sum / (end - start) : input[start];
      this.out.push(Math.max(-1, Math.min(1, s)) * 0x7fff);
      this.pos += this.ratio;
    }
    this.pos -= input.length;
    if (this.out.length >= INPUT_RATE / 10) {
      this.onChunk(Int16Array.from(this.out));
      this.out = [];
    }
  }
}

export type VoiceState = 'connecting' | 'live' | 'error';

const words = (text: string) =>
  text.toLocaleLowerCase().replace(/[\p{P}\p{S}]/gu, ' ').split(/\s+/).filter(Boolean);

/**
 * True when what my mic picked up is mostly the partner's translation that my speaker just played.
 * Without this the two phones translate each other's speaker output back and forth forever.
 */
export function isEcho(said: string, recentlyHeard: string) {
  const saidWords = words(said);
  const heardWords = words(recentlyHeard);
  if (!saidWords.length || !heardWords.length) return false;
  if (saidWords.length === 1) return heardWords.includes(saidWords[0]);
  // Word pairs in order, not single words: an English reply shares many words ("I", "you", "are", "the")
  // with what was just heard, but an echo repeats them in the same order
  const pairs = (w: string[]) => w.slice(1).map((x, i) => `${w[i]} ${x}`);
  const heard = new Set(pairs(heardWords));
  const saidPairs = pairs(saidWords);
  const matched = saidPairs.filter(p => heard.has(p)).length;
  return matched / saidPairs.length >= 0.6;
}

/** "nasılsın nasılsın nasılsın" -> "nasılsın": drops a word run (1-6 words) repeated right after itself */
export function collapseRepeats(text: string) {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const key = (t: string) => words(t).join(' ');
  // One word said twice is normal speech ("yavaş yavaş", "evet evet"); three or more times is a glitch
  for (let i = 0; i + 2 < tokens.length;) {
    const k = key(tokens[i]);
    let run = 1;
    while (i + run < tokens.length && k && key(tokens[i + run]) === k) run++;
    if (run >= 3) tokens.splice(i + 1, run - 1);
    i++;
  }
  for (let size = 2; size <= 6; size++) {
    for (let i = 0; i + size * 2 <= tokens.length;) {
      const a = tokens.slice(i, i + size).map(key).join(' ');
      const b = tokens.slice(i + size, i + size * 2).map(key).join(' ');
      if (a && a === b) tokens.splice(i + size, size);
      else i++;
    }
  }
  return tokens.join(' ');
}

/** Drops a sentence that repeats (or is part of) the one just sent. Phones re-deliver finished sentences. */
class SentenceGate {
  private last = '';
  private at = 0;
  constructor(private windowMs = 6000) {}

  pass(text: string) {
    const key = words(text).join(' ');
    if (!key) return false;
    const now = Date.now();
    const recent = now - this.at < this.windowMs;
    if (recent && (key === this.last || this.last.includes(key))) return false;
    this.last = key;
    this.at = now;
    return true;
  }
}

export interface VoiceOptions {
  roomId: string;
  /** Language my speech is translated into (the partner's) */
  targetLanguage: string;
  /** Mic audio is held back while this returns true, so the partner's voice from my speaker is not re-translated */
  isHearingPartner: () => boolean;
  /** What the partner said lately, in my language; a sentence of mine that repeats it is speaker echo */
  recentlyHeard: () => string;
  onState: (state: VoiceState, error?: string) => void;
  /** Translated audio to relay to the partner */
  onAudio: (b64: string) => void;
  /** Running translated caption of the current sentence ('' when it ends) */
  onCaption: (translated: string, original: string) => void;
  /** A finished sentence: what I said and how it was translated */
  onSentence: (original: string, translated: string, detectedLanguage?: string) => void;
}

export class VoiceTranslator implements VoiceEngine {
  private session: Session | null = null;
  private stream: MediaStream | null = null;
  private nodes: AudioNode[] = [];
  private active = false;
  private muted = false;
  private original = '';
  private translated = '';
  private detected?: string;
  /** The current sentence is speaker echo: nothing of it is relayed or saved */
  private echo = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private relay: Uint8Array[] = [];
  private relayTimer: ReturnType<typeof setInterval> | null = null;
  private retries = 0;
  private gate = new SentenceGate();

  constructor(private opts: VoiceOptions) {}

  async start() {
    this.active = true;
    this.opts.onState('connecting');
    try {
      const ctx = getAudioContext();
      if (!ctx) throw new Error('Bu tarayıcı ses desteklemiyor');
      await ctx.resume().catch(() => {});

      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      if (!this.active) return this.release();

      if (!workletLoaded.has(ctx)) {
        const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
        await ctx.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        workletLoaded.add(ctx);
      }
      const source = ctx.createMediaStreamSource(this.stream);
      const capture = new AudioWorkletNode(ctx, 'lt-capture');
      const sink = ctx.createGain();
      sink.gain.value = 0; // keeps the worklet pulled without playing my own voice back
      source.connect(capture).connect(sink).connect(ctx.destination);
      this.nodes = [source, capture, sink];

      const downsampler = new Downsampler(ctx.sampleRate / INPUT_RATE, (pcm) => {
        if (!this.session || this.muted || this.opts.isHearingPartner()) return;
        this.session.sendRealtimeInput({
          audio: { data: toBase64(new Uint8Array(pcm.buffer)), mimeType: `audio/pcm;rate=${INPUT_RATE}` },
        });
      });
      capture.port.onmessage = (e) => downsampler.push(e.data as Float32Array);

      this.relayTimer = setInterval(() => this.flushRelay(), RELAY_INTERVAL_MS);
      await this.connect();
    } catch (err) {
      const message = err instanceof DOMException && err.name === 'NotAllowedError'
        ? 'Mikrofon izni verilmedi'
        : err instanceof Error ? err.message : String(err);
      this.opts.onState('error', message);
      this.stop();
    }
  }

  private async connect() {
    const res = await fetch('/api/live-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room_id: this.opts.roomId, target_language: this.opts.targetLanguage })
    });
    
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      const reason = errorData.error;
      throw new Error(
        reason === 'vip_required' ? 'VIP üyelik gerekli'
        : reason === 'vip_off' ? 'VIP sesli çeviri şu an kapalı'
        : 'Sesli çeviri başlatılamadı'
      );
    }
    
    const data = await res.json();
    if (!data?.token) {
      throw new Error('Sesli çeviri başlatılamadı');
    }
    if (!this.active) return;

    const { GoogleGenAI } = await loadGenAI();
    const ai = new GoogleGenAI({ apiKey: data.token, httpOptions: { apiVersion: 'v1alpha' } });
    this.session = await ai.live.connect({
      model: data.model,
      config: data.config,
      callbacks: {
        onopen: () => {
          this.retries = 0;
          this.opts.onState('live');
        },
        onmessage: (msg) => {
          const c = msg.serverContent;
          if (!c) return;
          let changed = false;
          if (c.inputTranscription?.text) {
            this.original += c.inputTranscription.text;
            if (c.inputTranscription.languageCode) this.detected = c.inputTranscription.languageCode;
            if (!this.echo && words(this.original).length >= ECHO_MIN_WORDS && isEcho(this.original, this.opts.recentlyHeard())) {
              this.echo = true;
              this.relay = [];
            }
            changed = true;
          }
          if (!this.echo) {
            for (const part of c.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) this.relay.push(fromBase64(part.inlineData.data));
            }
          }
          if (c.outputTranscription?.text) {
            this.translated += c.outputTranscription.text;
            changed = true;
          }
          if (changed) {
            if (!this.echo) this.opts.onCaption(this.translated.trim(), this.original.trim());
            this.scheduleSentenceEnd();
          }
        },
        onerror: (e) => console.warn('Live translate error', e),
        onclose: () => {
          this.session = null;
          // Sessions end after ~10 minutes or on network drops; reconnect while the call is on
          if (!this.active) return;
          if (this.retries++ >= 3) {
            this.opts.onState('error', 'Bağlantı koptu');
            this.stop();
            return;
          }
          this.opts.onState('connecting');
          setTimeout(() => {
            if (this.active) this.connect().catch((err) => {
              this.opts.onState('error', err instanceof Error ? err.message : String(err));
              this.stop();
            });
          }, 500 * this.retries);
        },
      },
    });
    if (!this.active) this.session.close();
  }

  private scheduleSentenceEnd() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.finishSentence(), SEGMENT_IDLE_MS);
  }

  private finishSentence() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const original = collapseRepeats(this.original);
    const translated = collapseRepeats(this.translated);
    // Short sentences are judged now that they are complete
    const echo = this.echo || isEcho(original, this.opts.recentlyHeard());
    if (!echo) this.flushRelay(true);
    this.original = '';
    this.translated = '';
    this.echo = false;
    this.relay = [];
    this.opts.onCaption('', '');
    if (original && !echo && this.gate.pass(original)) this.opts.onSentence(original, translated, this.detected);
  }

  /** Audio waits until the transcript shows the sentence is not echo */
  private flushRelay(force = false) {
    if (!this.relay.length || this.echo) return;
    // Until a sentence is long enough to judge, its audio waits (short ones are sent when they end)
    if (!force && words(this.original).length < ECHO_MIN_WORDS) return;
    const total = this.relay.reduce((n, b) => n + b.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const b of this.relay) { merged.set(b, offset); offset += b.length; }
    this.relay = [];
    this.opts.onAudio(toBase64(merged));
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    // Tell Gemini the speaker paused so the current sentence is flushed right away
    if (muted) this.session?.sendRealtimeInput({ audioStreamEnd: true });
  }

  private release() {
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.nodes.forEach(n => { try { n.disconnect(); } catch { /* already gone */ } });
    this.nodes = [];
  }

  stop() {
    if (!this.active && !this.stream && !this.session) return;
    this.active = false;
    if (this.relayTimer) clearInterval(this.relayTimer);
    this.relayTimer = null;
    if (this.original.trim()) this.finishSentence();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.release();
    this.session?.close();
    this.session = null;
  }
}

// ---------------------------------------------------------------------------
// Free mode: the browser's own speech recognition and speech synthesis.
// My speech becomes text, goes through the normal text translation, and the partner's phone reads it aloud.

export type VoiceMode = 'free' | 'paid';

/** Both engines share this shape so the room does not care which one runs */
export interface VoiceEngine {
  start(): Promise<void>;
  stop(): void;
  setMuted(muted: boolean): void;
}

const SPEECH_LOCALES: Record<string, string> = {
  tr: 'tr-TR', en: 'en-US', de: 'de-DE', fr: 'fr-FR', es: 'es-ES', it: 'it-IT',
  ru: 'ru-RU', ar: 'ar-SA', ja: 'ja-JP', ko: 'ko-KR', th: 'th-TH', tk: 'tk-TM',
  pt: 'pt-BR', nl: 'nl-NL', pl: 'pl-PL', uk: 'uk-UA', zh: 'zh-CN', hi: 'hi-IN', fa: 'fa-IR',
  az: 'az-AZ', el: 'el-GR', sv: 'sv-SE', id: 'id-ID', vi: 'vi-VN', ro: 'ro-RO', bg: 'bg-BG',
};
const speechLocale = (lang: string) => {
  if (!lang || lang === 'auto') return typeof navigator !== 'undefined' ? navigator.language : 'en-US';
  return SPEECH_LOCALES[lang] || lang;
};

type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  onstart: (() => void) | null; onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  start(): void; abort(): void;
};
const recognitionCtor = (): (new () => Recognition) | null =>
  (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;

export const isFreeVoiceSupported = () => typeof window !== 'undefined' && !!recognitionCtor() && 'speechSynthesis' in window;

export interface BrowserVoiceOptions {
  /** My language: what the recognizer listens for */
  language: string;
  /** What the partner said lately, in my language (see isEcho) */
  recentlyHeard: () => string;
  /** True while the partner's VIP audio plays from my speaker; nothing I "say" then is sent */
  isHearingPartner?: () => boolean;
  onState: (state: VoiceState, error?: string) => void;
  /** What I am saying right now, before it is final */
  onCaption: (original: string) => void;
  /** A finished sentence in my language */
  onSentence: (original: string) => void;
}

export class BrowserVoiceTranslator implements VoiceEngine {
  private rec: Recognition | null = null;
  private active = false;
  private muted = false;
  private held = false;
  private running = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  /** Result indexes already sent in this recognition session (Android repeats old results) */
  private handled = new Set<number>();
  private gate = new SentenceGate();

  constructor(private opts: BrowserVoiceOptions) {}

  async start() {
    const Ctor = recognitionCtor();
    if (!Ctor || !('speechSynthesis' in window)) {
      this.opts.onState('error', 'Bu tarayıcı sesli çeviriyi desteklemiyor');
      return;
    }
    this.active = true;
    this.opts.onState('connecting');
    unlockSpeech();

    const rec = new Ctor();
    rec.lang = speechLocale(this.opts.language);
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onstart = () => { this.running = true; this.handled.clear(); this.opts.onState('live'); };
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (this.handled.has(i)) continue;
        const text = collapseRepeats(e.results[i][0].transcript);
        if (!text) continue;
        if (e.results[i].isFinal) {
          this.handled.add(i);
          this.opts.onCaption('');
          const hearing = this.held || !!this.opts.isHearingPartner?.();
          if (!hearing && !isEcho(text, this.opts.recentlyHeard()) && this.gate.pass(text)) this.opts.onSentence(text);
        } else {
          interim += (interim ? ' ' : '') + text;
        }
      }
      if (interim) this.opts.onCaption(interim);
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.opts.onState('error', 'Mikrofon izni verilmedi');
        this.stop();
      } else if (e.error === 'language-not-supported') {
        this.opts.onState('error', 'Bu dil tarayıcıda tanınmıyor');
        this.stop();
      }
      // 'no-speech', 'aborted', 'network': onend restarts it
    };
    // Phones stop listening after a pause; keep it going for the whole call
    rec.onend = () => {
      this.running = false;
      this.opts.onCaption('');
      this.scheduleRestart();
    };
    this.rec = rec;
    this.resume();
  }

  private get shouldListen() {
    return this.active && !this.muted && !this.held;
  }

  private resume() {
    if (!this.rec || this.running || !this.shouldListen) return;
    try { this.rec.start(); } catch { /* already starting */ }
  }

  private scheduleRestart() {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => this.resume(), 250);
  }

  private pause() {
    if (this.rec && this.running) this.rec.abort();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (muted) this.pause(); else this.resume();
  }

  /** Stop listening while the partner's translation is read aloud, so my mic does not pick it up */
  setHeld(held: boolean) {
    this.held = held;
    if (held) this.pause(); else this.scheduleRestart();
  }

  stop() {
    this.active = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.pause();
    this.rec = null;
    window.speechSynthesis?.cancel();
  }
}

export const isDictationSupported = () => typeof window !== 'undefined' && !!recognitionCtor();

/**
 * Voice typing ("sesli yazma") for the message field: listens in my language until stopped.
 * onText gets the finished text so far plus what is being said right now.
 */
export class Dictation {
  private rec: Recognition | null = null;
  private finalText = '';
  private active = false;
  /** Result indexes already used (Android repeats old results) */
  private handled = new Set<number>();
  /** What was already sent; iPhones keep repeating the whole session's text, so it is cut off the front */
  private sent = '';
  private last = '';

  constructor(private opts: {
    language: string;
    onText: (finalText: string, interim: string) => void;
    onEnd: (error?: string) => void;
  }) {}

  start() {
    const Ctor = recognitionCtor();
    if (!Ctor) return this.opts.onEnd('Bu tarayıcı sesli yazmayı desteklemiyor');
    this.active = true;
    const rec = new Ctor();
    rec.lang = speechLocale(this.opts.language);
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    const handled = this.handled;
    // A new recognition session starts empty: nothing old to cut off
    rec.onstart = () => { handled.clear(); this.sent = ''; this.last = ''; };
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (handled.has(i)) continue;
        const text = collapseRepeats(e.results[i][0].transcript);
        if (!text) continue;
        if (e.results[i].isFinal) {
          handled.add(i);
          // Android repeats a finished phrase; keep it once
          if (!this.finalText.toLocaleLowerCase().endsWith(text.toLocaleLowerCase())) {
            this.finalText = (this.finalText ? this.finalText + ' ' : '') + text;
          }
        } else {
          interim += (interim ? ' ' : '') + text;
        }
      }
      let spoken = [this.finalText, interim].filter(Boolean).join(' ');
      const done = words(this.sent);
      if (done.length) {
        const parts = spoken.split(/\s+/).filter(Boolean);
        // Skip whole tokens until the sent words are used up; only when the text really starts with them
        let i = 0, used: string[] = [];
        while (i < parts.length && used.length < done.length) used = used.concat(words(parts[i++]));
        if (used.length === done.length && used.every((w, k) => w === done[k])) spoken = parts.slice(i).join(' ');
      }
      // iPhones re-send the same result while it is quiet: only real changes count as speech
      if (spoken === this.last) return;
      this.last = spoken;
      this.opts.onText(spoken, '');
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') this.finish('Mikrofon izni verilmedi');
      else if (e.error === 'language-not-supported') this.finish('Bu dil tarayıcıda tanınmıyor');
    };
    // Phones stop after a pause; keep listening until the user taps stop
    rec.onend = () => {
      if (!this.active) return;
      setTimeout(() => { if (this.active) { try { rec.start(); } catch { this.finish(); } } }, 200);
    };
    this.rec = rec;
    try { rec.start(); } catch { this.finish('Sesli yazma başlatılamadı'); }
  }

  private finish(error?: string) {
    if (!this.active) return;
    this.active = false;
    try { this.rec?.abort(); } catch { /* already stopped */ }
    this.rec = null;
    this.opts.onEnd(error);
  }

  stop() {
    this.finish();
  }

  /** The text so far was sent: start over; what was sent is cut off anything the recognizer repeats */
  reset() {
    // Android gives new results after a send; iPhones repeat the old text in front of the new
    this.sent = [this.sent, this.last].filter(Boolean).join(' ');
    this.last = '';
    this.finalText = '';
  }
}

/** iOS only speaks after speech was started inside a tap; call from the tap that joins the call */
export function unlockSpeech() {
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    window.speechSynthesis.speak(u);
  } catch { /* no speech synthesis */ }
}

let voicesReady: Promise<SpeechSynthesisVoice[]> | null = null;
/** Chrome loads voices late: the first getVoices() is often empty */
function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  const now = window.speechSynthesis.getVoices();
  if (now.length) return Promise.resolve(now);
  voicesReady ??= new Promise((resolve) => {
    const done = () => resolve(window.speechSynthesis.getVoices());
    window.speechSynthesis.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 1500);
  });
  return voicesReady;
}

/** The most natural installed voice for a language */
function pickVoice(voices: SpeechSynthesisVoice[], locale: string, lang: string) {
  const base = locale.split('-')[0].toLowerCase();
  const same = (v: SpeechSynthesisVoice) => v.lang.replace('_', '-').toLowerCase();
  const candidates = voices.filter(v => same(v) === locale.toLowerCase());
  const pool = candidates.length ? candidates : voices.filter(v => same(v).split('-')[0] === (base || lang));
  const score = (v: SpeechSynthesisVoice) =>
    (/natural|neural|enhanced|premium|siri/i.test(v.name) ? 4 : 0) + (/google/i.test(v.name) ? 2 : 0) + (v.default ? 1 : 0);
  return pool.sort((a, b) => score(b) - score(a))[0];
}

/** Chrome cuts utterances off after ~15 seconds: speak long text sentence by sentence */
function splitForSpeech(text: string) {
  const parts = text.match(/[^.!?。！？]+[.!?。！？]*/g)?.map(p => p.trim()).filter(Boolean) ?? [text];
  const chunks: string[] = [];
  for (const part of parts) {
    if (part.length <= 180) { chunks.push(part); continue; }
    let rest = part;
    while (rest.length > 180) {
      const cut = rest.lastIndexOf(' ', 180);
      chunks.push(rest.slice(0, cut > 40 ? cut : 180));
      rest = rest.slice(cut > 40 ? cut + 1 : 180);
    }
    if (rest) chunks.push(rest);
  }
  return chunks;
}

function speakChunk(text: string, locale: string, voice?: SpeechSynthesisVoice): Promise<void> {
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = locale;
    if (voice) u.voice = voice;
    u.rate = 1;
    u.pitch = 1;
    u.volume = 1;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(watchdog);
      clearInterval(keepAlive);
      resolve();
    };
    // Some phones never fire onend; never let one sentence block the call (the mic waits for it)
    const watchdog = setTimeout(() => { window.speechSynthesis.cancel(); finish(); }, 3000 + text.length * 120);
    // Chrome pauses long speech in the background; nudging it keeps it going
    const keepAlive = setInterval(() => { if (window.speechSynthesis.paused) window.speechSynthesis.resume(); }, 1000);
    u.onend = finish;
    u.onerror = finish;
    window.speechSynthesis.speak(u);
  });
}

/** Reads text aloud in the given language with the most natural voice available; resolves when done */
export async function speak(text: string, lang: string): Promise<void> {
  if (!('speechSynthesis' in window) || !text.trim()) return;
  const locale = speechLocale(lang);
  const voice = pickVoice(await loadVoices(), locale, lang);
  for (const chunk of splitForSpeech(collapseRepeats(text))) await speakChunk(chunk, locale, voice);
}

/** True while this phone reads a translation aloud */
export const isSpeaking = () => typeof window !== 'undefined' && 'speechSynthesis' in window && window.speechSynthesis.speaking;
