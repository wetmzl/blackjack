export type SkillTiming = "player-turn" | "roulette-reaction";
export type SkillCategory = "active" | "passive";
import type { SkillCardInstance } from "../abilities/types";

export interface SkillDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly triggerNotice: string;
  readonly profileLore: string;
  /** Full in-game rules shown from the compact table card. */
  readonly usage: string;
  readonly category: SkillCategory;
  readonly timing: readonly SkillTiming[];
  /** Optional data-driven unlock source. Undefined means an initial skill. */
  readonly unlock?: { readonly opponentId: string; readonly label: string };
  readonly hidden: boolean;
}

export interface SkillInventory {
  /** Card instances are stable across duplicate draws. */
  readonly cards: readonly SkillCardInstance[];
  readonly equippedSkillIds: readonly string[];
  readonly advice: "hit" | "stand" | null;
}

export interface SkillUseResult {
  readonly inventory: SkillInventory;
}
