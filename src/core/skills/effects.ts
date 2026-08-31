import type { Card, ShoeState } from "../blackjack/types";
import type { GunState } from "../roulette/types";
import { removeBullets } from "../roulette/roulette";
import type { SkillDefinition, SkillInventory, SkillUseResult } from "./types";

export interface SkillEffectContext {
  readonly inventory: SkillInventory;
  readonly gun: GunState;
  readonly shoe: ShoeState;
  readonly peekedCards: readonly Card[];
}

/** Data-driven skill interpreter. It has no access to DOM, timers, or randomness. */
export function applySkillEffect(skill: SkillDefinition, context: SkillEffectContext): SkillUseResult & { readonly gun: GunState } {
  const consumedAt = context.inventory.cards.indexOf(skill.id);
  if (consumedAt < 0) throw new Error(`Skill is not in inventory: ${skill.id}`);
  const inventoryCards = [...context.inventory.cards];
  inventoryCards.splice(consumedAt, 1);
  const inventory = { cards: inventoryCards };
  if (skill.effect.type === "remove-bullet") {
    return { inventory, gun: removeBullets(context.gun, skill.effect.amount), peekedCards: context.peekedCards };
  }
  const peekedCards = context.shoe.cards.slice(context.shoe.cursor, context.shoe.cursor + skill.effect.count);
  return { inventory, gun: context.gun, peekedCards };
}
