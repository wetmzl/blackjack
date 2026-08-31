import type { SeededRng, RngSnapshot } from "../rng/seeded";
import { SKILL_DEFINITIONS } from "./definitions";
import type { SkillDefinition } from "./types";

export function drawRandomSkill(rng: SeededRng): { readonly skill: SkillDefinition; readonly rng: RngSnapshot } {
  const skill = SKILL_DEFINITIONS[rng.nextInt(SKILL_DEFINITIONS.length)];
  return { skill, rng: rng.snapshot() };
}
