import { describe, expect, it } from "vitest";
import { CHARACTER_CATALOG } from "./catalog";
import { defeatedCharacterIdsByFirstDefeat, isCharacterUnlocked, newlyUnlockedCharacterIds, unlockedCharacterIdsForDefeats } from "./unlocks";

const defeat = (opponentId: string, timestamp = "2026-01-01T00:00:00.000Z") => ({ opponentId, timestamp });

describe("character unlock conditions", () => {
  it("starts with Plume, then opens the first branch after any victory", () => {
    expect(unlockedCharacterIdsForDefeats([])).toEqual(["plume"]);
    expect(unlockedCharacterIdsForDefeats([defeat("plume")])).toEqual(["w", "irene", "plume", "platinum", "lappland-the-decadenza"]);
    expect(unlockedCharacterIdsForDefeats([defeat("plume"), defeat("lappland-the-decadenza")])).toEqual(["w", "texas", "irene", "nian", "plume", "platinum", "lappland-the-decadenza", "ho-olheyak"]);
  });

  it("supports any, exact, tag, and percentage defeat predicates", () => {
    const w = CHARACTER_CATALOG.find((character) => character.id === "w")!;
    const nian = CHARACTER_CATALOG.find((character) => character.id === "nian")!;
    const hoOlheyak = CHARACTER_CATALOG.find((character) => character.id === "ho-olheyak")!;
    const dorothy = CHARACTER_CATALOG.find((character) => character.id === "dorothy")!;
    expect(isCharacterUnlocked({ ...w, unlock: { type: "defeat-any" } }, [])).toBe(false);
    expect(isCharacterUnlocked({ ...w, unlock: { type: "defeat-any" } }, [defeat("plume")])).toBe(true);
    expect(isCharacterUnlocked(w, [defeat("texas")])).toBe(true);
    expect(isCharacterUnlocked(nian, [defeat("texas")])).toBe(false);
    expect(isCharacterUnlocked(w, [])).toBe(false);
    expect(isCharacterUnlocked({ ...w, unlock: { type: "defeat-any-tag", tag: "tier:s" } }, [defeat("w")])).toBe(true);
    expect(isCharacterUnlocked(hoOlheyak, [defeat("texas")])).toBe(false);
    expect(isCharacterUnlocked(hoOlheyak, [defeat("w")])).toBe(true);
    expect(isCharacterUnlocked(dorothy, [defeat("w")])).toBe(false);
    expect(isCharacterUnlocked(dorothy, [defeat("ho-olheyak")])).toBe(true);
    expect(isCharacterUnlocked(nian, [defeat("w")])).toBe(true);
    const texas = CHARACTER_CATALOG.find((character) => character.id === "texas")!;
    expect(isCharacterUnlocked(texas, [defeat("lappland-the-decadenza")])).toBe(true);
    expect(isCharacterUnlocked(texas, [defeat("w")])).toBe(false);
    expect(isCharacterUnlocked({ ...w, unlock: { type: "defeat-character", characterId: "irene" } }, [defeat("texas")])).toBe(false);
    expect(isCharacterUnlocked({ ...w, unlock: { type: "defeat-character", characterId: "irene" } }, [defeat("irene")])).toBe(true);
    expect(isCharacterUnlocked({ ...w, unlock: { type: "defeat-tag-percentage", tag: "tier:a", percentage: 50 } }, [defeat("texas"), defeat("irene")])).toBe(true);
    expect(isCharacterUnlocked({ ...w, unlock: { type: "defeat-tag-percentage", tag: "tier:a", percentage: 75 } }, [defeat("texas"), defeat("texas")])).toBe(false);
    expect(isCharacterUnlocked({ ...w, unlock: { type: "defeat-tag-percentage", tag: "tier:a", percentage: 75 } }, [defeat("texas"), defeat("irene"), defeat("platinum")])).toBe(true);
  });

  it("deduplicates defeated attendees and keeps first victory order", () => {
    expect(defeatedCharacterIdsByFirstDefeat([
      defeat("irene", "2026-01-03T00:00:00.000Z"),
      defeat("texas", "2026-01-01T00:00:00.000Z"),
      defeat("texas", "2026-01-02T00:00:00.000Z")
    ])).toEqual(["texas", "irene"]);
    expect(defeatedCharacterIdsByFirstDefeat([
      defeat("texas", "2026-01-01T00:30:00+01:00"),
      defeat("irene", "2025-12-31T23:45:00.000Z")
    ])).toEqual(["texas", "irene"]);
  });

  it("reports only newly satisfied conditions", () => {
    expect(newlyUnlockedCharacterIds([], [defeat("plume")])).toEqual(["w", "irene", "platinum", "lappland-the-decadenza"]);
    expect(newlyUnlockedCharacterIds([defeat("plume")], [defeat("plume"), defeat("lappland-the-decadenza")])).toEqual(["texas", "nian", "ho-olheyak"]);
    expect(newlyUnlockedCharacterIds([defeat("w")], [defeat("w"), defeat("ho-olheyak")])).toEqual(["dorothy"]);
  });
});
