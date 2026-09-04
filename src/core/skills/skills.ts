import type { AbilityDefinition, SkillOfferReason, SkillOfferRuleModifier, SkillOfferWeightModifier } from "../abilities/types";
import type { SeededRng, RngSnapshot } from "../rng/seeded";
import type { CharacterDefeatRecord } from "../progression/defeats";
import { INITIAL_PLAYER_SKILL_IDS, PLAYER_SKILL_DEFINITIONS } from "./definitions";
import type { PlayerSkillDefinition, SkillOffer, SkillOfferRule, SkillOfferSelectionError } from "./types";

export const PLAYER_SKILL_INVENTORY_CAPACITY = 10;

const BASE_OFFER_RULES: Readonly<Record<SkillOfferReason, SkillOfferRule>> = Object.freeze({
  opening: { candidateCount: 3, selectionCount: 1 },
  "normal-win": { candidateCount: 3, selectionCount: 1 },
  "blackjack-win": { candidateCount: 3, selectionCount: 2 },
  loss: { candidateCount: 2, selectionCount: 1 },
  push: { candidateCount: 3, selectionCount: 1 }
});

export function resolveSkillOfferRule(reason: SkillOfferReason, modifiers: readonly SkillOfferRuleModifier[] = []): SkillOfferRule {
  const base = BASE_OFFER_RULES[reason];
  const relevant = modifiers.filter((modifier) => modifier.reason === "any" || modifier.reason === reason);
  const candidateCount = relevant.reduce((value, modifier) => value + (modifier.candidateCountDelta ?? 0), base.candidateCount);
  const selectionCount = relevant.reduce((value, modifier) => value + (modifier.selectionCountDelta ?? 0), base.selectionCount);
  return { candidateCount: Math.max(1, Math.min(4, candidateCount)), selectionCount: Math.max(1, Math.min(4, selectionCount)) };
}

/** Primary domains participate in the same matching namespace as open tags. */
export function playerSkillHasTag(skill: PlayerSkillDefinition, tag: string): boolean {
  return skill.primaryDomain === tag || skill.tags.includes(tag);
}

export function calculatePlayerSkillWeight(skill: PlayerSkillDefinition, modifiers: readonly SkillOfferWeightModifier[]): number {
  return modifiers.reduce((weight, modifier) => playerSkillHasTag(skill, modifier.tag) ? weight * modifier.factor : weight, skill.drop.baseWeight);
}

export function collectSkillOfferModifiers(definitions: readonly AbilityDefinition[]): {
  readonly weights: readonly SkillOfferWeightModifier[];
  readonly rules: readonly SkillOfferRuleModifier[];
} {
  return {
    weights: definitions.flatMap((definition) => definition.skillOfferWeightModifiers ?? []),
    rules: definitions.flatMap((definition) => definition.skillOfferRuleModifiers ?? [])
  };
}

function weightedPickIndex(weights: readonly number[], rng: SeededRng): number {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!(total > 0) || !Number.isFinite(total)) throw new RangeError("Skill offer requires a positive finite total weight");
  let cursor = rng.next() * total;
  for (let index = 0; index < weights.length; index += 1) {
    cursor -= weights[index]!;
    if (cursor < 0) return index;
  }
  return weights.length - 1;
}

export function generateSkillOffer(
  rng: SeededRng,
  reason: SkillOfferReason,
  unlockedDefinitionIds: readonly string[],
  heldDefinitionIds: readonly string[],
  weightModifiers: readonly SkillOfferWeightModifier[] = [],
  ruleModifiers: readonly SkillOfferRuleModifier[] = [],
  offerId = `skill-offer-${reason}`
): { readonly offer: SkillOffer; readonly rng: RngSnapshot } {
  const unlocked = new Set(unlockedDefinitionIds);
  const held = new Set(heldDefinitionIds);
  const rule = resolveSkillOfferRule(reason, ruleModifiers);
  const pool = PLAYER_SKILL_DEFINITIONS.filter((skill) => unlocked.has(skill.id) && skill.drop.enabled)
    .filter((skill) => skill.category === "active" || skill.stackable || !held.has(skill.id))
    .map((skill) => ({ skill, weight: calculatePlayerSkillWeight(skill, weightModifiers) }))
    .filter((candidate) => candidate.weight > 0);
  const candidates: PlayerSkillDefinition[] = [];
  while (pool.length > 0 && candidates.length < rule.candidateCount) {
    const index = weightedPickIndex(pool.map((candidate) => candidate.weight), rng);
    candidates.push(pool[index]!.skill);
    pool.splice(index, 1);
  }
  const candidateDefinitionIds = candidates.map((skill) => skill.id);
  return {
    offer: {
      id: offerId, reason, candidateDefinitionIds,
      maxSelections: Math.min(
        rule.selectionCount,
        candidateDefinitionIds.length,
        Math.max(0, PLAYER_SKILL_INVENTORY_CAPACITY - heldDefinitionIds.length)
      ),
      selectedDefinitionIds: []
    },
    rng: rng.snapshot()
  };
}

export function skillOfferSelectionError(offer: SkillOffer, currentCardCount: number, definitionId: string): SkillOfferSelectionError | null {
  if (offer.selectedDefinitionIds.includes(definitionId)) return null;
  if (currentCardCount + offer.selectedDefinitionIds.length >= PLAYER_SKILL_INVENTORY_CAPACITY) return "inventory-full";
  if (offer.selectedDefinitionIds.length >= offer.maxSelections) return "selection-limit";
  return null;
}

/** Returns skills newly unlocked by a confirmed, non-escaped victory. */
export function playerSkillsUnlockedForVictory(opponentId: string, winner: "player" | "opponent" | null, escaped = false): string[] {
  if (escaped || winner !== "player") return [];
  return PLAYER_SKILL_DEFINITIONS.filter((skill) => skill.unlock?.opponentId === opponentId).map((skill) => skill.id);
}

export function unlockedPlayerSkillIdsForDefeats(defeats: readonly CharacterDefeatRecord[]): string[] {
  const defeatedIds = new Set(defeats.map((record) => record.opponentId));
  return [...new Set([...INITIAL_PLAYER_SKILL_IDS, ...PLAYER_SKILL_DEFINITIONS
    .filter((skill) => skill.unlock && defeatedIds.has(skill.unlock.opponentId))
    .map((skill) => skill.id)])];
}
