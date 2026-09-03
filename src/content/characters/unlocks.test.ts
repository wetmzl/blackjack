import { describe, expect, it } from "vitest";
import { CHARACTER_CATALOG } from "./catalog";
import { defeatedCharacterIdsByFirstVictory, isCharacterUnlocked, newlyUnlockedCharacterIds, unlockedCharacterIdsForHistory } from "./unlocks";

const victory = (opponentId: string, timestamp = "2026-01-01T00:00:00.000Z") => ({ opponentId, timestamp, winner: "player" as const, escaped: false });

describe("character unlock conditions", () => {
  it("starts with every non-S attendee and gates both S attendees behind an A victory", () => {
    expect(unlockedCharacterIdsForHistory([])).toEqual(["texas", "irene", "plume"]);
    expect(unlockedCharacterIdsForHistory([victory("plume")])).toEqual(["texas", "irene", "plume"]);
    const afterA = unlockedCharacterIdsForHistory([victory("texas")]);
    expect(afterA).toEqual(["w", "texas", "irene", "nian", "plume"]);
  });

  it("supports any, exact, tag, and percentage defeat predicates", () => {
    const w = CHARACTER_CATALOG.find((character) => character.id === "w")!;
    const nian = CHARACTER_CATALOG.find((character) => character.id === "nian")!;
    expect(isCharacterUnlocked({ ...w, unlock: { type: "defeat-any" } }, [])).toBe(false);
    expect(isCharacterUnlocked({ ...w, unlock: { type: "defeat-any" } }, [victory("plume")])).toBe(true);
    expect(isCharacterUnlocked(w, [victory("texas")])).toBe(true);
    expect(isCharacterUnlocked(nian, [victory("texas")])).toBe(true);
    expect(isCharacterUnlocked(w, [])).toBe(false);
    expect(isCharacterUnlocked({ ...w, unlock: { type: "defeat-any-tag", tag: "tier:s" } }, [victory("w")])).toBe(true);
    expect(isCharacterUnlocked({ ...w, unlock: { type: "defeat-character", characterId: "irene" } }, [victory("texas")])).toBe(false);
    expect(isCharacterUnlocked({ ...w, unlock: { type: "defeat-character", characterId: "irene" } }, [victory("irene")])).toBe(true);
    expect(isCharacterUnlocked({ ...w, unlock: { type: "defeat-tag-percentage", tag: "tier:a", percentage: 50 } }, [victory("texas")])).toBe(true);
    expect(isCharacterUnlocked({ ...w, unlock: { type: "defeat-tag-percentage", tag: "tier:a", percentage: 75 } }, [victory("texas"), victory("texas")])).toBe(false);
    expect(isCharacterUnlocked({ ...w, unlock: { type: "defeat-tag-percentage", tag: "tier:a", percentage: 75 } }, [victory("texas"), victory("irene")])).toBe(true);
    expect(isCharacterUnlocked({ ...w, unlock: { type: "defeat-any" } }, [{ ...victory("plume"), winner: "opponent" }])).toBe(false);
    expect(isCharacterUnlocked({ ...w, unlock: { type: "defeat-any" } }, [{ ...victory("plume"), escaped: true }])).toBe(false);
  });

  it("deduplicates defeated attendees and keeps first victory order", () => {
    expect(defeatedCharacterIdsByFirstVictory([
      victory("irene", "2026-01-03T00:00:00.000Z"),
      victory("texas", "2026-01-01T00:00:00.000Z"),
      victory("texas", "2026-01-02T00:00:00.000Z")
    ])).toEqual(["texas", "irene"]);
    expect(defeatedCharacterIdsByFirstVictory([
      victory("texas", "2026-01-01T00:30:00+01:00"),
      victory("irene", "2025-12-31T23:45:00.000Z")
    ])).toEqual(["texas", "irene"]);
  });

  it("reports only newly satisfied conditions", () => {
    expect(newlyUnlockedCharacterIds([], [victory("texas")])).toEqual(["w", "nian"]);
  });
});
