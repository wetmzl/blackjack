import { describe, expect, it } from "vitest";
import { CHARACTER_CATALOG, CHARACTER_METADATA_BY_ID, DEFAULT_CHARACTER_ID, getCharacterMetadata, getCharacterTags, loadCharacter, clearCharacterCache, TABLE_ART_BASELINE } from ".";
import standardSchema from "./character.schema.json";
import wData from "./data/w.json";
import texasData from "./data/texas.json";
import ireneData from "./data/irene.json";
import cimeiData from "./data/cimei.json";
import nianData from "./data/nian.json";
import plumeData from "./data/plume.json";
import platinumData from "./data/platinum.json";
import lapplandData from "./data/lappland-the-decadenza.json";
import hoOlheyakData from "./data/ho-olheyak.json";
import dorothyData from "./data/dorothy.json";
import typhonData from "./data/typhon.json";
import { CharacterCatalogSchema, CharacterDataSchema, DIALOGUE_EVENT_CODES } from "./schema";
import { getAbilityDefinition } from "../../core/abilities/registry";

describe("data-driven character registry", () => {
  it("registers every attendee in the lightweight catalog", () => {
    expect(CHARACTER_CATALOG.map((character) => character.id)).toEqual(["w", "texas", "irene", "cimei", "nian", "plume", "platinum", "lappland-the-decadenza", "ho-olheyak", "dorothy", "typhon"]);
    expect(new Set(CHARACTER_CATALOG.map((character) => character.id)).size).toBe(CHARACTER_CATALOG.length);
    expect(CHARACTER_METADATA_BY_ID.texas).toBe(CHARACTER_CATALOG[1]);
    expect(CHARACTER_METADATA_BY_ID.irene).toBe(CHARACTER_CATALOG[2]);
    expect(CHARACTER_METADATA_BY_ID.cimei).toBe(CHARACTER_CATALOG[3]);
    expect(CHARACTER_METADATA_BY_ID.nian).toBe(CHARACTER_CATALOG[4]);
    expect(CHARACTER_METADATA_BY_ID.plume).toBe(CHARACTER_CATALOG[5]);
    expect(CHARACTER_METADATA_BY_ID.platinum).toBe(CHARACTER_CATALOG[6]);
    expect(CHARACTER_METADATA_BY_ID["lappland-the-decadenza"]).toBe(CHARACTER_CATALOG[7]);
    expect(CHARACTER_METADATA_BY_ID["ho-olheyak"]).toBe(CHARACTER_CATALOG[8]);
    expect(CHARACTER_METADATA_BY_ID.dorothy).toBe(CHARACTER_CATALOG[9]);
    expect(CHARACTER_METADATA_BY_ID.typhon).toBe(CHARACTER_CATALOG[10]);
    expect(getCharacterMetadata(DEFAULT_CHARACTER_ID)?.id).toBe("plume");
    expect(getCharacterTags(CHARACTER_METADATA_BY_ID.w)).toEqual(expect.arrayContaining(["tier:s", "explosive", "chaotic"]));
    expect(Object.isFrozen(CHARACTER_METADATA_BY_ID.w.tags)).toBe(true);
    expect(Object.isFrozen(CHARACTER_METADATA_BY_ID.w.unlock)).toBe(true);
    expect(Object.isFrozen(CHARACTER_METADATA_BY_ID.w.portraitScales)).toBe(true);
    expect(TABLE_ART_BASELINE.referenceCharacterId).toBe("w");
    expect(TABLE_ART_BASELINE.referenceCanvas).toEqual({ width: 1536, height: 1024 });
    expect(TABLE_ART_BASELINE.normalSittingScale).toBe(1);
    expect(TABLE_ART_BASELINE.composition).toBe("horizontal-seated");
  });

  it("reserves SS as a catalog tier and exposes its unlock tag", () => {
    const catalog = CharacterCatalogSchema.parse({
      defaultCharacterId: "future",
      characters: [{ id: "future", name: "未来角色", subtitle: "尚未实装", tier: "SS", tags: [], previewImage: "/future.png", trophyImage: "/future-trophy.png", dataFile: "future.json" }]
    });
    expect(catalog.characters[0]?.tier).toBe("SS");
    expect(getCharacterTags(catalog.characters[0]!)).toContain("tier:ss");
  });

  it("registers Typhon from the supplied copy with no skills yet", async () => {
    const metadata = getCharacterMetadata("typhon");
    expect(metadata).toEqual(expect.objectContaining({
      name: "提丰",
      subtitle: "她追踪了九年的猎物不在这个赌桌上——但这条线索值得她追到这里。",
      tier: "A",
      unlock: { type: "defeat-count", count: 5 }
    }));
    expect(typhonData.aiSkills).toEqual([]);
    expect(typhonData.profile.description).toBe("萨米猎人，萨卡兹族，感染者，身形娇小，却背着一张比自己还高的黑弓。你问她知不知道这里的规则——她说知道，然后就坐下了。她冷淡、直接、说话带有明显的口音，但你能隐隐约约感受到她作为猎人的气息，而今天她的猎物就是你。");
    expect(Object.keys(typhonData.dialogue).sort()).toEqual([...DIALOGUE_EVENT_CODES].sort());
    expect(Object.values(typhonData.dialogue).flat().every((line) => !line.startsWith("“") && !line.endsWith("”"))).toBe(true);
    expect(typhonData.dialogue.OPPONENT_FIRST_HIT).toEqual(["再来一张。"]);
    expect(typhonData.dialogue.OPPONENT_FIRST_STAND).toEqual(["就这样。"]);
    expect(await loadCharacter("typhon")).toEqual(expect.objectContaining({ id: "typhon", ...typhonData }));
  });

  it("gives every character dedicated table, summary, and trophy artwork", () => {
    expect(CHARACTER_CATALOG.every((character) => !("ai" in character))).toBe(true);
    expect(CHARACTER_CATALOG.map((character) => character.previewImage)).toEqual([
      "/assets/characters/w-relaxed.png",
      "/assets/characters/texas-relaxed.png",
      "/assets/characters/irene-relaxed.png",
      "/assets/characters/cimei-relaxed.png",
      "/assets/characters/nian-relaxed.png",
      "/assets/characters/plume-relaxed.png",
      "/assets/characters/platinum-relaxed.png",
      "/assets/characters/lappland-the-decadenza-relaxed.png",
      "/assets/characters/ho-olheyak-relaxed.png",
      "/assets/characters/dorothy-relaxed.png",
      "/assets/characters/typhon-relaxed.png"
    ]);
    expect(CHARACTER_CATALOG.map((character) => character.trophyImage)).toEqual([
      "/assets/characters/w-trophy-defeated.png",
      "/assets/characters/texas-trophy-defeated.png",
      "/assets/characters/irene-trophy-defeated.png",
      "/assets/characters/cimei-trophy-defeated.png",
      "/assets/characters/nian-trophy-defeated.png",
      "/assets/characters/plume-trophy-defeated.png",
      "/assets/characters/platinum-trophy-defeated.png",
      "/assets/characters/lappland-the-decadenza-trophy-defeated.png",
      "/assets/characters/ho-olheyak-trophy-defeated.png",
      "/assets/characters/dorothy-trophy-defeated.png",
      "/assets/characters/typhon-trophy-defeated.png"
    ]);
    expect(CHARACTER_CATALOG.map((character) => character.portraitScales)).toEqual([
      { selection: 1, table: 1 },
      { selection: 1, table: 1 },
      { selection: 1, table: 1 },
      { selection: 1, table: 1 },
      { selection: 1, table: 1 },
      { selection: 1.3, table: 1.3 },
      { selection: 1, table: 1 },
      { selection: 1, table: 1 },
      { selection: 1, table: 1 },
      { selection: 1, table: 1 },
      { selection: 1, table: 1 }
    ]);
  });

  it("calibrates the shared staff prop to each portrait's temple", async () => {
    clearCharacterCache();
    const wPromise = loadCharacter("w");
    expect(loadCharacter("w")).toBe(wPromise);
    const irenePromise = loadCharacter("irene");
    expect(loadCharacter("irene")).toBe(irenePromise);
    const cimeiPromise = loadCharacter("cimei");
    expect(loadCharacter("cimei")).toBe(cimeiPromise);
    const nianPromise = loadCharacter("nian");
    expect(loadCharacter("nian")).toBe(nianPromise);
    const plumePromise = loadCharacter("plume");
    expect(loadCharacter("plume")).toBe(plumePromise);
    const platinumPromise = loadCharacter("platinum");
    expect(loadCharacter("platinum")).toBe(platinumPromise);
    const lapplandPromise = loadCharacter("lappland-the-decadenza");
    expect(loadCharacter("lappland-the-decadenza")).toBe(lapplandPromise);
    const [w, texas, irene, cimei, nian, plume, platinum, lappland] = await Promise.all([wPromise, loadCharacter("texas"), irenePromise, cimeiPromise, nianPromise, plumePromise, platinumPromise, lapplandPromise]);
    expect(w.id).toBe("w");
    expect(texas.id).toBe("texas");
    expect(irene.id).toBe("irene");
    expect(cimei.id).toBe("cimei");
    expect(nian.id).toBe("nian");
    expect(plume.id).toBe("plume");
    expect(platinum.id).toBe("platinum");
    expect(lappland.id).toBe("lappland-the-decadenza");
    expect(w.revolverPlacement).toEqual({ top: 152, left: 90, mobileTop: 116, mobileLeft: 88 });
    expect(texas.revolverPlacement).toEqual({ top: 142, left: 128, mobileTop: 109, mobileLeft: 110 });
    expect(irene.revolverPlacement).toEqual({ top: 98, left: 120, mobileTop: 109, mobileLeft: 110 });
    expect(cimei.revolverPlacement).toEqual({ top: 116, left: 116, mobileTop: 104, mobileLeft: 108 });
    expect(nian.revolverPlacement).toEqual({ top: 134, left: 110, mobileTop: 102, mobileLeft: 104 });
    expect(plume.revolverPlacement).toEqual({ top: 152, left: 118, mobileTop: 116, mobileLeft: 116 });
    expect(platinum.revolverPlacement).toEqual({ top: 140, left: 124, mobileTop: 110, mobileLeft: 112 });
    expect(lappland.revolverPlacement).toEqual({ top: 140, left: 124, mobileTop: 110, mobileLeft: 112 });
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
    expect(cimei.assets).toEqual({
      relaxed: "/assets/characters/cimei-relaxed.png",
      conflicted: "/assets/characters/cimei-conflicted.png",
      mocking: "/assets/characters/cimei-mocking.png",
      threatened: "/assets/characters/cimei-threatened.png",
      staffRevolver: "/assets/characters/staff-revolver-7mm.png",
      unconscious: "/assets/characters/cimei-unconscious-reclined.png",
      defeatedSummary: "/assets/characters/cimei-defeated-summary-chair.png"
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
    expect(platinum.assets).toEqual({
      relaxed: "/assets/characters/platinum-relaxed.png",
      conflicted: "/assets/characters/platinum-conflicted.png",
      mocking: "/assets/characters/platinum-mocking.png",
      threatened: "/assets/characters/platinum-threatened.png",
      staffRevolver: "/assets/characters/staff-revolver-7mm.png",
      unconscious: "/assets/characters/platinum-unconscious-reclined.png",
      defeatedSummary: "/assets/characters/platinum-defeated-summary-chair.png"
    });
    expect(lappland.assets).toEqual({
      relaxed: "/assets/characters/lappland-the-decadenza-relaxed.png",
      conflicted: "/assets/characters/lappland-the-decadenza-conflicted.png",
      mocking: "/assets/characters/lappland-the-decadenza-mocking.png",
      threatened: "/assets/characters/lappland-the-decadenza-threatened.png",
      staffRevolver: "/assets/characters/staff-revolver-7mm.png",
      unconscious: "/assets/characters/lappland-the-decadenza-unconscious-reclined.png",
      defeatedSummary: "/assets/characters/lappland-the-decadenza-defeated-summary-chair.png"
    });
    expect(w.trophyGallery).toEqual({
      headshot: "/assets/characters/w-trophy-gallery-headshot.png",
      fullBody: "/assets/characters/w-trophy-gallery-full-subject.png",
      poses: [
        { id: "left", name: "左侧", image: "/assets/characters/w-trophy-gallery-left-subject.png" },
        { id: "prone", name: "俯卧", image: "/assets/characters/w-trophy-gallery-prone-subject.png" },
        { id: "right", name: "右侧", image: "/assets/characters/w-trophy-gallery-right-subject.png" }
      ],
      closeups: [
        expect.objectContaining({ id: "face-dazed", name: "失焦的脸", x: 50, y: 17, image: "/assets/characters/w-trophy-detail-face-dazed.png" }),
        expect.objectContaining({ id: "chest-costume", name: "束带领口", x: 50, y: 29, image: "/assets/characters/w-trophy-detail-chest-costume.png" }),
        expect.objectContaining({ id: "skirt-costume", name: "黑红裙装", x: 50, y: 43, image: "/assets/characters/w-trophy-detail-skirt.png" }),
        expect.objectContaining({ id: "boots", name: "黑红长靴", x: 50, y: 85, image: "/assets/characters/w-trophy-detail-boots.png" })
      ]
    });
    expect(texas.trophyGallery).toEqual({
      headshot: "/assets/characters/texas-trophy-gallery-headshot.png",
      fullBody: "/assets/characters/texas-trophy-gallery-full-subject.png",
      poses: [
        { id: "left", name: "左侧", image: "/assets/characters/texas-trophy-gallery-left-subject.png" },
        { id: "prone", name: "俯卧", image: "/assets/characters/texas-trophy-gallery-prone-subject.png" },
        { id: "right", name: "右侧", image: "/assets/characters/texas-trophy-gallery-right-subject.png" }
      ],
      closeups: [
        expect.objectContaining({ id: "face-dazed", name: "失焦的脸", x: 50, y: 17, image: "/assets/characters/texas-trophy-detail-face-dazed.png" }),
        expect.objectContaining({
          id: "boots",
          name: "制服短靴",
          x: 52,
          y: 85,
          image: "/assets/characters/texas-trophy-detail-boots.png",
          variants: [expect.objectContaining({ image: "/assets/characters/texas-trophy-detail-boots-removed.png" })]
        })
      ]
    });
    expect(irene.trophyGallery).toEqual({
      headshot: "/assets/characters/irene-trophy-gallery-headshot.png",
      fullBody: "/assets/characters/irene-trophy-gallery-full-subject.png",
      poses: [
        { id: "left", name: "左侧", image: "/assets/characters/irene-trophy-gallery-left-subject.png" },
        { id: "prone", name: "俯卧", image: "/assets/characters/irene-trophy-gallery-prone-subject.png" },
        { id: "right", name: "右侧", image: "/assets/characters/irene-trophy-gallery-right-subject.png" }
      ],
      closeups: [
        expect.objectContaining({ id: "face-unwilling", name: "未散的不甘", x: 50, y: 17, image: "/assets/characters/irene-trophy-detail-face-unwilling.png" }),
        expect.objectContaining({ id: "hand", name: "松开的手", x: 34, y: 45, image: "/assets/characters/irene-trophy-detail-hand.png" }),
        expect.objectContaining({ id: "stockings", name: "白色丝袜", x: 48, y: 79, image: "/assets/characters/irene-trophy-detail-stockings.png" }),
        expect.objectContaining({ id: "shoes", name: "礼服鞋", x: 52, y: 87, image: "/assets/characters/irene-trophy-detail-shoes.png" })
      ]
    });
    expect(nian.trophyGallery).toEqual({
      headshot: "/assets/characters/nian-trophy-gallery-headshot.png",
      fullBody: "/assets/characters/nian-trophy-gallery-full-subject.png",
      poses: [
        { id: "left", name: "左侧", image: "/assets/characters/nian-trophy-gallery-left-subject.png" },
        { id: "prone", name: "俯卧", image: "/assets/characters/nian-trophy-gallery-prone-subject.png" },
        { id: "right", name: "右侧", image: "/assets/characters/nian-trophy-gallery-right-subject.png" }
      ],
      closeups: [
        expect.objectContaining({ id: "face", name: "半睁的脸", x: 50, y: 17, image: "/assets/characters/nian-trophy-detail-face.png" }),
        expect.objectContaining({ id: "hand", name: "松开的手", x: 31, y: 44, image: "/assets/characters/nian-trophy-detail-hand.png" }),
        expect.objectContaining({ id: "tail-root", name: "龙尾根部", x: 65, y: 47, image: "/assets/characters/nian-trophy-detail-tail-root.png" }),
        expect.objectContaining({ id: "feet-overhead", name: "足部·俯视", x: 43, y: 86, image: "/assets/characters/nian-trophy-detail-feet-overhead.png" }),
        expect.objectContaining({ id: "feet-side", name: "足部·侧面", x: 58, y: 86, image: "/assets/characters/nian-trophy-detail-feet-side.png" })
      ]
    });
    expect(plume.trophyGallery).toEqual({
      headshot: "/assets/characters/plume-trophy-gallery-headshot.png",
      fullBody: "/assets/characters/plume-trophy-gallery-full-subject.png",
      poses: [
        { id: "left", name: "左侧", image: "/assets/characters/plume-trophy-gallery-left-subject.png" },
        { id: "prone", name: "俯卧", image: "/assets/characters/plume-trophy-gallery-prone-subject.png" },
        { id: "right", name: "右侧", image: "/assets/characters/plume-trophy-gallery-right-subject.png" }
      ],
      closeups: [
        expect.objectContaining({ id: "face", name: "凝住的警觉", x: 50, y: 16, image: "/assets/characters/plume-trophy-detail-face.png" }),
        expect.objectContaining({ id: "skirt", name: "层叠裙摆", x: 50, y: 46, image: "/assets/characters/plume-trophy-detail-skirt.png" }),
        expect.objectContaining({ id: "stockings", name: "透肉黑色丝袜", x: 50, y: 69, image: "/assets/characters/plume-trophy-detail-stockings.png" }),
        expect.objectContaining({ id: "boots", name: "平置短靴", x: 50, y: 88, image: "/assets/characters/plume-trophy-detail-boots.png" })
      ]
    });
    expect(platinum.trophyGallery).toEqual(expect.objectContaining({
      headshot: "/assets/characters/platinum-trophy-gallery-headshot.png",
      fullBody: "/assets/characters/platinum-trophy-gallery-full-subject.png"
    }));
    expect(lappland.trophyGallery).toEqual({
      headshot: "/assets/characters/lappland-the-decadenza-trophy-gallery-headshot.png",
      fullBody: "/assets/characters/lappland-the-decadenza-trophy-gallery-full-subject.png",
      poses: [
        { id: "left", name: "左侧", image: "/assets/characters/lappland-the-decadenza-trophy-gallery-left-subject.png" },
        { id: "prone", name: "俯卧", image: "/assets/characters/lappland-the-decadenza-trophy-gallery-prone-subject.png" },
        { id: "right", name: "右侧", image: "/assets/characters/lappland-the-decadenza-trophy-gallery-right-subject.png" }
      ],
      closeups: [
        expect.objectContaining({ id: "face-inspected", name: "落幕后的神情", x: 50, y: 15, image: "/assets/characters/lappland-the-decadenza-trophy-detail-face-inspected.png" }),
        expect.objectContaining({ id: "chest-tie", name: "礼服领结", x: 51, y: 29, image: "/assets/characters/lappland-the-decadenza-trophy-detail-chest-tie.png" }),
        expect.objectContaining({ id: "skirt-thigh", name: "裙摆与腿环", x: 50, y: 51, image: "/assets/characters/lappland-the-decadenza-trophy-detail-skirt-thigh.png" }),
        expect.objectContaining({
          id: "feet",
          name: "长靴与短袜",
          x: 50,
          y: 88,
          image: "/assets/characters/lappland-the-decadenza-trophy-detail-feet-boots-p0.png",
          variants: [expect.objectContaining({ image: "/assets/characters/lappland-the-decadenza-trophy-detail-feet-white-socks.png" })]
        })
      ]
    });
    expect("trophyDefeated" in w.assets).toBe(false);
    expect("trophyDefeated" in texas.assets).toBe(false);
    expect("trophyDefeated" in irene.assets).toBe(false);
    expect("trophyDefeated" in cimei.assets).toBe(false);
    expect("trophyDefeated" in nian.assets).toBe(false);
    expect("trophyDefeated" in plume.assets).toBe(false);
    expect("trophyDefeated" in platinum.assets).toBe(false);
    expect("trophyDefeated" in lappland.assets).toBe(false);
    expect("portraitScale" in w).toBe(false);
    expect("portraitScale" in texas).toBe(false);
    expect("portraitScale" in irene).toBe(false);
    expect("portraitScale" in cimei).toBe(false);
    expect("portraitScale" in nian).toBe(false);
    expect("portraitScale" in plume).toBe(false);
    expect("portraitScale" in platinum).toBe(false);
    expect("portraitScale" in lappland).toBe(false);
    expect([w, texas, irene, cimei, nian, plume].every((character) => !("tablePortraitScale" in character))).toBe(true);
    expect([w, texas, irene, cimei, nian, plume, platinum, lappland].every((character) => !("tablePortraitScale" in character))).toBe(true);
    expect([w, texas, irene, cimei, nian, plume, platinum, lappland].map((character) => character.portraitScales.table)).toEqual([1, 1, 1, 1, 1, 1.3, 1, 1]);
    expect(w.profile.description.length).toBeGreaterThan(0);
    expect(w.matchSummary.playerVictory.length).toBeGreaterThan(0);
    expect(w.matchSummary.playerDefeat.length).toBeGreaterThan(0);
    expect(w.matchSummary.escaped.length).toBeGreaterThan(0);
    expect(texas.profile.description.length).toBeGreaterThan(0);
    expect(irene.profile.description.length).toBeGreaterThan(0);
    expect(irene.matchSummary.playerVictory.length).toBeGreaterThan(0);
    expect(irene.matchSummary.playerDefeat.length).toBeGreaterThan(0);
    expect(irene.matchSummary.escaped.length).toBeGreaterThan(0);
    expect(cimei.profile.description.length).toBeGreaterThan(0);
    expect(cimei.matchSummary.playerVictory.length).toBeGreaterThan(0);
    expect(cimei.matchSummary.playerDefeat.length).toBeGreaterThan(0);
    expect(cimei.matchSummary.escaped.length).toBeGreaterThan(0);
    expect(nian.profile.description.length).toBeGreaterThan(0);
    expect(nian.matchSummary.playerVictory.length).toBeGreaterThan(0);
    expect(nian.matchSummary.playerDefeat.length).toBeGreaterThan(0);
    expect(nian.matchSummary.escaped.length).toBeGreaterThan(0);
    expect(plume.profile.description.length).toBeGreaterThan(0);
    expect(plume.matchSummary.playerVictory.length).toBeGreaterThan(0);
    expect(plume.matchSummary.playerDefeat.length).toBeGreaterThan(0);
    expect(plume.matchSummary.escaped.length).toBeGreaterThan(0);
    expect(platinum.profile.description.length).toBeGreaterThan(0);
    expect(platinum.matchSummary.playerVictory.length).toBeGreaterThan(0);
    expect(platinum.matchSummary.playerDefeat.length).toBeGreaterThan(0);
    expect(platinum.matchSummary.escaped.length).toBeGreaterThan(0);
    expect(lappland.profile.description.length).toBeGreaterThan(0);
    expect(lappland.matchSummary.playerVictory.length).toBeGreaterThan(0);
    expect(lappland.matchSummary.playerDefeat.length).toBeGreaterThan(0);
    expect(lappland.matchSummary.escaped.length).toBeGreaterThan(0);
    expect([w.ai, texas.ai, irene.ai, cimei.ai, nian.ai, plume.ai].every((ai) => Number.isFinite(ai.P) && Number.isFinite(ai.A) && Number.isFinite(ai.B) && Number.isFinite(ai.C))).toBe(true);
    expect([w.ai, texas.ai, irene.ai, cimei.ai, nian.ai, plume.ai, platinum.ai, lappland.ai].every((ai) => Number.isFinite(ai.P) && Number.isFinite(ai.A) && Number.isFinite(ai.B) && Number.isFinite(ai.C))).toBe(true);
    expect(plume.ai).toEqual({ P: 0, A: 1, B: 1, C: 1 });
    expect(getCharacterMetadata("plume")?.tier).toBe("B");
    expect(getCharacterMetadata("w")?.tier).toBe("S");
    expect(getCharacterMetadata("cimei")?.tier).toBe("A");
    expect(getCharacterMetadata("cimei")?.unlock).toEqual({ type: "defeat-count", count: 3 });
    expect(getCharacterMetadata("lappland-the-decadenza")?.tier).toBe("S");
    expect(getCharacterMetadata("lappland-the-decadenza")?.unlock).toEqual({ type: "defeat-any" });
    expect(getCharacterMetadata("dorothy")).toEqual(expect.objectContaining({
      name: "多萝西",
      tier: "S",
      unlock: { type: "defeat-character", characterId: "ho-olheyak" },
      previewImage: "/assets/characters/dorothy-relaxed.png",
      trophyImage: "/assets/characters/dorothy-trophy-defeated.png"
    }));
    expect(w.aiSkills).toEqual([
      { definitionId: "bomb-maniac", enabled: true, parameters: {} },
      { definitionId: "w-night-queen", enabled: true, parameters: {} }
    ]);
    expect(irene.aiSkills).toEqual([{ definitionId: "ai-sword-and-handcannon", enabled: true, parameters: {} }]);
    expect(cimei.aiSkills).toEqual([]);
    expect(nian.aiSkills).toEqual([
      { definitionId: "ai-tin-scorch", enabled: true, parameters: {} },
      { definitionId: "ai-forge-heralds-the-year", enabled: true, parameters: {} }
    ]);
    expect(texas.aiSkills).toEqual([{ definitionId: "silent-drizzle", enabled: true, parameters: {} }]);
    expect(plume.aiSkills).toEqual([]);
    expect(platinum.aiSkills).toEqual([{ definitionId: "platinum-vision", enabled: true, parameters: {} }]);
    expect(lappland.aiSkills).toEqual([
      { definitionId: "carnival-index", enabled: true, parameters: {} },
      { definitionId: "carnival-heats-up", enabled: true, parameters: {} }
    ]);
    expect(dorothyData.aiSkills).toEqual([
      { definitionId: "dorothy-resonance-device", enabled: true, parameters: {} },
      { definitionId: "dorothy-quicksand-trap", enabled: true, parameters: {} }
    ]);
    expect(dorothyData.infoBar.matchingSuitMarker).toEqual({ type: "resonance", label: "共振牌" });
    const formalMechanics = [...w.aiSkills, ...texas.aiSkills, ...irene.aiSkills, ...cimei.aiSkills, ...nian.aiSkills, ...plume.aiSkills, ...platinum.aiSkills, ...lappland.aiSkills, ...dorothyData.aiSkills]
      .filter((binding) => binding.enabled)
      .map((binding) => getAbilityDefinition(binding.definitionId));
    expect(formalMechanics).toHaveLength(11);
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
    expect(Object.keys(cimei.dialogue).sort()).toEqual([...DIALOGUE_EVENT_CODES].sort());
    expect(Object.keys(nian.dialogue).sort()).toEqual([...DIALOGUE_EVENT_CODES].sort());
    expect(Object.keys(plume.dialogue).sort()).toEqual([...DIALOGUE_EVENT_CODES].sort());
    expect(Object.keys(platinum.dialogue).sort()).toEqual([...DIALOGUE_EVENT_CODES].sort());
    expect(Object.keys(lappland.dialogue).sort()).toEqual([...DIALOGUE_EVENT_CODES].sort());
    expect(Object.keys(dorothyData.dialogue).sort()).toEqual([...DIALOGUE_EVENT_CODES].sort());
    expect(Object.values(dorothyData.dialogue).flat().every((line) =>
      !(line.startsWith("“") && line.endsWith("”"))
      && !(line.startsWith("\"") && line.endsWith("\""))
    )).toBe(true);
    expect(Object.values(lappland.dialogue).every((pool) => pool.length > 0)).toBe(true);
    expect(Object.values(irene.dialogue).every((pool) => pool.length > 0)).toBe(true);
    expect(Object.values(cimei.dialogue).every((pool) => pool.length > 0)).toBe(true);
    expect(Object.values(plume.dialogue).every((pool) => pool.length > 0 && pool.every((line) => !line.includes("台词占位")))).toBe(true);
    expect(w.id).toBe(getCharacterMetadata(w.id)?.id);
    expect(texas.id).toBe(getCharacterMetadata(texas.id)?.id);
    expect(irene.id).toBe(getCharacterMetadata(irene.id)?.id);
    expect(cimei.id).toBe(getCharacterMetadata(cimei.id)?.id);
    expect(nian.id).toBe(getCharacterMetadata(nian.id)?.id);
    expect(plume.id).toBe(getCharacterMetadata(plume.id)?.id);
    expect(platinum.id).toBe(getCharacterMetadata(platinum.id)?.id);
    expect(lappland.id).toBe(getCharacterMetadata(lappland.id)?.id);
    expect(await loadCharacter("dorothy")).toEqual(expect.objectContaining({ id: "dorothy", ...dorothyData }));
    expect(await loadCharacter("w")).toBe(w);
    expect(await loadCharacter("irene")).toBe(irene);
    expect(await loadCharacter("cimei")).toBe(cimei);
    expect(await loadCharacter("nian")).toBe(nian);
    expect(await loadCharacter("plume")).toBe(plume);
    expect(await loadCharacter("platinum")).toBe(platinum);
    expect(await loadCharacter("lappland-the-decadenza")).toBe(lappland);
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
    expect(CharacterDataSchema.safeParse(cimeiData).success).toBe(true);
    expect(CharacterDataSchema.safeParse(nianData).success).toBe(true);
    expect(CharacterDataSchema.safeParse(plumeData).success).toBe(true);
    expect(CharacterDataSchema.safeParse(platinumData).success).toBe(true);
    expect(CharacterDataSchema.safeParse(lapplandData).success).toBe(true);
    expect(CharacterDataSchema.safeParse(dorothyData).success).toBe(true);
    expect(CharacterDataSchema.safeParse(typhonData).success).toBe(true);
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
    const { infoBar: _infoBar, ...bindingFixture } = wData;
    expect(CharacterDataSchema.safeParse({ ...bindingFixture, aiSkills: [{ definitionId: "owner-load-penalty", enabled: true, parameters: {} }] }).success).toBe(true);
    expect(CharacterDataSchema.safeParse({ ...bindingFixture, aiSkills: [{ definitionId: "action-advice-mechanic", enabled: true, parameters: { minimumHandSize: 2 } }] }).success).toBe(true);
    expect(CharacterDataSchema.safeParse({ ...bindingFixture, aiSkills: [{ definitionId: "unknown-mechanic", enabled: true, parameters: {} }] }).success).toBe(false);
    expect(CharacterDataSchema.safeParse({ ...bindingFixture, aiSkills: [{ definitionId: "switcheroo", enabled: true, parameters: {} }] }).success).toBe(false);
    expect(CharacterDataSchema.safeParse({ ...bindingFixture, aiSkills: [{ definitionId: "action-advice-mechanic", enabled: true, parameters: {} }] }).success).toBe(false);
    expect(CharacterDataSchema.safeParse({ ...bindingFixture, aiSkills: [{ definitionId: "action-advice-mechanic", enabled: true, parameters: { minimumHandSize: 11 } }] }).success).toBe(false);
    expect(CharacterDataSchema.safeParse({ ...bindingFixture, aiSkills: [{ definitionId: "owner-load-penalty", enabled: true, parameters: { unknown: true } }] }).success).toBe(false);
    expect(CharacterDataSchema.safeParse({ ...bindingFixture, aiSkills: [{ definitionId: "owner-load-penalty", enabled: true, parameters: {}, extra: true }] }).success).toBe(false);
    expect(CharacterDataSchema.safeParse({ ...dorothyData, infoBar: { ...dorothyData.infoBar, matchingSuitMarker: { type: "bad marker", label: "坏标记" } } }).success).toBe(false);
    expect(CharacterDataSchema.safeParse({ ...wData, infoBar: { ...wData.infoBar, matchingSuitMarker: { type: "resonance", label: "错误花色标记" } } }).success).toBe(false);
  });

  it("supports any number of bounded, uniquely identified trophy closeups and per-point variants", () => {
    const gallery = nianData.trophyGallery;
    const overhead = gallery.closeups.find((point) => point.id === "feet-overhead");
    expect(gallery.closeups).toHaveLength(5);
    expect(overhead?.variants).toEqual([{
      image: "/assets/characters/nian-trophy-detail-feet-overhead-p1.png",
      description: expect.stringContaining("白色高跟鞋已被移开")
    }]);
    expect(wData.trophyGallery.closeups.find((point) => point.id === "boots")?.variants?.[0]?.image).toBe("/assets/characters/w-trophy-detail-boots-p1.png");
    expect(texasData.trophyGallery.closeups.find((point) => point.id === "boots")?.variants?.[0]?.image).toBe("/assets/characters/texas-trophy-detail-boots-removed.png");
    expect(ireneData.trophyGallery.closeups.find((point) => point.id === "shoes")?.variants?.[0]?.image).toBe("/assets/characters/irene-trophy-detail-shoes-p1.png");
    expect(cimeiData.trophyGallery.closeups).toHaveLength(4);
    expect(cimeiData.trophyGallery.closeups.some((point) => point.id === "hands")).toBe(false);
    expect(cimeiData.trophyGallery.closeups.find((point) => point.id === "ankle-ribbons")?.variants?.[0]?.image).toBe("/assets/characters/cimei-trophy-detail-ankle-ribbons-p1.png");
    expect(plumeData.trophyGallery.closeups.find((point) => point.id === "boots")?.variants?.[0]?.image).toBe("/assets/characters/plume-trophy-detail-boots-p1.png");
    expect(platinumData.trophyGallery.closeups.find((point) => point.id === "feet")?.variants?.[0]?.image).toBe("/assets/characters/platinum-trophy-detail-feet-p1.png");
    expect(lapplandData.trophyGallery.closeups.find((point) => point.id === "feet")?.variants?.[0]?.image).toBe("/assets/characters/lappland-the-decadenza-trophy-detail-feet-white-socks.png");
    expect(hoOlheyakData.trophyGallery.closeups.find((point) => point.id === "shoes")?.variants?.[0]?.image).toBe("/assets/characters/ho-olheyak-trophy-detail-shoes-p1.png");
    expect(dorothyData.trophyGallery.closeups.find((point) => point.id === "feet")?.variants?.[0]?.image).toBe("/assets/characters/dorothy-trophy-detail-boots-p1-white-socks.png");
    expect(CharacterDataSchema.safeParse({ ...nianData, trophyGallery: { ...gallery, closeups: [] } }).success).toBe(true);
    expect(CharacterDataSchema.safeParse({ ...nianData, trophyGallery: { ...gallery, closeups: [...gallery.closeups, gallery.closeups[0]] } }).success).toBe(false);
    expect(CharacterDataSchema.safeParse({ ...nianData, trophyGallery: { ...gallery, closeups: [{ ...gallery.closeups[0], x: 101 }] } }).success).toBe(false);
    expect(CharacterDataSchema.safeParse({ ...nianData, trophyGallery: { ...gallery, closeups: [{ ...gallery.closeups[0], variants: [] }] } }).success).toBe(false);
    expect(CharacterDataSchema.safeParse({ ...nianData, trophyGallery: { ...gallery, closeups: [{ ...gallery.closeups[0], variants: [{ image: "/p1.png" }] }] } }).success).toBe(false);
  });

  it("supports uniquely identified transparent trophy pose layers", () => {
    const gallery = wData.trophyGallery;
    expect(gallery.poses).toEqual([
      { id: "left", name: "左侧", image: "/assets/characters/w-trophy-gallery-left-subject.png" },
      { id: "prone", name: "俯卧", image: "/assets/characters/w-trophy-gallery-prone-subject.png" },
      { id: "right", name: "右侧", image: "/assets/characters/w-trophy-gallery-right-subject.png" }
    ]);
    expect([wData, texasData, ireneData, cimeiData, nianData, plumeData, platinumData, lapplandData, typhonData].every((data) => data.trophyGallery.poses.length === 3)).toBe(true);
    expect(CharacterDataSchema.safeParse(wData).success).toBe(true);
    expect(CharacterDataSchema.safeParse({ ...wData, trophyGallery: { ...gallery, poses: [...gallery.poses, gallery.poses[0]] } }).success).toBe(false);
    expect(CharacterDataSchema.safeParse({ ...wData, trophyGallery: { ...gallery, poses: [{ ...gallery.poses[0], unknown: true }] } }).success).toBe(false);
  });

  it("requires a complete data-driven administrative trophy dossier for every attendee", () => {
    const characterData = [wData, texasData, ireneData, cimeiData, nianData, plumeData, platinumData, lapplandData, hoOlheyakData, dorothyData, typhonData];
    const expectedFieldIds = ["name", "race", "gender", "tier", "weight", "virginity"];
    expect(characterData.every((data) => CharacterDataSchema.safeParse(data).success)).toBe(true);
    expect(characterData.map((data) => data.trophyDossier.fields.map((field) => field.id))).toEqual(characterData.map(() => expectedFieldIds));
    expect(characterData.every((data) => data.trophyDossier.title === "人物档案")).toBe(true);
    expect(characterData.slice(0, -1).every((data) => data.trophyDossier.condition.label === "尸体状况")).toBe(true);
    expect(typhonData.trophyDossier.condition.label).toBe("尸体档案");
    expect(characterData.every((data) => data.trophyDossier.condition.description.length > 0)).toBe(true);
    expect(characterData.map((data) => data.trophyDossier.fields.find((field) => field.id === "name")?.value)).toEqual(CHARACTER_CATALOG.map((character) => character.name));
    expect(characterData.map((data) => data.trophyDossier.fields.find((field) => field.id === "tier")?.value)).toEqual(CHARACTER_CATALOG.map((character) => character.tier));
    expect(new Set(characterData.map((data) => data.trophyDossier.recordLabel)).size).toBe(characterData.length);
    const { trophyDossier: _missing, ...withoutDossier } = wData;
    expect(CharacterDataSchema.safeParse(withoutDossier).success).toBe(false);
    expect(CharacterDataSchema.safeParse({ ...wData, trophyDossier: { ...wData.trophyDossier, fields: wData.trophyDossier.fields.slice(0, 5) } }).success).toBe(false);
    expect(CharacterDataSchema.safeParse({ ...wData, trophyDossier: { ...wData.trophyDossier, fields: [...wData.trophyDossier.fields.slice(0, 5), wData.trophyDossier.fields[0]] } }).success).toBe(false);
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
    expect(parse({ type: "defeat-count", count: 3 })).toBe(true);
    expect(parse({ type: "defeat-any-tag", tag: "tier:a" })).toBe(true);
    expect(parse({ type: "defeat-character", characterId: "base" })).toBe(true);
    expect(parse({ type: "defeat-tag-percentage", tag: "group-a", percentage: 50 })).toBe(true);
    expect(parse({ type: "defeat-any-tag", tag: "missing" })).toBe(false);
    expect(parse({ type: "defeat-character", characterId: "missing" })).toBe(false);
    expect(parse({ type: "defeat-tag-percentage", tag: "group-a", percentage: 0 })).toBe(false);
    expect(parse({ type: "defeat-count", count: 0 })).toBe(false);
    expect(parse({ type: "defeat-count", count: 1.5 })).toBe(false);
    expect(CharacterCatalogSchema.safeParse({ defaultCharacterId: "base", characters: [{ ...base, tags: ["group-a", "group-a"] }] }).success).toBe(false);
    expect(CharacterCatalogSchema.safeParse({ defaultCharacterId: "base", characters: [{ ...base, tags: ["tier:s"] }] }).success).toBe(false);
    expect(CharacterCatalogSchema.safeParse({ defaultCharacterId: "locked", characters: [base, { ...locked, unlock: { type: "defeat-any" } }] }).success).toBe(false);
  });
});
