import { ABILITY_DEFINITIONS } from "../abilities/registry";
import type { AbilityDefinition } from "../abilities/types";
import type { SkillCategory, SkillDefinition, SkillTiming } from "./types";

function toSkillDefinition(definition: AbilityDefinition): SkillDefinition {
  const category: SkillCategory = definition.activation.type === "action" ? "active" : "passive";
  const timing: readonly SkillTiming[] = definition.activation.type === "action"
    ? definition.activation.windows.map((window) => window === "owner-turn" ? "player-turn" : "roulette-reaction")
    : [];
  return Object.freeze({ id: definition.id, name: definition.name, category, description: definition.description, usage: definition.usage ?? definition.description, triggerNotice: definition.triggerNotice ?? definition.description, profileLore: definition.profileLore ?? definition.description, timing, unlock: definition.unlock, hidden: definition.hidden ?? false });
}

export const SKILL_DEFINITIONS: readonly SkillDefinition[] = Object.freeze(ABILITY_DEFINITIONS.filter((definition) => !definition.hidden && (definition.sourceKind === "player-skill" || definition.sourceKind === "shared")).map(toSkillDefinition));
export const INITIAL_SKILL_IDS = ["early-preparation", "hunter-instinct", "switcheroo", "scent-of-a-woman"] as const;
export function getSkillDefinition(id: string): SkillDefinition | undefined { return SKILL_DEFINITIONS.find((skill) => skill.id === id); }
export function isActiveSkill(id: string): boolean { return getSkillDefinition(id)?.category === "active"; }
export function isPassiveSkill(id: string): boolean { return getSkillDefinition(id)?.category === "passive"; }
