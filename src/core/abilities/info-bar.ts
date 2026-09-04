import { handCardCount, handTotal } from "./card-zone-adapter";
import { gunBullets } from "./roulette-adapter";
import type { AbilityInfoActor, AbilityInfoScalar, AbilityInfoValue, AbilityWorld } from "./types";
import type { Card, Suit } from "../blackjack/types";

export type ResolvedInfoBarValue = number | Card | Suit | null;
export interface AbilityInfoResolutionContext {
  readonly roundHitCounts?: Readonly<Record<"player" | "opponent", number>>;
  readonly sourceActive?: boolean;
}

function actorFor(selector: AbilityInfoActor, owner: "player" | "opponent"): "player" | "opponent" {
  if (selector === "owner") return owner;
  if (selector === "rival") return owner === "player" ? "opponent" : "player";
  throw new Error(`Unsupported information-bar actor: ${selector}`);
}

function resolveNumber(value: AbilityInfoScalar, world: AbilityWorld, owner: "player" | "opponent", context: AbilityInfoResolutionContext): number {
  if (typeof value === "number") return value;
  const expression = value;
  if (expression.type === "constant") return expression.value;
  if (expression.type === "add" || expression.type === "subtract" || expression.type === "multiply" || expression.type === "min" || expression.type === "max") {
    const left = resolveNumber(expression.left, world, owner, context);
    const right = resolveNumber(expression.right, world, owner, context);
    if (expression.type === "add") return left + right;
    if (expression.type === "subtract") return left - right;
    if (expression.type === "multiply") return left * right;
    if (expression.type === "min") return Math.min(left, right);
    return Math.max(left, right);
  }
  if (!(expression.type === "gun-bullets" || expression.type === "hand-total" || expression.type === "hand-card-count" || expression.type === "round-hit-count")) throw new Error(`Unsupported information-bar scalar: ${expression.type}`);
  const actor = actorFor(expression.target, owner);
  if (expression.type === "gun-bullets") return gunBullets(world.guns[actor]);
  if (expression.type === "hand-total") return handTotal(world.hands[actor]);
  if (expression.type === "hand-card-count") return handCardCount(world.hands[actor]);
  return context.roundHitCounts?.[actor] ?? 0;
}

function selectedCard(value: Extract<AbilityInfoValue, { type: "card" | "suit" }>, world: AbilityWorld, owner: "player" | "opponent"): Card | null {
  const actor = actorFor(value.target, owner);
  const cards = world.hands[actor].cards;
  return value.card === "first-private-card" ? cards[1] ?? null : cards.at(-1) ?? null;
}

/** Resolves one declarative information value from the current ability world. */
export function resolveAbilityInfoValue(value: AbilityInfoValue, world: AbilityWorld, owner: "player" | "opponent" = "opponent", context: AbilityInfoResolutionContext = {}): ResolvedInfoBarValue {
  if (context.sourceActive === false) return value.type === "number" ? 0 : null;
  if (value.type === "number") return resolveNumber(value.value, world, owner, context);
  const card = selectedCard(value, world, owner);
  return card === null ? null : value.type === "card" ? card : card.suit;
}
