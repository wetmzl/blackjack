import type { RngSnapshot } from "../rng/seeded";
import { ABILITY_CATALOG_VERSION } from "./registry";
import type { AbilityInstance, AbilityRuntimeState, AbilityStatus, RuleLimit, SkillCardInstance } from "./types";
import type { AbilityRegistry } from "./registry";
import { getAbilityDefinition } from "./registry";

export function createAbilityRuntime(rng: RngSnapshot, catalogVersion: string = ABILITY_CATALOG_VERSION): AbilityRuntimeState {
  return { instances: [], statuses: [], counters: {}, sequence: 0, catalogVersion, rng };
}

export function addAbilityInstance(runtime: AbilityRuntimeState, instance: AbilityInstance): AbilityRuntimeState {
  if (runtime.instances.some((entry) => entry.instanceId === instance.instanceId)) return runtime;
  return { ...runtime, instances: [...runtime.instances, instance], sequence: Math.max(runtime.sequence, instance.createdAtSequence) };
}

export function addAbilityStatus(runtime: AbilityRuntimeState, status: AbilityStatus): AbilityRuntimeState {
  return { ...runtime, statuses: [...runtime.statuses, status], sequence: Math.max(runtime.sequence, status.createdAtSequence) };
}

export function counterKey(instanceId: string, ruleId: string, scope: "event" | "turn" | "round" | "match", eventId?: string): string { return `${instanceId}:${ruleId}:${scope}${scope === "event" && eventId ? `:${eventId}` : ""}`; }
export function getCounter(runtime: AbilityRuntimeState, key: string): number { return runtime.counters[key] ?? 0; }
export function incrementCounter(runtime: AbilityRuntimeState, key: string): AbilityRuntimeState { return { ...runtime, counters: { ...runtime.counters, [key]: getCounter(runtime, key) + 1 } }; }
export function canConsumeRule(runtime: AbilityRuntimeState, instanceId: string, ruleId: string, limit: RuleLimit | undefined, eventId?: string): boolean {
  if (!limit) return true;
  return (["perEvent", "perTurn", "perRound", "perMatch"] as const).every((name) => {
    const max = limit[name];
    return max === undefined || getCounter(runtime, counterKey(instanceId, ruleId, name.slice(3).toLowerCase() as "event" | "turn" | "round" | "match", eventId)) < max;
  });
}
export function consumeRule(runtime: AbilityRuntimeState, instanceId: string, ruleId: string, limit: RuleLimit | undefined, eventId?: string): AbilityRuntimeState {
  if (!limit) return runtime;
  let next = runtime;
  for (const [name, max] of Object.entries(limit)) {
    if (max === undefined) continue;
    const scope = name.slice(3).toLowerCase() as "event" | "turn" | "round" | "match";
    next = incrementCounter(next, counterKey(instanceId, ruleId, scope, eventId));
  }
  return next;
}
export function clearCounters(runtime: AbilityRuntimeState, scope: "event" | "turn" | "round" | "match"): AbilityRuntimeState {
  const marker = `:${scope}`;
  return { ...runtime, counters: Object.fromEntries(Object.entries(runtime.counters).filter(([key]) => !(key.includes(`${marker}:`) || key.endsWith(marker)))) };
}
/** Event limits are transaction-local; discard their keys once the event is committed. */
export function clearEventCounters(runtime: AbilityRuntimeState, sourceEventId: string): AbilityRuntimeState {
  const suffix = `:event:${sourceEventId}`;
  return { ...runtime, counters: Object.fromEntries(Object.entries(runtime.counters).filter(([key]) => !key.endsWith(suffix))) };
}
export function expireStatuses(runtime: AbilityRuntimeState, duration: "turn" | "round" | "match"): AbilityRuntimeState {
  return { ...runtime, statuses: runtime.statuses.filter((status) => status.duration !== duration) };
}

/** Remove consumed action instances while retaining cards, status sources and passive mechanics. */
export function garbageCollectAbilityInstances(runtime: AbilityRuntimeState, cards: readonly SkillCardInstance[], registry?: AbilityRegistry): AbilityRuntimeState {
  const cardIds = new Set(cards.map((card) => card.instanceId));
  const statusSources = new Set(runtime.statuses.map((status) => status.sourceInstanceId));
  const instances = runtime.instances.filter((instance) => {
    if (cardIds.has(instance.instanceId) || statusSources.has(instance.instanceId)) return true;
    const definition = registry?.definitionsById[instance.definitionId] ?? getAbilityDefinition(instance.definitionId);
    if (!definition) return true;
    return definition.activation.type !== "action" || definition.activation.consume === "none";
  });
  if (instances.length === runtime.instances.length) return runtime;
  const retainedIds = new Set(instances.map((instance) => instance.instanceId));
  const knownIds = runtime.instances.map((instance) => instance.instanceId).sort((left, right) => right.length - left.length);
  const counters = Object.fromEntries(Object.entries(runtime.counters).filter(([key]) => {
    const ownerId = knownIds.find((instanceId) => key.startsWith(`${instanceId}:`));
    return ownerId === undefined || retainedIds.has(ownerId);
  }));
  return { ...runtime, instances, counters };
}
