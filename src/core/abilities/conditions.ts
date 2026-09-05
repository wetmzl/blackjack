import type { Hand } from "../blackjack/types";
import { canSplitLastCard, findCardCandidates, handCardCount, handTotal } from "./card-zone-adapter";
import { gunBullets, gunIsFull } from "./roulette-adapter";
import type { AbilityInstance, AbilityEventContext, AbilityWorld, ActorSelector, Compare, Condition, NumberValue, ScalarValue } from "./types";

export interface ConditionContext { readonly world: AbilityWorld; readonly ability: AbilityInstance; readonly event: AbilityEventContext; }

export function resolveActor(selector: ActorSelector, context: ConditionContext): "player" | "opponent" | undefined {
  if (selector === "owner") return context.ability.owner;
  if (selector === "rival") return context.ability.owner === "player" ? "opponent" : "player";
  if (selector === "event-actor") return context.event.eventActor;
  return context.event.roundOutcome?.penaltyTarget ?? undefined;
}

export function resolveScalar(value: ScalarValue, context: ConditionContext): number {
  if (typeof value === "number") return value;
  const numeric = value as NumberValue;
  if (numeric.type === "constant") return numeric.value;
  if (numeric.type === "parameter") {
    const parameter = context.ability.parameters[numeric.key];
    if (typeof parameter !== "number") throw new Error(`Ability parameter is not numeric: ${numeric.key}`);
    return parameter;
  }
  if (numeric.type === "add" || numeric.type === "subtract" || numeric.type === "multiply") {
    const left = resolveScalar(numeric.left, context);
    const right = resolveScalar(numeric.right, context);
    return numeric.type === "add" ? left + right : numeric.type === "subtract" ? left - right : left * right;
  }
  if (!("target" in numeric)) throw new Error("Invalid scalar expression");
  const actor = resolveActor(numeric.target, context);
  if (!actor) return 0;
  if (numeric.type === "gun-bullets") return gunBullets(context.world.guns[actor]);
  if (numeric.type === "hand-total") return handTotal(context.world.hands[actor]);
  if (numeric.type === "round-final-score") return context.event.roundOutcome?.comparisonScores?.[actor] ?? handTotal(context.world.hands[actor]);
  if (numeric.type === "hand-card-count") return handCardCount(context.world.hands[actor]);
  if (numeric.type === "status-stacks") return context.world.statuses.find((status) => status.owner === actor && status.statusDefinitionId === numeric.statusDefinitionId)?.stacks ?? 0;
  return context.event.roundHitCounts?.[actor] ?? 0;
}

function compare(left: number, operator: Compare, right: number): boolean {
  if (operator === "eq") return left === right;
  if (operator === "neq") return left !== right;
  if (operator === "lt") return left < right;
  if (operator === "lte") return left <= right;
  if (operator === "gt") return left > right;
  return left >= right;
}

function handFor(selector: ActorSelector, context: ConditionContext): Hand | undefined {
  const actor = resolveActor(selector, context);
  return actor ? context.world.hands[actor] : undefined;
}

function candidateExists(hand: Hand, context: ConditionContext, candidate: Extract<Condition, { type: "card-candidate-exists" }>["candidate"]): boolean {
  const expected = resolveScalar(candidate.value, context);
  const mode = candidate.type === "resulting-hand-total-at-most" ? "at-most" : "exactly";
  return findCardCandidates(context.world.shoe, hand, mode, expected).length > 0;
}

export function evaluateCondition(condition: Condition, context: ConditionContext): boolean {
  switch (condition.type) {
    case "actor-is": return context.event.eventActor === resolveActor(condition.actor, context);
    case "owner-has-card": return context.world.cards.some((card) => card.owner === context.ability.owner && card.definitionId === condition.abilityId);
    case "hand-card-count": { const hand = handFor(condition.target, context); return Boolean(hand && compare(handCardCount(hand), condition.operator, resolveScalar(condition.value, context))); }
    case "hand-total": { const hand = handFor(condition.target, context); return Boolean(hand && compare(handTotal(hand), condition.operator, resolveScalar(condition.value, context))); }
    case "round-hit-count": { const actor = resolveActor(condition.target, context); return Boolean(actor && compare(context.event.roundHitCounts?.[actor] ?? 0, condition.operator, resolveScalar(condition.value, context))); }
    case "hand-all-same-suit": { const hand = handFor(condition.target, context); return Boolean(hand && hand.cards.length > 0 && new Set(hand.cards.map((card) => card.suit)).size === 1); }
    case "hand-all-color": { const hand = handFor(condition.target, context); return Boolean(hand && hand.cards.length > 0 && hand.cards.every((card) => (card.suit === "hearts" || card.suit === "diamonds") === (condition.color === "red"))); }
    case "hand-rank-has-suit-partner": { const hand = handFor(condition.target, context); return Boolean(hand && hand.cards.some((card, index) => card.rank === condition.rank && hand.cards.some((partner, partnerIndex) => partnerIndex !== index && partner.suit === card.suit))); }
    case "hand-card-origin-is": { const hand = handFor(condition.target, context); return hand?.cards.at(-1)?.origin === condition.origin; }
    case "card-candidate-exists": { const hand = handFor(condition.target, context); return Boolean(hand && hand.cards.length > 0 && candidateExists(hand, context, condition.candidate)); }
    case "draw-pile-card-exists": return context.world.shoe.cursor < context.world.shoe.cards.length;
    case "hand-last-card-splittable": { const hand = handFor(condition.target, context); return Boolean(hand && canSplitLastCard(hand)); }
    case "hand-is-twenty-one": { const hand = handFor(condition.target, context); return Boolean(hand && handTotal(hand) === 21); }
    case "pending-bust-would-bust": {
      const hand = handFor(condition.target, context);
      const actor = resolveActor(condition.target, context);
      const pending = context.event.pendingBust;
      return Boolean(hand && actor && pending?.actor === actor && handTotal(hand) > pending.limit);
    }
    case "status-card-rank-is": {
      const actor = resolveActor(condition.target, context);
      const status = actor ? context.world.statuses.find((entry) => entry.owner === actor && entry.statusDefinitionId === condition.statusDefinitionId && entry.stacks > 0) : undefined;
      return status?.parameters.rank === condition.rank;
    }
    case "gun-bullets": { const actor = resolveActor(condition.target, context); return Boolean(actor && compare(gunBullets(context.world.guns[actor]), condition.operator, resolveScalar(condition.value, context))); }
    case "gun-is-full": { const actor = resolveActor(condition.target, context); return Boolean(actor && gunIsFull(context.world.guns[actor]) === condition.expected); }
    case "round-reason-is": return context.event.roundOutcome?.reason === condition.value;
    case "round-penalty-target-is": return context.event.roundOutcome?.penaltyTarget === resolveActor(condition.target, context);
    case "event-ability-kind-is": return context.event.playedAbilityKind === condition.kind;
    case "status-present": { const actor = resolveActor(condition.target, context); return Boolean(actor && context.world.statuses.some((status) => status.owner === actor && status.statusDefinitionId === condition.statusDefinitionId && status.stacks > 0)); }
    case "any": return condition.conditions.some((entry) => evaluateCondition(entry, context));
    case "not": return !evaluateCondition(condition.condition, context);
  }
}

export function allConditionsPass(conditions: readonly Condition[] | undefined, context: ConditionContext): boolean {
  return !conditions || conditions.every((condition) => evaluateCondition(condition, context));
}
