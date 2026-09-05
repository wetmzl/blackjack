import type { AbilityTtl, SkillCardInstance } from "../abilities/types";

export type SkillTiming = "player-turn" | "roulette-reaction";
export type SkillCategory = "active" | "passive";

export interface PlayerSkillDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly triggerNotice: string;
  readonly profileLore: string;
  /** Full in-game rules shown from the compact table card. */
  readonly usage: string;
  readonly category: SkillCategory;
  readonly timing: readonly SkillTiming[];
  readonly primaryDomain: "blackjack" | "roulette" | "information" | "skill-economy" | "rule-control";
  readonly tags: readonly string[];
  readonly drop: { readonly enabled: boolean; readonly baseWeight: number };
  readonly stackable: boolean;
  readonly ttl?: AbilityTtl;
  /** Optional data-driven unlock source. Undefined means an initial skill. */
  readonly unlock?: { readonly opponentId: string; readonly label: string };
  readonly hidden: boolean;
}

export interface SkillDrawOffer {
  readonly id: string;
  readonly candidateDefinitionIds: readonly string[];
}

export interface PlayerSkillInventory {
  /** Every active and passive card occupies one stable inventory slot. */
  readonly cards: readonly SkillCardInstance[];
  /** Durable unlock snapshot used by deterministic draw generation. */
  readonly unlockedDefinitionIds: readonly string[];
  /** Earned draws that have not yet been exchanged for a skill card. */
  readonly drawCount: number;
  readonly drawOffer: SkillDrawOffer | null;
  readonly advice: "hit" | "stand" | null;
}
