import type { SeededRng, RngSnapshot } from "../rng/seeded";
import type { CharacterDefeatRecord } from "../progression/defeats";
import { getSkillDefinition, INITIAL_SKILL_IDS, SKILL_DEFINITIONS } from "./definitions";
import type { SkillDefinition } from "./types";

export interface LoadoutValidation { readonly valid: boolean; readonly reason?: "locked" | "too-many" | "too-many-passives"; readonly equippedSkillIds: readonly string[]; }

/** Pure loadout guard shared by persistence/UI callers. */
export function validateLoadout(unlockedSkillIds: readonly string[], equippedSkillIds: readonly string[]): LoadoutValidation {
  const unlocked = new Set(unlockedSkillIds);
  const ids = [...equippedSkillIds];
  if (new Set(ids).size !== ids.length) return { valid: false, reason: "too-many", equippedSkillIds: ids };
  if (ids.some((id) => !unlocked.has(id) || !getSkillDefinition(id))) return { valid: false, reason: "locked", equippedSkillIds: ids };
  if (ids.length > 4) return { valid: false, reason: "too-many", equippedSkillIds: ids };
  if (ids.filter((id) => getSkillDefinition(id)?.category === "passive").length > 1) return { valid: false, reason: "too-many-passives", equippedSkillIds: ids };
  return { valid: true, equippedSkillIds: ids };
}

const DRAWABLE_DEFAULT_IDS = SKILL_DEFINITIONS.filter((skill) => skill.category === "active").map((skill) => skill.id);

export function drawRandomSkill(rng: SeededRng, equippedSkillIds: readonly string[] = DRAWABLE_DEFAULT_IDS): { readonly skill: SkillDefinition; readonly rng: RngSnapshot } {
  const pool = equippedSkillIds.map((id) => getSkillDefinition(id)).filter((skill): skill is SkillDefinition => Boolean(skill && skill.category === "active"));
  if (pool.length === 0) throw new Error("No equipped active skill to draw");
  const skill = pool[rng.nextInt(pool.length)];
  return { skill, rng: rng.snapshot() };
}

/** Returns skills newly granted by a confirmed, non-escaped victory. */
export function skillsUnlockedForVictory(opponentId: string, winner: "player" | "opponent" | null, escaped = false): string[] {
  if (escaped || winner !== "player") return [];
  return SKILL_DEFINITIONS.filter((skill) => skill.unlock?.opponentId === opponentId).map((skill) => skill.id);
}

export function addUnlockedSkills(current: readonly string[], opponentId: string, winner: "player" | "opponent" | null, escaped = false): string[] {
  return [...new Set([...current, ...skillsUnlockedForVictory(opponentId, winner, escaped)])];
}

/** Rebuilds the canonical persistent inventory without consulting disposable match history. */
export function unlockedSkillIdsForDefeats(defeats: readonly CharacterDefeatRecord[]): string[] {
  const defeatedIds = new Set(defeats.map((record) => record.opponentId));
  return [...new Set([...INITIAL_SKILL_IDS, ...SKILL_DEFINITIONS
    .filter((skill) => skill.unlock && defeatedIds.has(skill.unlock.opponentId))
    .map((skill) => skill.id)])];
}

export const getSkillsUnlockedForVictory = skillsUnlockedForVictory;
