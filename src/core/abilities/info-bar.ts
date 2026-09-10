import { handCardCount, handTotal } from "./card-zone-adapter";
import { gunBullets } from "./roulette-adapter";
import type { AbilityInfoActor, AbilityInfoScalar, AbilityInfoValue, AbilityWorld } from "./types";
import type { Card, Rank, Suit } from "../blackjack/types";
import { RANKS, SUITS } from "../blackjack/types";
import { cardSuit, createDerivedCard } from "../blackjack/card";

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
  if (!(expression.type === "gun-bullets" || expression.type === "hand-total" || expression.type === "hand-card-count" || expression.type === "round-hit-count" || expression.type === "status-stacks")) throw new Error(`Unsupported information-bar scalar: ${expression.type}`);
  const actor = actorFor(expression.target, owner);
  if (expression.type === "gun-bullets") return gunBullets(world.guns[actor]);
  if (expression.type === "hand-total") return handTotal(world.hands[actor]);
  if (expression.type === "hand-card-count") return handCardCount(world.hands[actor]);
  if (expression.type === "status-stacks") return world.statuses.find((status) => status.owner === actor && status.statusDefinitionId === expression.statusDefinitionId)?.stacks ?? 0;
  return context.roundHitCounts?.[actor] ?? 0;
}

function selectedCard(value: { readonly target: AbilityInfoActor; readonly card: "last-card" | "first-private-card" }, world: AbilityWorld, owner: "player" | "opponent"): Card | null {
  const actor = actorFor(value.target, owner);
  const cards = world.hands[actor].cards;
  return value.card === "first-private-card" ? cards[1] ?? null : cards.at(-1) ?? null;
}

/** Resolves one declarative information value from the current ability world. */
export function resolveAbilityInfoValue(value: AbilityInfoValue, world: AbilityWorld, owner: "player" | "opponent" = "opponent", context: AbilityInfoResolutionContext = {}): ResolvedInfoBarValue {
  if (context.sourceActive === false) return value.type === "number" ? 0 : null;
  if (value.type === "number") return resolveNumber(value.value, world, owner, context);
  if ("source" in value && value.source === "status-suit") {
    const actor = actorFor(value.target, owner);
    const suit = world.statuses.find((entry) => entry.owner === actor && entry.statusDefinitionId === value.statusDefinitionId && entry.stacks > 0)?.parameters.suit;
    return typeof suit === "string" && SUITS.includes(suit as Suit) ? suit as Suit : null;
  }
  if ("source" in value && value.source === "status-card") {
    const status = world.statuses.find((entry) => entry.owner === owner && entry.statusDefinitionId === value.statusDefinitionId && entry.stacks > 0);
    const rank = status?.parameters.rank;
    const suit = status?.parameters.suit;
    if (typeof rank !== "string" || typeof suit !== "string" || !RANKS.includes(rank as Rank) || !SUITS.includes(suit as Suit)) return null;
    const card = createDerivedCard(suit as Suit, rank as Rank, `card-info-${status!.sourceInstanceId}-${value.statusDefinitionId}`, status!.sourceInstanceId);
    return value.type === "card" ? card : cardSuit(card);
  }
  if (!("source" in value)) {
    const card = selectedCard(value, world, owner);
    return card === null ? null : value.type === "card" ? card : cardSuit(card);
  }
  return null;
}
