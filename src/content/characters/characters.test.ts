import { describe, expect, it } from "vitest";
import { CHARACTER_CATALOG, CHARACTER_METADATA_BY_ID, DEFAULT_CHARACTER_ID, getCharacterMetadata, getCharacterTags, loadCharacter, clearCharacterCache, TABLE_ART_BASELINE } from ".";
import standardSchema from "./character.schema.json";
import wData from "./data/w.json";
import texasData from "./data/texas.json";
import ireneData from "./data/irene.json";
import nianData from "./data/nian.json";
import plumeData from "./data/plume.json";
import { CharacterCatalogSchema, CharacterDataSchema, DIALOGUE_EVENT_CODES } from "./schema";
import { getAbilityDefinition } from "../../core/abilities/registry";

describe("data-driven character registry", () => {
  it("registers W, Texas, Irene, Nian, and Plume", () => {
    expect(CHARACTER_CATALOG.map((character) => character.id)).toEqual(["w", "texas", "irene", "nian", "plume"]);
    expect(new Set(CHARACTER_CATALOG.map((character) => character.id)).size).toBe(CHARACTER_CATALOG.length);
    expect(CHARACTER_METADATA_BY_ID.texas).toBe(CHARACTER_CATALOG[1]);
    expect(CHARACTER_METADATA_BY_ID.irene).toBe(CHARACTER_CATALOG[2]);
    expect(CHARACTER_METADATA_BY_ID.nian).toBe(CHARACTER_CATALOG[3]);
    expect(CHARACTER_METADATA_BY_ID.plume).toBe(CHARACTER_CATALOG[4]);
    expect(getCharacterMetadata(DEFAULT_CHARACTER_ID)?.id).toBe("texas");
    expect(getCharacterTags(CHARACTER_METADATA_BY_ID.w)).toEqual(expect.arrayContaining(["tier:s", "explosive", "chaotic"]));
    expect(Object.isFrozen(CHARACTER_METADATA_BY_ID.w.tags)).toBe(true);
    expect(Object.isFrozen(CHARACTER_METADATA_BY_ID.w.unlock)).toBe(true);
    expect(Object.isFrozen(CHARACTER_METADATA_BY_ID.w.portraitScales)).toBe(true);
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
      "/assets/characters/nian-relaxed.png",
      "/assets/characters/plume-relaxed.png"
    ]);
    expect(CHARACTER_CATALOG.map((character) => character.trophyImage)).toEqual([
      "/assets/characters/w-trophy-defeated.png",
      "/assets/characters/texas-trophy-defeated.png",
      "/assets/characters/irene-trophy-defeated.png",
      "/assets/characters/nian-trophy-defeated.png",
      "/assets/characters/plume-trophy-defeated.png"
    ]);
    expect(CHARACTER_CATALOG.map((character) => character.portraitScales)).toEqual([
      { selection: 1, table: 1 },
      { selection: 1, table: 1 },
      { selection: 1, table: 1 },
      { selection: 1, table: 1 },
      { selection: 1.3, table: 1.3 }
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
    const plumePromise = loadCharacter("plume");
    expect(loadCharacter("plume")).toBe(plumePromise);
    const [w, texas, irene, nian, plume] = await Promise.all([wPromise, loadCharacter("texas"), irenePromise, nianPromise, plumePromise]);
    expect(w.id).toBe("w");
    expect(texas.id).toBe("texas");
    expect(irene.id).toBe("irene");
    expect(nian.id).toBe("nian");
    expect(plume.id).toBe("plume");
    expect(w.revolverPlacement).toEqual({ top: 152, left: 90, mobileTop: 116, mobileLeft: 88 });
    expect(texas.revolverPlacement).toEqual({ top: 142, left: 128, mobileTop: 109, mobileLeft: 110 });
    expect(irene.revolverPlacement).toEqual({ top: 98, left: 120, mobileTop: 109, mobileLeft: 110 });
    expect(nian.revolverPlacement).toEqual({ top: 134, left: 110, mobileTop: 102, mobileLeft: 104 });
    expect(plume.revolverPlacement).toEqual({ top: 152, left: 118, mobileTop: 116, mobileLeft: 116 });
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
    expect(plume.assets).toEqual({
      relaxed: "/assets/characters/plume-relaxed.png",
      conflicted: "/assets/characters/plume-conflicted.png",
      mocking: "/assets/characters/plume-mocking.png",
      threatened: "/assets/characters/plume-threatened.png",
      staffRevolver: "/assets/characters/staff-revolver-7mm.png",
      unconscious: "/assets/characters/plume-unconscious-reclined.png",
      defeatedSummary: "/assets/characters/plume-defeated-summary-chair.png"
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
    expect(plume.trophyGallery).toEqual({
      headshot: "/assets/characters/plume-trophy-gallery-headshot.png",
      fullBody: "/assets/characters/plume-trophy-gallery-full.png",
      closeups: [
        expect.objectContaining({ id: "face", name: "凝住的警觉", x: 50, y: 16, image: "/assets/characters/plume-trophy-detail-face.png" }),
        expect.objectContaining({ id: "skirt", name: "层叠裙摆", x: 50, y: 46, image: "/assets/characters/plume-trophy-detail-skirt.png" }),
        expect.objectContaining({ id: "stockings", name: "透肉黑色丝袜", x: 50, y: 69, image: "/assets/characters/plume-trophy-detail-stockings.png" }),
        expect.objectContaining({ id: "boots", name: "平置短靴", x: 50, y: 88, image: "/assets/characters/plume-trophy-detail-boots.png" })
      ]
    });
    expect("trophyDefeated" in w.assets).toBe(false);
    expect("trophyDefeated" in texas.assets).toBe(false);
    expect("trophyDefeated" in irene.assets).toBe(false);
    expect("trophyDefeated" in nian.assets).toBe(false);
    expect("trophyDefeated" in plume.assets).toBe(false);
    expect("portraitScale" in w).toBe(false);
    expect("portraitScale" in texas).toBe(false);
    expect("portraitScale" in irene).toBe(false);
    expect("portraitScale" in nian).toBe(false);
    expect("portraitScale" in plume).toBe(false);
    expect([w, texas, irene, nian, plume].every((character) => !("tablePortraitScale" in character))).toBe(true);
    expect([w, texas, irene, nian, plume].map((character) => character.portraitScales.table)).toEqual([1, 1, 1, 1, 1.3]);
    expect(w.profile.description.length).toBeGreaterThan(0);
    expect(w.matchSummary.playerVictory.length).toBeGreaterThan(0);
    expect(w.matchSummary.playerDefeat.length).toBeGreaterThan(0);
    expect(w.matchSummary.escaped.length).toBeGreaterThan(0);
    expect(texas.profile.description.length).toBeGreaterThan(0);
    expect(irene.profile.description.length).toBeGreaterThan(0);
    expect(irene.matchSummary.playerVictory.length).toBeGreaterThan(0);
    expect(irene.matchSummary.playerDefeat.length).toBeGreaterThan(0);
    expect(irene.matchSummary.escaped.length).toBeGreaterThan(0);
    expect(nian.profile.description.length).toBeGreaterThan(0);
    expect(nian.matchSummary.playerVictory.length).toBeGreaterThan(0);
    expect(nian.matchSummary.playerDefeat.length).toBeGreaterThan(0);
    expect(nian.matchSummary.escaped.length).toBeGreaterThan(0);
    expect(plume.profile.description.length).toBeGreaterThan(0);
    expect(plume.matchSummary.playerVictory.length).toBeGreaterThan(0);
    expect(plume.matchSummary.playerDefeat.length).toBeGreaterThan(0);
    expect(plume.matchSummary.escaped.length).toBeGreaterThan(0);
    expect([w.ai, texas.ai, irene.ai, nian.ai, plume.ai].every((ai) => Number.isFinite(ai.P) && Number.isFinite(ai.A) && Number.isFinite(ai.B) && Number.isFinite(ai.C))).toBe(true);
    expect(plume.ai).toEqual({ P: 0, A: 1, B: 1, C: 1 });
    expect(getCharacterMetadata("plume")?.tier).toBe("B");
    expect(getCharacterMetadata("w")?.tier).toBe("S");
    expect(w.mechanics).toEqual([
      { definitionId: "bomb-maniac", enabled: true, parameters: {} },
      { definitionId: "w-night-queen", enabled: true, parameters: {} }
    ]);
    expect(irene.mechanics).toEqual([{ definitionId: "sword-and-handcannon", enabled: true, parameters: {} }]);
    expect(nian.mechanics).toEqual([
      { definitionId: "forge-heralds-the-year", enabled: true, parameters: {} },
      { definitionId: "copper-seal", enabled: true, parameters: {} }
    ]);
    expect(texas.mechanics).toEqual([{ definitionId: "silent-drizzle", enabled: true, parameters: {} }]);
    expect(plume.mechanics).toEqual([]);
    const formalMechanics = [...w.mechanics, ...texas.mechanics, ...irene.mechanics, ...nian.mechanics, ...plume.mechanics]
      .filter((binding) => binding.enabled)
      .map((binding) => getAbilityDefinition(binding.definitionId));
    expect(formalMechanics).toHaveLength(6);
    expect(formalMechanics.every((ability) => Boolean(ability?.profileLore?.trim()))).toBe(true);
    expect("MATCH_WIN" in w.dialogue).toBe(false);
    expect("MATCH_LOSS" in w.dialogue).toBe(false);
    expect("PLAYER_ESCAPE" in w.dialogue).toBe(false);
    expect(texas.dialogue.SPECIAL_TWENTY_ONE_PUSH.length).toBeGreaterThan(0);
    expect(w.$schema).toBe("../character.schema.json");
    expect(texas.$schema).toBe("../character.schema.json");
    expect(Object.keys(w.dialogue).sort()).toEqual([...DIALOGUE_EVENT_CODES].sort());
    expect(Object.keys(texas.dialogue).sort()).toEqual([...DIALOGUE_EVENT_CODES].sort());
    expect(Object.keys(irene.dialogue).sort()).toEqual([...DIALOGUE_EVENT_CODES].sort());
    expect(Object.keys(nian.dialogue).sort()).toEqual([...DIALOGUE_EVENT_CODES].sort());
    expect(Object.keys(plume.dialogue).sort()).toEqual([...DIALOGUE_EVENT_CODES].sort());
    expect(Object.values(irene.dialogue).every((pool) => pool.length > 0)).toBe(true);
    expect(Object.values(plume.dialogue).every((pool) => pool.length > 0 && pool.every((line) => !line.includes("台词占位")))).toBe(true);
    expect(w.id).toBe(getCharacterMetadata(w.id)?.id);
    expect(texas.id).toBe(getCharacterMetadata(texas.id)?.id);
    expect(irene.id).toBe(getCharacterMetadata(irene.id)?.id);
    expect(nian.id).toBe(getCharacterMetadata(nian.id)?.id);
    expect(plume.id).toBe(getCharacterMetadata(plume.id)?.id);
    expect(await loadCharacter("w")).toBe(w);
    expect(await loadCharacter("irene")).toBe(irene);
    expect(await loadCharacter("nian")).toBe(nian);
    expect(await loadCharacter("plume")).toBe(plume);
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
    expect(CharacterDataSchema.safeParse(plumeData).success).toBe(true);
  });

  it("requires finite P/A/B/C AI threshold parameters", () => {
    const { C: _removed, ...missingC } = wData.ai;
    expect(CharacterDataSchema.safeParse({ ...wData, ai: missingC }).success).toBe(false);
    expect(CharacterDataSchema.safeParse({ ...wData, ai: { ...wData.ai, P: Number.POSITIVE_INFINITY } }).success).toBe(false);
    expect(CharacterDataSchema.safeParse({ ...wData, ai: { ...wData.ai, unknown: 1 } }).success).toBe(false);
  });

  it("defaults portrait scales by surface and validates lightweight presentation overrides", () => {
    const base = { id: "sample", name: "样例", subtitle: "样例", tier: "B", previewImage: "/sample.png", trophyImage: "/sample-trophy.png", dataFile: "sample.json" } as const;
    const parse = (character: object) => CharacterCatalogSchema.parse({ defaultCharacterId: "sample", characters: [character] }).characters[0].portraitScales;
    expect(parse(base)).toEqual({ selection: 1, table: 1 });
    expect(parse({ ...base, portraitScales: { selection: 1.3 } })).toEqual({ selection: 1.3, table: 1 });
    expect(CharacterCatalogSchema.safeParse({ defaultCharacterId: "sample", characters: [{ ...base, portraitScales: { selection: 0.74 } }] }).success).toBe(false);
    expect(CharacterCatalogSchema.safeParse({ defaultCharacterId: "sample", characters: [{ ...base, portraitScales: { selection: 1, table: 1.51 } }] }).success).toBe(false);
    expect(CharacterCatalogSchema.safeParse({ defaultCharacterId: "sample", characters: [{ ...base, portraitScales: { selection: 1, unknown: 1 } }] }).success).toBe(false);
    expect(CharacterDataSchema.safeParse({ ...plumeData, tablePortraitScale: 1.3 }).success).toBe(false);
  });

  it("strictly validates declarative mechanic bindings", () => {
    expect(CharacterDataSchema.safeParse({ ...wData, mechanics: [{ definitionId: "owner-load-penalty", enabled: true, parameters: {} }] }).success).toBe(true);
    expect(CharacterDataSchema.safeParse({ ...wData, mechanics: [{ definitionId: "action-advice-mechanic", enabled: true, parameters: { minimumHandSize: 2 } }] }).success).toBe(true);
    expect(CharacterDataSchema.safeParse({ ...wData, mechanics: [{ definitionId: "unknown-mechanic", enabled: true, parameters: {} }] }).success).toBe(false);
    expect(CharacterDataSchema.safeParse({ ...wData, mechanics: [{ definitionId: "switcheroo", enabled: true, parameters: {} }] }).success).toBe(false);
    expect(CharacterDataSchema.safeParse({ ...wData, mechanics: [{ definitionId: "action-advice-mechanic", enabled: true, parameters: {} }] }).success).toBe(false);
    expect(CharacterDataSchema.safeParse({ ...wData, mechanics: [{ definitionId: "action-advice-mechanic", enabled: true, parameters: { minimumHandSize: 11 } }] }).success).toBe(false);
    expect(CharacterDataSchema.safeParse({ ...wData, mechanics: [{ definitionId: "owner-load-penalty", enabled: true, parameters: { unknown: true } }] }).success).toBe(false);
    expect(CharacterDataSchema.safeParse({ ...wData, mechanics: [{ definitionId: "owner-load-penalty", enabled: true, parameters: {}, extra: true }] }).success).toBe(false);
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

  it("strictly validates character tags and unlock references", () => {
    const base = { id: "base", name: "基础角色", subtitle: "样例", tier: "A", tags: ["group-a"], previewImage: "/base.png", trophyImage: "/base-trophy.png", dataFile: "base.json" } as const;
    const locked = { id: "locked", name: "待解锁角色", subtitle: "样例", tier: "S", tags: ["group-s"], previewImage: "/locked.png", trophyImage: "/locked-trophy.png", dataFile: "locked.json" } as const;
    const parse = (unlock: object) => CharacterCatalogSchema.safeParse({ defaultCharacterId: "base", characters: [base, { ...locked, unlock }] }).success;
    expect(parse({ type: "defeat-any" })).toBe(true);
    expect(parse({ type: "defeat-any-tag", tag: "tier:a" })).toBe(true);
    expect(parse({ type: "defeat-character", characterId: "base" })).toBe(true);
    expect(parse({ type: "defeat-tag-percentage", tag: "group-a", percentage: 50 })).toBe(true);
    expect(parse({ type: "defeat-any-tag", tag: "missing" })).toBe(false);
    expect(parse({ type: "defeat-character", characterId: "missing" })).toBe(false);
    expect(parse({ type: "defeat-tag-percentage", tag: "group-a", percentage: 0 })).toBe(false);
    expect(CharacterCatalogSchema.safeParse({ defaultCharacterId: "base", characters: [{ ...base, tags: ["group-a", "group-a"] }] }).success).toBe(false);
    expect(CharacterCatalogSchema.safeParse({ defaultCharacterId: "base", characters: [{ ...base, tags: ["tier:s"] }] }).success).toBe(false);
    expect(CharacterCatalogSchema.safeParse({ defaultCharacterId: "locked", characters: [base, { ...locked, unlock: { type: "defeat-any" } }] }).success).toBe(false);
  });
});
