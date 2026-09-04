import { describe, expect, it } from "vitest";
import { createRng } from "../rng/seeded";
import { drawRandomSkill, addUnlockedSkills, skillsUnlockedForVictory, unlockedSkillIdsForDefeats, validateLoadout } from "./skills";
import { INITIAL_SKILL_IDS, SKILL_DEFINITIONS } from "./definitions";
import { ABILITY_DEFINITIONS, getAbilityDefinition } from "../abilities/registry";
import { createMatch } from "../match/reducer";

describe("skill inventory helpers", () => {
  it("derives eight visible skills and excludes the hidden Rhodes definition", () => {
    expect(SKILL_DEFINITIONS).toHaveLength(8);
    expect(SKILL_DEFINITIONS.every((skill) => skill.name && skill.description && skill.profileLore && skill.triggerNotice)).toBe(true);
    expect(SKILL_DEFINITIONS.some((skill) => skill.id === "rhodes-heartthrob")).toBe(false);
    expect(ABILITY_DEFINITIONS.some((definition) => definition.id === "rhodes-heartthrob" && definition.hidden)).toBe(true);
    expect(INITIAL_SKILL_IDS).toEqual(["early-preparation", "hunter-instinct", "switcheroo", "scent-of-a-woman"]);
    expect(getAbilityDefinition("rhodes-heartthrob")).toBeDefined();
  });
  it("draws only equipped active skills and permits duplicates", () => {
    const rng = createRng("draw");
    const draws = Array.from({ length: 12 }, () => drawRandomSkill(rng, ["hunter-instinct"]).skill.id);
    expect(draws).toEqual(Array(12).fill("hunter-instinct"));
    expect(() => drawRandomSkill(createRng("none"), ["early-preparation"])).toThrow(/No equipped active/);
  });

  it("starts safely with only a passive equipped and no active cards", () => {
    const state = createMatch("passive-only", { equippedSkillIds: ["early-preparation"] });
    expect(state.skills.equippedSkillIds).toEqual(["early-preparation"]);
    expect(state.skills.cards).toEqual([]);
  });

  it("validates strict four-skill and one-passive loadouts", () => {
    const unlocked = ["hunter-instinct", "switcheroo", "night-queen", "early-preparation", "blueberry-and-dark-chocolate"];
    expect(validateLoadout(unlocked, unlocked).valid).toBe(false);
    expect(validateLoadout([...unlocked, "forge-heralds-the-year"], ["early-preparation", "forge-heralds-the-year"]).valid).toBe(false);
    expect(validateLoadout(unlocked, ["hunter-instinct", "switcheroo"]).valid).toBe(true);
    expect(validateLoadout(unlocked, ["night-queen"]).valid).toBe(true);
  });

  it("unlocks role skill once only for confirmed player wins", () => {
    expect(skillsUnlockedForVictory("w", "player")).toEqual(["night-queen"]);
    expect(skillsUnlockedForVictory("texas", "player")).toEqual(["blueberry-and-dark-chocolate"]);
    expect(skillsUnlockedForVictory("irene", "player")).toEqual(["sword-and-handcannon"]);
    expect(skillsUnlockedForVictory("nian", "player")).toEqual(["forge-heralds-the-year"]);
    expect(skillsUnlockedForVictory("w", "opponent")).toEqual([]);
    expect(skillsUnlockedForVictory("w", null, true)).toEqual([]);
    for (const opponentId of ["texas", "irene", "nian"] as const) {
      expect(skillsUnlockedForVictory(opponentId, "opponent")).toEqual([]);
      expect(skillsUnlockedForVictory(opponentId, null, true)).toEqual([]);
    }
    expect(addUnlockedSkills(["night-queen"], "w", "player")).toEqual(["night-queen"]);
  });

  it("rebuilds persistent unlocks from durable defeat facts", () => {
    expect(unlockedSkillIdsForDefeats([])).toEqual(INITIAL_SKILL_IDS);
    expect(unlockedSkillIdsForDefeats([{ opponentId: "texas", timestamp: "2026-01-01T00:00:00.000Z" }])).toContain("blueberry-and-dark-chocolate");
  });
});
