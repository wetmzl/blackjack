import type { Hand } from "../blackjack/types";
import { findCardCandidates, handCardCount, handTotal } from "./card-zone-adapter";
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
  const actor = resolveActor(numeric.target, context);
  if (!actor) return 0;
  return numeric.type === "gun-bullets" ? gunBullets(context.world.guns[actor]) : handTotal(context.world.hands[actor]);
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
    case "hand-all-same-suit": { const hand = handFor(condition.target, context); return Boolean(hand && hand.cards.length > 0 && new Set(hand.cards.map((card) => card.suit)).size === 1); }
    case "card-candidate-exists": { const hand = handFor(condition.target, context); return Boolean(hand && hand.cards.length > 0 && candidateExists(hand, context, condition.candidate)); }
    case "hand-is-twenty-one": { const hand = handFor(condition.target, context); return Boolean(hand && handTotal(hand) === 21); }
    case "gun-bullets": { const actor = resolveActor(condition.target, context); return Boolean(actor && compare(gunBullets(context.world.guns[actor]), condition.operator, resolveScalar(condition.value, context))); }
    case "gun-is-full": { const actor = resolveActor(condition.target, context); return Boolean(actor && gunIsFull(context.world.guns[actor]) === condition.expected); }
    case "round-reason-is": return context.event.roundOutcome?.reason === condition.value;
    case "round-penalty-target-is": return context.event.roundOutcome?.penaltyTarget === resolveActor(condition.target, context);
    case "status-present": { const actor = resolveActor(condition.target, context); return Boolean(actor && context.world.statuses.some((status) => status.owner === actor && status.statusDefinitionId === condition.statusDefinitionId && status.stacks > 0)); }
    case "any": return condition.conditions.some((entry) => evaluateCondition(entry, context));
    case "not": return !evaluateCondition(condition.condition, context);
  }
}

export function allConditionsPass(conditions: readonly Condition[] | undefined, context: ConditionContext): boolean {
  return !conditions || conditions.every((condition) => evaluateCondition(condition, context));
}
