import { describe, expect, it, vi } from "vitest";
import { CHARACTER_CATALOG, isCharacterUnlocked, loadCharacter } from "../content/characters";
import { LOBBY_BACKGROUND_URL, TABLE_BACKGROUND_URL } from "./cache-policy";
import { characterResourcePlan, lobbyResourceUrls, ResourceLoader } from "./resource-loader";
import { SKILL_ARCHETYPE_ART, SKILL_ARCHETYPE_ART_URLS } from "./skill-archetype-art";

function successfulResponse(body = "asset"): Response {
  return new Response(body, { status: 200 });
}

describe("staged resource loading", () => {
  it("queues all normal and selected archetype art outside the initial app shell", () => {
    expect(SKILL_ARCHETYPE_ART_URLS).toHaveLength(8);
    expect(new Set(SKILL_ARCHETYPE_ART_URLS).size).toBe(8);
    expect(SKILL_ARCHETYPE_ART_URLS.every((url) => url.startsWith("/assets/skills/") && url.endsWith(".png"))).toBe(true);
    expect(SKILL_ARCHETYPE_ART.cheater.selected).toBe("/assets/skills/archetype-cheater-selected.png");
  });

  it("keeps the lobby pack to base art and currently unlocked portraits", () => {
    const unlocked = CHARACTER_CATALOG.filter((character) => isCharacterUnlocked(character, []));
    expect(lobbyResourceUrls(unlocked)).toEqual([
      LOBBY_BACKGROUND_URL,
      "/assets/characters/plume-relaxed.png"
    ]);
  });

  it("separates first-frame art, later match art, and the remaining character pack", async () => {
    const character = await loadCharacter("plume");
    const plan = characterResourcePlan(character);

    expect(plan.visible).toEqual([
      TABLE_BACKGROUND_URL,
      "/assets/characters/plume-relaxed.png",
      "/assets/characters/staff-revolver-7mm.png"
    ]);
    expect(plan.display).toEqual([
      "/assets/characters/plume-conflicted.png",
      "/assets/characters/plume-mocking.png",
      "/assets/characters/plume-threatened.png",
      "/assets/characters/plume-unconscious-reclined.png",
      "/assets/characters/plume-defeated-summary-chair.png"
    ]);
    expect(plan.background).toContain("/assets/characters/plume-trophy-defeated.png");
    expect(plan.background).toContain("/assets/characters/plume-trophy-gallery-headshot.png");
    expect(plan.background).toContain("/assets/characters/plume-trophy-detail-boots-p1.png");
    expect(new Set([...plan.visible, ...plan.display, ...plan.background]).size)
      .toBe(plan.visible.length + plan.display.length + plan.background.length);

    expect(characterResourcePlan(character, {
      visibleArt: [character.assets.defeatedSummary],
      includeTableBase: false
    }).visible).toEqual([character.assets.defeatedSummary]);
  });

  it("reserves a request slot so match art does not wait behind lobby background work", async () => {
    const requestFetch = vi.fn((_input: RequestInfo | URL) => new Promise<Response>(() => undefined));
    const loader = new ResourceLoader({ fetch: requestFetch as typeof fetch, concurrency: 3 });
    void loader.enqueue([
      "/assets/lobby-1.png",
      "/assets/lobby-2.png",
      "/assets/lobby-3.png"
    ], "background");
    expect(requestFetch).toHaveBeenCalledTimes(2);

    void loader.enqueue(["/assets/table-visible.png"], "visible");
    expect(requestFetch).toHaveBeenCalledTimes(3);
    expect(requestFetch.mock.calls[2]?.[0]).toBe("/assets/table-visible.png");
  });

  it("downloads deferred archetype art one at a time and lets table resources overtake it", () => {
    const requestFetch = vi.fn((_input: RequestInfo | URL) => new Promise<Response>(() => undefined));
    const loader = new ResourceLoader({ fetch: requestFetch as typeof fetch, concurrency: 3 });
    void loader.enqueue([
      "/assets/skills/archetype-1.png",
      "/assets/skills/archetype-2.png",
      "/assets/skills/archetype-3.png"
    ], "deferred");
    expect(requestFetch).toHaveBeenCalledTimes(1);

    void loader.enqueue(["/assets/table-visible.png"], "visible");
    void loader.enqueue(["/assets/table-display.png"], "display");
    expect(requestFetch.mock.calls.map((call) => call[0])).toEqual([
      "/assets/skills/archetype-1.png",
      "/assets/table-visible.png",
      "/assets/table-display.png"
    ]);
  });

  it("lets newly visible art overtake queued background downloads", async () => {
    const resolvers: Array<(response: Response) => void> = [];
    const requested: string[] = [];
    const requestFetch = vi.fn((input: RequestInfo | URL) => {
      requested.push(String(input));
      return new Promise<Response>((resolve) => resolvers.push(resolve));
    });
    const loader = new ResourceLoader({ fetch: requestFetch as typeof fetch, concurrency: 1 });
    const background = loader.enqueue(["/assets/background-1.png", "/assets/background-2.png"], "background");
    expect(requested).toEqual(["/assets/background-1.png"]);

    const visible = loader.enqueue(["/assets/visible.png"], "visible");
    resolvers.shift()?.(successfulResponse());
    await vi.waitFor(() => expect(requested).toEqual(["/assets/background-1.png", "/assets/visible.png"]));
    resolvers.shift()?.(successfulResponse());
    await visible;
    await vi.waitFor(() => expect(requested).toEqual([
      "/assets/background-1.png",
      "/assets/visible.png",
      "/assets/background-2.png"
    ]));
    resolvers.shift()?.(successfulResponse());
    await background;
  });

  it("stores successful staged requests in the shared runtime cache", async () => {
    const put = vi.fn(async () => undefined);
    const open = vi.fn(async () => ({ put } as unknown as Cache));
    const requestFetch = vi.fn(async () => successfulResponse("portrait"));
    const loader = new ResourceLoader({
      fetch: requestFetch as typeof fetch,
      cacheStorage: { open },
      concurrency: 1
    });

    await expect(loader.enqueue(["/assets/characters/plume-relaxed.png"], "visible")).resolves.toEqual([true]);
    expect(open).toHaveBeenCalledWith("blackjack-resource-pack-v1");
    expect(put).toHaveBeenCalledWith("/assets/characters/plume-relaxed.png", expect.any(Response));
    expect(requestFetch).toHaveBeenCalledWith("/assets/characters/plume-relaxed.png", {
      cache: "no-cache",
      credentials: "same-origin"
    });
  });
});
