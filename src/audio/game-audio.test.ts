import { afterEach, describe, expect, it, vi } from "vitest";
import { TABLE_BGM_URL } from "../resources/cache-policy";
import { GameAudio, SOUND_SOURCES } from "./game-audio";

class RecordingAudioElement {
  static readonly instances: RecordingAudioElement[] = [];
  readonly load = vi.fn();
  readonly src: string;
  loop = false;
  preload = "";
  volume = 1;

  constructor(src: string) {
    this.src = src;
    RecordingAudioElement.instances.push(this);
  }
}

afterEach(() => {
  RecordingAudioElement.instances.length = 0;
  vi.unstubAllGlobals();
});

describe("staged game audio loading", () => {
  it("loads only BGM metadata in the lobby without fetching table cues", () => {
    const requestFetch = vi.fn();
    vi.stubGlobal("fetch", requestFetch);
    vi.stubGlobal("Audio", RecordingAudioElement);

    new GameAudio().preloadLobby();

    expect(requestFetch).not.toHaveBeenCalled();
    expect(RecordingAudioElement.instances).toHaveLength(1);
    expect(RecordingAudioElement.instances[0]).toMatchObject({
      src: TABLE_BGM_URL,
      preload: "metadata",
      loop: true
    });
    expect(RecordingAudioElement.instances[0]?.load).toHaveBeenCalledOnce();
  });

  it("defers short sound fetches until the match stage", async () => {
    const requestFetch = vi.fn(async (_input: RequestInfo | URL) => new Response("sound", { status: 200 }));
    vi.stubGlobal("fetch", requestFetch);

    new GameAudio().preloadMatch();

    await vi.waitFor(() => expect(requestFetch).toHaveBeenCalledTimes(Object.keys(SOUND_SOURCES).length));
    const soundUrls = new Set<string>(Object.values(SOUND_SOURCES));
    expect(requestFetch.mock.calls.every(([url]) => soundUrls.has(String(url)))).toBe(true);
    expect(requestFetch.mock.calls.some(([url]) => String(url) === TABLE_BGM_URL)).toBe(false);
  });

  it("does not preload audio while sound is disabled", () => {
    const requestFetch = vi.fn();
    vi.stubGlobal("fetch", requestFetch);
    vi.stubGlobal("Audio", RecordingAudioElement);
    const audio = new GameAudio();
    audio.configure(false);

    audio.preloadLobby();
    audio.preloadMatch();

    expect(RecordingAudioElement.instances).toHaveLength(0);
    expect(requestFetch).not.toHaveBeenCalled();
  });
});
