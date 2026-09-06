import { TABLE_BGM_URL } from "../resources/cache-policy";

export const SOUND_SOURCES = {
  shuffle: "/assets/audio/sfx/card-shuffle.mp3",
  cardFlip: "/assets/audio/sfx/card-flip.ogg",
  blackjack: "/assets/audio/sfx/blackjack.ogg",
  bust: "/assets/audio/sfx/bust.ogg",
  compare: "/assets/audio/sfx/compare.ogg",
  result: "/assets/audio/sfx/result.ogg",
  stand: "/assets/audio/sfx/stand.ogg",
  heartbeat: "/assets/audio/sfx/heartbeat.ogg",
  dryFire: "/assets/audio/sfx/revolver-dry-fire.ogg",
  /** Dedicated routing key; replace this asset when the final misfire SFX is available. */
  misfire: "/assets/audio/sfx/revolver-dry-fire.ogg",
  gunshot: "/assets/audio/sfx/revolver-gunshot.ogg"
} as const;

export type SoundCue = keyof typeof SOUND_SOURCES;

const SOUND_VOLUME: Readonly<Record<SoundCue, number>> = {
  shuffle: 0.56,
  cardFlip: 0.62,
  blackjack: 0.66,
  bust: 0.7,
  compare: 0.64,
  result: 0.74,
  stand: 0.76,
  heartbeat: 0.34,
  dryFire: 0.72,
  misfire: 0.72,
  gunshot: 0.78
};

const BGM_VOLUME = 0.18;
const DUCKED_BGM_VOLUME = 0.08;

type AudioContextConstructor = typeof AudioContext;

interface WindowWithWebkitAudio extends Window {
  webkitAudioContext?: AudioContextConstructor;
}

/**
 * Presentation-only audio service. Short effects use decoded Web Audio buffers
 * for low latency; the long BGM is streamed by HTMLAudioElement to keep memory
 * use reasonable on Android devices.
 */
export class GameAudio {
  private enabled = true;
  private unlocked = false;
  private context?: AudioContext;
  private output?: GainNode;
  private bgm?: HTMLAudioElement;
  private readonly encodedAudio = new Map<SoundCue, ArrayBuffer>();
  private readonly pendingAudio = new Map<SoundCue, Promise<ArrayBuffer | null>>();
  private readonly buffers = new Map<SoundCue, AudioBuffer>();
  private readonly pendingBuffers = new Map<SoundCue, Promise<AudioBuffer | null>>();
  private criticalSoundsWarmed = false;
  private heartbeatRequested = false;
  private heartbeatSource?: AudioBufferSourceNode;
  private fallbackHeartbeat?: HTMLAudioElement;

