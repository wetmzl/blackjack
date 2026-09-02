import type { SeededRng } from "../rng/seeded";
import { addToPendingLoad, multiplyPendingLoad } from "./roulette-adapter";
import { drawExactResultingTotal, replaceLastHandCard } from "./card-zone-adapter";
import { getStatusDefinition, type AbilityRegistry } from "./registry";
import { resolveActor, resolveScalar, type ConditionContext } from "./conditions";
import type { AbilityDomainEvent, AbilityEffectResult, AbilityRuntimeState, AbilityWorld, Effect, PendingDraw, PendingLoad, PendingTrigger, SkillCardInstance } from "./types";

export interface EffectContext extends ConditionContext {
  readonly ruleId?: string;
  readonly rng: SeededRng;
  readonly runtime: AbilityRuntimeState;
  readonly drawSkillCards?: (owner: "player" | "opponent", amount: number, world: AbilityWorld, rng: SeededRng) => readonly SkillCardInstance[];
  readonly publishAdvice?: (owner: "player" | "opponent", world: AbilityWorld) => "hit" | "stand";
  readonly registry?: AbilityRegistry;
}

function withHands(world: AbilityWorld, actor: "player" | "opponent", hand: AbilityWorld["hands"]["player"]): AbilityWorld { return { ...world, hands: { ...world.hands, [actor]: hand } }; }
function statusFor(world: AbilityWorld, actor: "player" | "opponent", id: string) { return world.statuses.find((status) => status.owner === actor && status.statusDefinitionId === id); }

