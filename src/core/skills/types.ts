import type { Card } from "../blackjack/types";

export type SkillTiming = "player-turn" | "roulette-reaction";

export type SkillEffect =
  | { readonly type: "remove-bullet"; readonly amount: number }
  | { readonly type: "peek-next-card"; readonly count: number };

export interface SkillDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly timing: readonly SkillTiming[];
  readonly effect: SkillEffect;
}

export interface SkillInventory {
  readonly cards: readonly string[];
}

export interface SkillUseResult {
  readonly inventory: SkillInventory;
  readonly peekedCards: readonly Card[];
}
