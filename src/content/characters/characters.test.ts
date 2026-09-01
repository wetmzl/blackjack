import { describe, expect, it } from "vitest";
import { CHARACTER_CATALOG, CHARACTER_METADATA_BY_ID, DEFAULT_CHARACTER_ID, getCharacterMetadata, loadCharacter, clearCharacterCache, TABLE_ART_BASELINE } from ".";
import standardSchema from "./character.schema.json";
import wData from "./data/w.json";
import texasData from "./data/texas.json";
import ireneData from "./data/irene.json";
import nianData from "./data/nian.json";
import { CharacterCatalogSchema, CharacterDataSchema, DIALOGUE_EVENT_CODES } from "./schema";

describe("data-driven character registry", () => {
  it("registers W, Texas, Irene, and Nian", () => {
    expect(CHARACTER_CATALOG.map((character) => character.id)).toEqual(["w", "texas", "irene", "nian"]);
    expect(new Set(CHARACTER_CATALOG.map((character) => character.id)).size).toBe(CHARACTER_CATALOG.length);
    expect(CHARACTER_METADATA_BY_ID.texas).toBe(CHARACTER_CATALOG[1]);
    expect(CHARACTER_METADATA_BY_ID.irene).toBe(CHARACTER_CATALOG[2]);
    expect(CHARACTER_METADATA_BY_ID.nian).toBe(CHARACTER_CATALOG[3]);
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
      "/assets/characters/texas-relaxed.png",
      "/assets/characters/irene-relaxed.png",
      "/assets/characters/nian-relaxed.png"
    ]);
    expect(CHARACTER_CATALOG.map((character) => character.trophyImage)).toEqual([
      "/assets/characters/w-trophy-defeated.png",
      "/assets/characters/texas-trophy-defeated.png",
      "/assets/characters/irene-trophy-defeated.png",
      "/assets/characters/nian-trophy-defeated.png"
    ]);
  });

  it("calibrates the shared staff prop to each portrait's temple", async () => {
    clearCharacterCache();
    const wPromise = loadCharacter("w");
    expect(loadCharacter("w")).toBe(wPromise);
    const irenePromise = loadCharacter("irene");
    expect(loadCharacter("irene")).toBe(irenePromise);
    const nianPromise = loadCharacter("nian");
    expect(loadCharacter("nian")).toBe(nianPromise);
    const [w, texas, irene, nian] = await Promise.all([wPromise, loadCharacter("texas"), irenePromise, nianPromise]);
    expect(w.id).toBe("w");
    expect(texas.id).toBe("texas");
    expect(irene.id).toBe("irene");
    expect(nian.id).toBe("nian");
    expect(w.revolverPlacement).toEqual({ top: 152, left: 90, mobileTop: 116, mobileLeft: 88 });
    expect(texas.revolverPlacement).toEqual({ top: 142, left: 128, mobileTop: 109, mobileLeft: 110 });
    expect(irene.revolverPlacement).toEqual({ top: 98, left: 120, mobileTop: 109, mobileLeft: 110 });
    expect(nian.revolverPlacement).toEqual({ top: 134, left: 110, mobileTop: 102, mobileLeft: 104 });
    expect(w.assets.staffRevolver).toBe("/assets/characters/staff-revolver-7mm.png");
    expect(texas.assets.staffRevolver).toBe("/assets/characters/staff-revolver-7mm.png");
    expect(irene.assets).toEqual({
      relaxed: "/assets/characters/irene-relaxed.png",
      conflicted: "/assets/characters/irene-conflicted.png",
      mocking: "/assets/characters/irene-mocking.png",
      threatened: "/assets/characters/irene-threatened.png",
      staffRevolver: "/assets/characters/staff-revolver-7mm.png",
      unconscious: "/assets/characters/irene-unconscious.png",
      defeatedSummary: "/assets/characters/irene-defeated-summary-chair.png"
    });
    expect(nian.assets).toEqual({
      relaxed: "/assets/characters/nian-relaxed.png",
      conflicted: "/assets/characters/nian-conflicted.png",
      mocking: "/assets/characters/nian-mocking.png",
      threatened: "/assets/characters/nian-threatened.png",
      staffRevolver: "/assets/characters/staff-revolver-7mm.png",
      unconscious: "/assets/characters/nian-unconscious-reclined.png",
      defeatedSummary: "/assets/characters/nian-defeated-summary-chair.png"
    });
    expect(w.trophyGallery).toEqual({
      headshot: "/assets/characters/w-trophy-gallery-headshot.png",
      fullBody: "/assets/characters/w-trophy-gallery-full.png",
      closeups: [
        expect.objectContaining({ id: "face-dazed", name: "失焦的脸", x: 50, y: 17, image: "/assets/characters/w-trophy-detail-face-dazed.png" }),
        expect.objectContaining({ id: "chest-costume", name: "束带领口", x: 50, y: 29, image: "/assets/characters/w-trophy-detail-chest-costume.png" }),
        expect.objectContaining({ id: "skirt-costume", name: "黑红裙装", x: 50, y: 43, image: "/assets/characters/w-trophy-detail-skirt.png" }),
        expect.objectContaining({ id: "boots", name: "黑红长靴", x: 50, y: 85, image: "/assets/characters/w-trophy-detail-boots.png" })
      ]
    });
    expect(texas.trophyGallery).toEqual({
      headshot: "/assets/characters/texas-trophy-gallery-headshot.png",
      fullBody: "/assets/characters/texas-trophy-gallery-full.png",
      closeups: [
        expect.objectContaining({ id: "face-dazed", name: "失焦的脸", x: 50, y: 17, image: "/assets/characters/texas-trophy-detail-face-dazed.png" }),
        expect.objectContaining({ id: "boots", name: "制服短靴", x: 46, y: 85, image: "/assets/characters/texas-trophy-detail-boots.png" }),
        expect.objectContaining({ id: "boots-removed", name: "卸下的短靴", x: 58, y: 85, image: "/assets/characters/texas-trophy-detail-boots-removed.png" })
      ]
    });
    expect(irene.trophyGallery).toEqual({
      headshot: "/assets/characters/irene-trophy-gallery-headshot.png",
      fullBody: "/assets/characters/irene-trophy-gallery-full.png",
      closeups: [
        expect.objectContaining({ id: "face-unwilling", name: "未散的不甘", x: 50, y: 17, image: "/assets/characters/irene-trophy-detail-face-unwilling.png" }),
        expect.objectContaining({ id: "hand", name: "松开的手", x: 34, y: 45, image: "/assets/characters/irene-trophy-detail-hand.png" }),
        expect.objectContaining({ id: "stockings", name: "白色丝袜", x: 48, y: 79, image: "/assets/characters/irene-trophy-detail-stockings.png" }),
        expect.objectContaining({ id: "shoes", name: "礼服鞋", x: 52, y: 87, image: "/assets/characters/irene-trophy-detail-shoes.png" })
      ]
    });
    expect(nian.trophyGallery).toEqual({
      headshot: "/assets/characters/nian-trophy-gallery-headshot.png",
      fullBody: "/assets/characters/nian-trophy-gallery-full.png",
      closeups: [
        expect.objectContaining({ id: "hand", name: "松开的手", x: 31, y: 44, image: "/assets/characters/nian-trophy-detail-hand.png" }),
        expect.objectContaining({ id: "tail-root", name: "龙尾根部", x: 65, y: 47, image: "/assets/characters/nian-trophy-detail-tail-root.png" }),
        expect.objectContaining({ id: "feet-overhead", name: "足部·俯视", x: 43, y: 86, image: "/assets/characters/nian-trophy-detail-feet-overhead.png" }),
        expect.objectContaining({ id: "feet-side", name: "足部·侧面", x: 58, y: 86, image: "/assets/characters/nian-trophy-detail-feet-side.png" })
      ]
    });
    expect("trophyDefeated" in w.assets).toBe(false);
    expect("trophyDefeated" in texas.assets).toBe(false);
    expect("trophyDefeated" in irene.assets).toBe(false);
    expect("trophyDefeated" in nian.assets).toBe(false);
    expect("portraitScale" in w).toBe(false);
    expect("portraitScale" in texas).toBe(false);
    expect("portraitScale" in irene).toBe(false);
    expect("portraitScale" in nian).toBe(false);
    expect(w.profile.description.length).toBeGreaterThan(0);
    expect(w.matchSummary.playerVictory.length).toBeGreaterThan(0);
    expect(w.matchSummary.playerDefeat.length).toBeGreaterThan(0);
    expect(w.matchSummary.escaped.length).toBeGreaterThan(0);
    expect(texas.profile.description).toContain("可靠干员");
    expect(irene.profile.description).toContain("熟悉");
    expect(irene.matchSummary.playerVictory.length).toBeGreaterThan(0);
    expect(irene.matchSummary.playerDefeat.length).toBeGreaterThan(0);
    expect(irene.matchSummary.escaped.length).toBeGreaterThan(0);
    expect(nian.profile.description).toContain("烂片");
    expect(nian.profile.description).toContain("解离感");
    expect(nian.matchSummary.playerVictory.length).toBeGreaterThan(0);
    expect(nian.matchSummary.playerDefeat.length).toBeGreaterThan(0);
    expect(nian.matchSummary.escaped.length).toBeGreaterThan(0);
    expect("MATCH_WIN" in w.dialogue).toBe(false);
    expect("MATCH_LOSS" in w.dialogue).toBe(false);
    expect("PLAYER_ESCAPE" in w.dialogue).toBe(false);
    expect(texas.dialogue.SPECIAL_TWENTY_ONE_PUSH).toHaveLength(2);
    expect(w.$schema).toBe("../character.schema.json");
    expect(texas.$schema).toBe("../character.schema.json");
    expect(Object.keys(w.dialogue).sort()).toEqual([...DIALOGUE_EVENT_CODES].sort());
    expect(Object.keys(texas.dialogue).sort()).toEqual([...DIALOGUE_EVENT_CODES].sort());
    expect(Object.keys(irene.dialogue).sort()).toEqual([...DIALOGUE_EVENT_CODES].sort());
    expect(Object.keys(nian.dialogue).sort()).toEqual([...DIALOGUE_EVENT_CODES].sort());
    expect(Object.values(irene.dialogue).every((pool) => pool.length > 0)).toBe(true);
    const ireneMainEvents = DIALOGUE_EVENT_CODES.filter((code) => !code.startsWith("SPECIAL_"));
    expect(ireneMainEvents.every((code) => irene.dialogue[code].length >= 4)).toBe(true);
    const ireneSpecialEvents = DIALOGUE_EVENT_CODES.filter((code) => code.startsWith("SPECIAL_"));
    expect(ireneSpecialEvents.every((code) => irene.dialogue[code].length >= 2)).toBe(true);
    const nianMainEvents = DIALOGUE_EVENT_CODES.filter((code) => !code.startsWith("SPECIAL_"));
    expect(nianMainEvents.every((code) => nian.dialogue[code].length >= 4)).toBe(true);
    const nianSpecialEvents = DIALOGUE_EVENT_CODES.filter((code) => code.startsWith("SPECIAL_"));
    expect(nianSpecialEvents.every((code) => nian.dialogue[code].length >= 2)).toBe(true);
    expect(w.id).toBe(getCharacterMetadata(w.id)?.id);
    expect(texas.id).toBe(getCharacterMetadata(texas.id)?.id);
    expect(irene.id).toBe(getCharacterMetadata(irene.id)?.id);
    expect(nian.id).toBe(getCharacterMetadata(nian.id)?.id);
    expect(await loadCharacter("w")).toBe(w);
    expect(await loadCharacter("irene")).toBe(irene);
    expect(await loadCharacter("nian")).toBe(nian);
  });

  it("keeps the annotated JSON Schema synchronized with every required dialogue pool", () => {
    const dialogueSchema = standardSchema.properties.dialogue;
    expect(new Set(dialogueSchema.required)).toEqual(new Set(DIALOGUE_EVENT_CODES));
    expect(new Set(Object.keys(dialogueSchema.properties))).toEqual(new Set(DIALOGUE_EVENT_CODES));
    expect(standardSchema.$comment).toContain("一次渲染只会选择一个池");
  });

  it("rejects missing and unknown finite-state dialogue pools", () => {
    const missingDialogue = { ...wData.dialogue } as Record<string, readonly string[]>;
    delete missingDialogue.OPPONENT_FIRST_HIT;
    expect(CharacterDataSchema.safeParse({ ...wData, dialogue: missingDialogue }).success).toBe(false);
    expect(CharacterDataSchema.safeParse({ ...wData, dialogue: { ...wData.dialogue, UNKNOWN_STATE: ["不应接受"] } }).success).toBe(false);
    expect(CharacterDataSchema.safeParse(wData).success).toBe(true);
    expect(CharacterDataSchema.safeParse(texasData).success).toBe(true);
    expect(CharacterDataSchema.safeParse(ireneData).success).toBe(true);
    expect(CharacterDataSchema.safeParse(nianData).success).toBe(true);
  });

  it("supports any number of bounded, uniquely identified trophy closeups", () => {
    const gallery = nianData.trophyGallery;
    expect(gallery.closeups).toHaveLength(4);
    expect(CharacterDataSchema.safeParse({ ...nianData, trophyGallery: { ...gallery, closeups: [] } }).success).toBe(true);
    expect(CharacterDataSchema.safeParse({ ...nianData, trophyGallery: { ...gallery, closeups: [...gallery.closeups, gallery.closeups[0]] } }).success).toBe(false);
    expect(CharacterDataSchema.safeParse({ ...nianData, trophyGallery: { ...gallery, closeups: [{ ...gallery.closeups[0], x: 101 }] } }).success).toBe(false);
  });

  it("rejects unknown characters", async () => {
    expect(getCharacterMetadata("unknown")).toBeUndefined();
    await expect(loadCharacter("unknown")).rejects.toThrow("未知角色");
  });

  it("rejects duplicate ids, shared data files, and an unregistered default", () => {
    const base = { id: "w", name: "W", subtitle: "样例", tier: "B", previewImage: "/w.png", trophyImage: "/w-trophy.png", dataFile: "w.json" } as const;
    expect(CharacterCatalogSchema.safeParse({ defaultCharacterId: "w", characters: [base, { ...base }] }).success).toBe(false);
    expect(CharacterCatalogSchema.safeParse({ defaultCharacterId: "w", characters: [base, { ...base, id: "texas" }] }).success).toBe(false);
    expect(CharacterCatalogSchema.safeParse({ defaultCharacterId: "missing", characters: [base] }).success).toBe(false);
  });
});