export function applyEffect(effect: Effect, context: EffectContext, pending: { draw?: PendingDraw; load?: PendingLoad; trigger?: PendingTrigger } = {}): AbilityEffectResult {
  let world = context.world;
  let draw = pending.draw;
  let load = pending.load;
  let trigger = pending.trigger;
  let runtime = context.runtime;
  const events: AbilityDomainEvent[] = [];
  const actor = resolveActor(effect.target, context);
  if (!actor) throw new Error(`Cannot resolve actor selector: ${effect.target}`);
  const changed = (effectType: string): void => { events.push({ type: "PENDING_EVENT_MODIFIED", eventId: draw?.id ?? load?.id ?? trigger?.id ?? context.event.sourceEventId, effectType, sourceInstanceId: context.ability.instanceId }); };
  switch (effect.type) {
    case "draw-skill-cards": {
      const amount = Math.max(0, Math.floor(resolveScalar(effect.amount, context)));
      if (!context.drawSkillCards) throw new Error("No skill card drawer configured");
      const cards = context.drawSkillCards(actor, amount, world, context.rng);
      world = { ...world, cards: [...world.cards, ...cards] };
      break;
    }
    case "publish-action-advice":
      if (!context.publishAdvice) throw new Error("No action-advice publisher configured");
      world = { ...world, advice: context.publishAdvice(actor, world) };
      break;
    case "replace-hand-card": {
      const hand = world.hands[actor];
      const candidate = effect.candidate.type === "resulting-hand-total-at-most" ? "at-most" : "exactly";
      const result = replaceLastHandCard(world.shoe, hand, context.rng, candidate, resolveScalar(effect.candidate.value, context));
      if (!result) throw new Error("No legal card candidate");
      world = withHands({ ...world, shoe: result.shoe }, actor, result.hand);
      changed(effect.type);
      break;
    }
    case "add-status": {
      const definition = context.registry?.statusesById[effect.statusDefinitionId] ?? getStatusDefinition(effect.statusDefinitionId);
      if (!definition) throw new Error(`Unknown status definition: ${effect.statusDefinitionId}`);
      const existing = statusFor(world, actor, effect.statusDefinitionId);
      const status = { statusDefinitionId: effect.statusDefinitionId, owner: actor, sourceInstanceId: context.ability.instanceId, stacks: (existing?.stacks ?? 0) + 1, duration: definition.defaultDuration, parameters: { ...(existing?.parameters ?? {}), ...(effect.parameters ?? {}) }, createdAtSequence: runtime.sequence + 1 };
      world = { ...world, statuses: [...world.statuses.filter((entry) => entry !== existing), status] };
      runtime = { ...runtime, statuses: world.statuses, sequence: runtime.sequence + 1 };
      events.push({ type: "STATUS_ADDED", statusDefinitionId: effect.statusDefinitionId, owner: actor, sourceInstanceId: context.ability.instanceId });
      break;
    }
    case "remove-status": {
      const existing = statusFor(world, actor, effect.statusDefinitionId);
      if (!existing) break;
      const amount = Math.max(1, Math.floor(effect.amount === undefined ? 1 : resolveScalar(effect.amount, context)));
      const stacks = existing.stacks - amount;
      world = { ...world, statuses: stacks > 0 ? world.statuses.map((entry) => entry === existing ? { ...entry, stacks } : entry) : world.statuses.filter((entry) => entry !== existing) };
      runtime = { ...runtime, statuses: world.statuses };
      if (stacks <= 0) events.push({ type: "STATUS_REMOVED", statusDefinitionId: effect.statusDefinitionId, owner: actor, reason: "consumed" });
      break;
    }
    case "replace-pending-draw": {
      if (!draw) throw new Error("replace-pending-draw outside draw event");
      if (draw.actor !== actor) throw new Error("Pending draw actor does not match effect target");
      const hand = world.hands[actor];
      const result = drawExactResultingTotal(world.shoe, hand, context.rng, resolveScalar(effect.policy.total, context));
      if (!result) {
        events.push({ type: "ABILITY_RESOLUTION_FAILED", instanceId: context.ability.instanceId, definitionId: context.ability.definitionId, ruleId: context.ruleId ?? "unknown-rule", reason: "No compatible card can produce the requested total" });
        break;
      }
      draw = { ...draw, replacement: result.card };
      world = { ...world, shoe: result.shoe };
      changed(effect.type);
      break;
    }
    case "add-to-pending-load": {
      if (!load) throw new Error("add-to-pending-load outside load event");
      if (load.actor !== actor) throw new Error("Pending load actor does not match effect target");
      load = addToPendingLoad(load, resolveScalar(effect.amount, context));
      changed(effect.type);
      break;
    }
    case "multiply-pending-load": {
      if (!load) throw new Error("multiply-pending-load outside load event");
      if (load.actor !== actor) throw new Error("Pending load actor does not match effect target");
      load = multiplyPendingLoad(load, resolveScalar(effect.factor, context));
      changed(effect.type);
      break;
    }
    case "cancel-pending-trigger": {
      if (!trigger) throw new Error("cancel-pending-trigger outside trigger event");
      if (trigger.actor !== actor) throw new Error("Pending trigger actor does not match effect target");
      if (!trigger.cancelled) {
        trigger = { ...trigger, cancelled: true, cancelSourceInstanceId: context.ability.instanceId };
        events.push({ type: "PENDING_EVENT_CANCELLED", eventId: trigger.id, sourceInstanceId: context.ability.instanceId });
      }
      break;
    }
  }
  return { world, pendingDraw: draw, pendingLoad: load, pendingTrigger: trigger, runtime, events };
}

export function applyEffects(effects: readonly Effect[], context: EffectContext, pending: { draw?: PendingDraw; load?: PendingLoad; trigger?: PendingTrigger } = {}): AbilityEffectResult {
  let result: AbilityEffectResult = { world: context.world, pendingDraw: pending.draw, pendingLoad: pending.load, pendingTrigger: pending.trigger, runtime: context.runtime, events: [] };
  for (const effect of effects) {
    const next = applyEffect(effect, { ...context, world: result.world, runtime: result.runtime }, { draw: result.pendingDraw, load: result.pendingLoad, trigger: result.pendingTrigger });
    result = { world: next.world, pendingDraw: next.pendingDraw, pendingLoad: next.pendingLoad, pendingTrigger: next.pendingTrigger, runtime: next.runtime, events: [...result.events, ...next.events] };
  }
  return result;
}
