export type SkillTiming = "player-turn" | "roulette-reaction";
export type SkillCategory = "active" | "passive";

export type SkillEffect =
  | { readonly type: "opening-extra-draw" }
  | { readonly type: "hunter-advice" }
  | { readonly type: "switcheroo" }
  | { readonly type: "rhodes-heartthrob" }
  | { readonly type: "night-queen" }
  | { readonly type: "double-opponent-load" };

export interface SkillDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: SkillCategory;
  readonly timing: readonly SkillTiming[];
  readonly effect: SkillEffect;
  /** Optional data-driven unlock source. Undefined means an initial skill. */
  readonly unlock?: { readonly opponentId: string; readonly label: string };
}

export interface SkillInventory {
  readonly cards: readonly string[];
  readonly equippedSkillIds: readonly string[];
  readonly advice: "hit" | "stand" | null;
  readonly rhodesArmed: boolean;
  readonly nightQueenArmed: boolean;
}

export interface SkillUseResult {
  readonly inventory: SkillInventory;
}
