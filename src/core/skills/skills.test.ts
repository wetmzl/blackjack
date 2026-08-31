import { describe, expect, it } from "vitest";
import { createRng } from "../rng/seeded";
import { drawRandomSkill, addUnlockedSkills, skillsUnlockedForVictory, validateLoadout } from "./skills";
import { createMatch } from "../match/reducer";

describe("skill inventory helpers", () => {
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
    const unlocked = ["hunter-instinct", "switcheroo", "rhodes-heartthrob", "early-preparation", "siracusan-fury"];
    expect(validateLoadout(unlocked, unlocked).valid).toBe(false);
    expect(validateLoadout(unlocked, ["early-preparation", "siracusan-fury"]).valid).toBe(false);
    expect(validateLoadout(unlocked, ["hunter-instinct", "switcheroo"]).valid).toBe(true);
    expect(validateLoadout(unlocked, ["night-queen"])).toMatchObject({ valid: false, reason: "locked" });
  });

  it("unlocks role skill once only for confirmed player wins", () => {
    expect(skillsUnlockedForVictory("w", "player")).toEqual(["night-queen"]);
    expect(skillsUnlockedForVictory("texas", "player")).toEqual(["siracusan-fury"]);
    expect(skillsUnlockedForVictory("w", "opponent")).toEqual([]);
    expect(skillsUnlockedForVictory("w", null, true)).toEqual([]);
    expect(addUnlockedSkills(["night-queen"], "w", "player")).toEqual(["night-queen"]);
  });
});
