import { describe, expect, it } from "vitest";
import { CHARACTER_CATALOG, CHARACTER_METADATA_BY_ID, DEFAULT_CHARACTER_ID, getCharacterMetadata, loadCharacter, clearCharacterCache, TABLE_ART_BASELINE } from ".";
import { CharacterCatalogSchema } from "./schema";

describe("data-driven character registry", () => {
  it("registers W and the calmer Texas profile", () => {
    expect(CHARACTER_CATALOG.map((character) => character.id)).toEqual(["w", "texas"]);
    expect(new Set(CHARACTER_CATALOG.map((character) => character.id)).size).toBe(CHARACTER_CATALOG.length);
    expect(CHARACTER_METADATA_BY_ID.texas).toBe(CHARACTER_CATALOG[1]);
    expect(getCharacterMetadata(DEFAULT_CHARACTER_ID)?.id).toBe("w");
    expect(TABLE_ART_BASELINE.referenceCharacterId).toBe("w");
    expect(TABLE_ART_BASELINE.referenceCanvas).toEqual({ width: 1536, height: 1024 });
    expect(TABLE_ART_BASELINE.normalSittingScale).toBe(1);
    expect(TABLE_ART_BASELINE.composition).toBe("horizontal-seated");
  });

  it("gives every character dedicated table, summary, and trophy artwork", () => {
    expect(CHARACTER_CATALOG.every((character) => !("ai" in character))).toBe(true);
    expect(CHARACTER_CATALOG.map((character) => character.previewImage)).toEqual([
      "/assets/characters/w-relaxed.png",
      "/assets/characters/texas-relaxed.png"
    ]);
  });

  it("calibrates the shared staff prop to each portrait's temple", async () => {
    clearCharacterCache();
    const wPromise = loadCharacter("w");
    expect(loadCharacter("w")).toBe(wPromise);
    const [w, texas] = await Promise.all([wPromise, loadCharacter("texas")]);
    expect(w.id).toBe("w");
    expect(texas.id).toBe("texas");
    expect(w.revolverPlacement).toEqual({ top: 152, left: 90, mobileTop: 116, mobileLeft: 88 });
    expect(texas.revolverPlacement).toEqual({ top: 142, left: 128, mobileTop: 109, mobileLeft: 110 });
    expect(w.assets.staffRevolver).toBe("/assets/characters/staff-revolver-7mm.png");
    expect(texas.assets.staffRevolver).toBe("/assets/characters/staff-revolver-7mm.png");
    expect("trophyDefeated" in w.assets).toBe(false);
    expect("trophyDefeated" in texas.assets).toBe(false);
    expect("portraitScale" in w).toBe(false);
    expect("portraitScale" in texas).toBe(false);
    expect(w.id).toBe(getCharacterMetadata(w.id)?.id);
    expect(texas.id).toBe(getCharacterMetadata(texas.id)?.id);
    expect(await loadCharacter("w")).toBe(w);
  });

  it("rejects unknown characters", async () => {
    expect(getCharacterMetadata("unknown")).toBeUndefined();
    await expect(loadCharacter("unknown")).rejects.toThrow("未知角色");
  });

  it("rejects duplicate ids, shared data files, and an unregistered default", () => {
    const base = { id: "w", name: "W", subtitle: "样例", tier: "B", description: "样例", previewImage: "/w.png", trophyImage: "/w-trophy.png", dataFile: "w.json" } as const;
    expect(CharacterCatalogSchema.safeParse({ defaultCharacterId: "w", characters: [base, { ...base }] }).success).toBe(false);
    expect(CharacterCatalogSchema.safeParse({ defaultCharacterId: "w", characters: [base, { ...base, id: "texas" }] }).success).toBe(false);
    expect(CharacterCatalogSchema.safeParse({ defaultCharacterId: "missing", characters: [base] }).success).toBe(false);
  });
});