  configure(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.stopHeartbeat();
      this.pauseBgm();
      return;
    }
    if (this.unlocked) {
      void this.resumeContext();
      this.warmCriticalSounds();
      this.playBgm();
    }
  }

  /** Prepares only the streamed BGM metadata while the player is in the lobby. */
  preloadLobby(): void {
    if (!this.enabled) return;
    this.ensureBgm().load();
  }

  /** Fetches compressed table cues after a match has been entered. */
  preloadMatch(): void {
    if (!this.enabled) return;
    for (const cue of Object.keys(SOUND_SOURCES) as SoundCue[]) void this.loadEncodedAudio(cue);
  }

  /** Must be called from a trusted pointer or keyboard event on mobile browsers. */
  unlock(): void {
    this.unlocked = true;
    void this.resumeContext();
    if (this.enabled) {
      this.warmCriticalSounds();
      this.playBgm();
    }
  }

  play(cue: Exclude<SoundCue, "heartbeat">, delayMs = 0): void {
    if (!this.enabled || !this.unlocked) return;
    const context = this.ensureContext();
    if (!context) {
      this.playFallback(cue, false, delayMs);
      return;
    }
    void this.resumeContext();
    void this.loadBuffer(cue, context).then((buffer) => {
      if (!buffer || !this.enabled || !this.unlocked) {
        if (!buffer) this.playFallback(cue, false, delayMs);
        return;
      }
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      gain.gain.value = SOUND_VOLUME[cue];
      source.connect(gain);
      gain.connect(this.output ?? context.destination);
      source.start(context.currentTime + Math.max(0, delayMs) / 1000);
    });
  }

  startHeartbeat(): void {
    if (!this.enabled || !this.unlocked || this.heartbeatRequested) return;
    this.heartbeatRequested = true;
    this.setBgmVolume(DUCKED_BGM_VOLUME);
    const context = this.ensureContext();
    if (!context) {
      this.playFallback("heartbeat", true);
      return;
    }
    void this.resumeContext();
    void this.loadBuffer("heartbeat", context).then((buffer) => {
      if (!buffer) {
        if (this.enabled && this.heartbeatRequested && !this.fallbackHeartbeat) this.playFallback("heartbeat", true);
        return;
      }
      if (!this.enabled || !this.heartbeatRequested || this.heartbeatSource) return;
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      source.loop = true;
      gain.gain.value = SOUND_VOLUME.heartbeat;
      source.connect(gain);
      gain.connect(this.output ?? context.destination);
      source.addEventListener("ended", () => {
        if (this.heartbeatSource === source) this.heartbeatSource = undefined;
      }, { once: true });
      this.heartbeatSource = source;
      source.start();
    });
  }

  stopHeartbeat(): void {
    this.heartbeatRequested = false;
    if (this.heartbeatSource) {
      try { this.heartbeatSource.stop(); } catch { /* The source may already have ended. */ }
      this.heartbeatSource.disconnect();
      this.heartbeatSource = undefined;
    }
    if (this.fallbackHeartbeat) {
      this.fallbackHeartbeat.pause();
      this.fallbackHeartbeat.currentTime = 0;
      this.fallbackHeartbeat = undefined;
    }
    this.setBgmVolume(BGM_VOLUME);
  }

  pauseBgm(): void {
    this.bgm?.pause();
  }

  restoreBgm(): void {
    if (!this.unlocked || !this.enabled) return;
    void this.resumeContext();
    this.playBgm();
  }

  private ensureContext(): AudioContext | undefined {
    if (this.context) return this.context;
    const AudioCtor = window.AudioContext ?? (window as WindowWithWebkitAudio).webkitAudioContext;
    if (!AudioCtor) return undefined;
    this.context = new AudioCtor({ latencyHint: "interactive" });
    this.output = this.context.createGain();
    this.output.connect(this.context.destination);
    return this.context;
  }

  private async resumeContext(): Promise<void> {
    const context = this.ensureContext();
    if (context?.state === "suspended") {
      try { await context.resume(); } catch { /* Audio remains best-effort. */ }
    }
  }

  private warmCriticalSounds(): void {
    if (this.criticalSoundsWarmed) return;
    const context = this.ensureContext();
    if (!context) return;
    this.criticalSoundsWarmed = true;
    // Decode sequentially to keep UI work responsive while ensuring the whole
    // confirm → heartbeat → revolver path is ready well before it is reached.
    void (async () => {
      for (const cue of ["stand", "heartbeat", "dryFire", "misfire", "gunshot"] as const) await this.loadBuffer(cue, context);
    })();
  }

  private loadBuffer(cue: SoundCue, context: AudioContext): Promise<AudioBuffer | null> {
    const decoded = this.buffers.get(cue);
    if (decoded) return Promise.resolve(decoded);
    const pending = this.pendingBuffers.get(cue);
    if (pending) return pending;
    const request = this.loadEncodedAudio(cue)
      .then((data) => data ? context.decodeAudioData(data.slice(0)) : null)
      .then((buffer) => {
        if (buffer) this.buffers.set(cue, buffer);
        return buffer;
      })
      .catch(() => null)
      .finally(() => this.pendingBuffers.delete(cue));
    this.pendingBuffers.set(cue, request);
    return request;
  }

  private loadEncodedAudio(cue: SoundCue): Promise<ArrayBuffer | null> {
    const encoded = this.encodedAudio.get(cue);
    if (encoded) return Promise.resolve(encoded);
    const pending = this.pendingAudio.get(cue);
    if (pending) return pending;
    const request = fetch(SOUND_SOURCES[cue], { cache: "force-cache" })
      .then((response) => {
        if (!response.ok) throw new Error(`Audio request failed: ${response.status}`);
        return response.arrayBuffer();
      })
      .then((data) => {
        this.encodedAudio.set(cue, data);
        return data;
      })
      .catch(() => null)
      .finally(() => this.pendingAudio.delete(cue));
    this.pendingAudio.set(cue, request);
    return request;
  }

  private ensureBgm(): HTMLAudioElement {
    if (this.bgm) return this.bgm;
    const bgm = new Audio(TABLE_BGM_URL);
    bgm.loop = true;
    bgm.preload = "metadata";
    bgm.volume = BGM_VOLUME;
    this.bgm = bgm;
    return bgm;
  }

  private playBgm(): void {
    if (!this.enabled || !this.unlocked || document.hidden) return;
    const bgm = this.ensureBgm();
    if (!bgm.paused) return;
    void bgm.play().catch(() => undefined);
  }

  private setBgmVolume(volume: number): void {
    if (this.bgm) this.bgm.volume = volume;
  }

  private playFallback(cue: SoundCue, loop: boolean, delayMs = 0): void {
    const sample = new Audio(SOUND_SOURCES[cue]);
    sample.loop = loop;
    sample.volume = SOUND_VOLUME[cue];
    if (cue === "heartbeat") this.fallbackHeartbeat = sample;
    const start = () => {
      if (!this.enabled || !this.unlocked) return;
      void sample.play().catch(() => undefined);
    };
    if (delayMs > 0) window.setTimeout(start, delayMs);
    else start();
  }
}

export const gameAudio = new GameAudio();
