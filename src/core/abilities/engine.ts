import { SeededRng } from "../rng/seeded";
import { allConditionsPass } from "./conditions";
import { applyEffects } from "./effects";
import { ABILITY_CATALOG_VERSION, getAbilityDefinition, getStatusDefinition, supportsAbilitySourceKind, type AbilityRegistry } from "./registry";
import { addAbilityInstance, canConsumeRule, consumeAbilityTriggerTtl, consumeRule, isAbilityInstanceExpired } from "./runtime";
import type { AbilityDefinition, AbilityDomainEvent, AbilityEventContext, AbilityEffectResult, AbilityInstance, AbilityRuntimeState, AbilityWorld, PendingBustCheck, PendingComparison, PendingDraw, PendingLoad, PendingTrigger } from "./types";

const MAX_ABILITY_DEPTH = 16;
export class AbilityResolutionError extends Error {
  readonly chain: readonly string[];
  readonly instanceId?: string;
  readonly definitionId?: string;
  readonly ruleId?: string;
  constructor(message: string, chain: readonly string[] = [], detail: { instanceId?: string; definitionId?: string; ruleId?: string } = {}) { super(message); this.name = "AbilityResolutionError"; this.chain = chain; this.instanceId = detail.instanceId; this.definitionId = detail.definitionId; this.ruleId = detail.ruleId; }
}

interface CollectedRule { readonly instance: AbilityInstance; readonly rule: import("./types").AbilityRule; readonly index: number; }
function collect(runtime: AbilityRuntimeState, trigger: AbilityEventContext["trigger"], directInstanceId?: string, registry?: AbilityRegistry): CollectedRule[] {
  const rules: CollectedRule[] = [];
  for (const instance of runtime.instances) {
    if (isAbilityInstanceExpired(instance)) continue;
    if (trigger === "on-ability-played" && instance.instanceId !== directInstanceId) continue;
    const definition = registry?.definitionsById[instance.definitionId] ?? getAbilityDefinition(instance.definitionId);
    if (!definition) throw new AbilityResolutionError(`Unknown ability definition: ${instance.definitionId}`, [], { instanceId: instance.instanceId, definitionId: instance.definitionId, ruleId: "definition-missing" });
    if (!supportsAbilitySourceKind(definition, instance.kind)) throw new AbilityResolutionError(`Ability instance kind ${instance.kind} is not supported by ${instance.definitionId}`, [], { instanceId: instance.instanceId, definitionId: instance.definitionId, ruleId: "source-kind-mismatch" });
    definition.rules.forEach((rule, index) => { if (rule.trigger === trigger) rules.push({ instance, rule, index }); });
  }
  for (const status of runtime.statuses) {
    const definition = registry?.statusesById[status.statusDefinitionId] ?? getStatusDefinition(status.statusDefinitionId);
    if (!definition) throw new AbilityResolutionError(`Unknown status definition: ${status.statusDefinitionId}`, [], { instanceId: status.sourceInstanceId, definitionId: status.statusDefinitionId, ruleId: "status-definition-missing" });
    const source = runtime.instances.find((instance) => instance.instanceId === status.sourceInstanceId);
    if (!source) throw new AbilityResolutionError(`Status source instance is missing: ${status.sourceInstanceId}`, [], { instanceId: status.sourceInstanceId, definitionId: status.statusDefinitionId, ruleId: "status-source-missing" });
    const sourceDefinition = registry?.definitionsById[source.definitionId] ?? getAbilityDefinition(source.definitionId);
    if (!sourceDefinition || !supportsAbilitySourceKind(sourceDefinition, source.kind)) throw new AbilityResolutionError(`Status source instance kind ${source.kind} is not supported by ${source.definitionId}`, [], { instanceId: source.instanceId, definitionId: source.definitionId, ruleId: "source-kind-mismatch" });
    definition.rules.forEach((rule, index) => { if (rule.trigger === trigger) rules.push({ instance: source, rule, index }); });
  }
  return rules.sort((left, right) => (left.rule.priority ?? 0) - (right.rule.priority ?? 0) || left.instance.createdAtSequence - right.instance.createdAtSequence || left.index - right.index);
}

export interface AbilityResolutionInput { readonly world: AbilityWorld; readonly runtime: AbilityRuntimeState; readonly event: AbilityEventContext; readonly pendingDraw?: PendingDraw; readonly pendingLoad?: PendingLoad; readonly pendingBust?: PendingBustCheck; readonly pendingTrigger?: PendingTrigger; readonly pendingComparison?: PendingComparison; readonly directInstanceId?: string; readonly depth?: number; readonly chain?: readonly string[]; readonly registry?: AbilityRegistry; readonly publishAdvice?: import("./effects").EffectContext["publishAdvice"]; }
export interface AbilityResolution extends AbilityEffectResult { readonly triggered: readonly string[]; }

export interface PlayAbilityInput extends Omit<AbilityResolutionInput, "event" | "directInstanceId"> {
  readonly instanceId: string;
  readonly owner: "player" | "opponent";
  readonly window: "owner-turn" | "owner-roulette-reaction";
}

function catalogMatches(runtime: AbilityRuntimeState, registry?: AbilityRegistry): boolean {
  return runtime.catalogVersion === (registry?.catalogVersion ?? ABILITY_CATALOG_VERSION);
}

function cardAndInstanceAgree(card: AbilityWorld["cards"][number] | undefined, instance: AbilityInstance | undefined): boolean {
  return !card || !instance || (card.definitionId === instance.definitionId && card.owner === instance.owner && card.kind === instance.kind);
}

export function isAbilityBlockedByStatus(world: AbilityWorld, owner: "player" | "opponent", definition: AbilityDefinition, registry?: AbilityRegistry): boolean {
  return world.statuses.some((status) => status.owner === owner && status.stacks > 0 && ((registry?.statusesById[status.statusDefinitionId] ?? getStatusDefinition(status.statusDefinitionId))?.blocksAbilityTags ?? []).some((tag) => definition.tags.includes(tag)));
}

export function canPlayAbility(input: PlayAbilityInput): boolean {
  try {
    if (!catalogMatches(input.runtime, input.registry)) return false;
    const card = input.world.cards.find((entry) => entry.instanceId === input.instanceId);
    const instance = input.runtime.instances.find((entry) => entry.instanceId === input.instanceId);
    if (!cardAndInstanceAgree(card, instance)) return false;
    const source = card ?? instance;
    if (!source || source.owner !== input.owner) return false;
    const definition = input.registry?.definitionsById[source.definitionId] ?? getAbilityDefinition(source.definitionId);
    if (!definition || !supportsAbilitySourceKind(definition, source.kind) || definition.activation.type !== "action" || !definition.activation.windows.includes(input.window)) return false;
    if (definition.activation.consume === "card" && !card) return false;
    if (isAbilityBlockedByStatus(input.world, input.owner, definition, input.registry)) return false;
    const ability: AbilityInstance = instance ?? { ...card!, createdAtSequence: input.runtime.sequence + 1, parameters: {} };
    const event = { trigger: "on-ability-played" as const, sourceEventId: `ability:${input.instanceId}`, eventActor: input.owner };
    if (!allConditionsPass(definition.activation.availability, { world: input.world, ability, event })) return false;
    // Mirror the real pre-resolution state with a cloned RNG snapshot. This
    // validates effect context, callbacks and targets before exposing an
    // action; the returned state is deliberately discarded.
    const runtime = addAbilityInstance(input.runtime, ability);
    const world = definition.activation.consume === "card"
      ? { ...input.world, cards: input.world.cards.filter((entry) => entry.instanceId !== input.instanceId) }
      : input.world;
    const dryRun = resolveAbilityEvent({ ...input, world, runtime, event, directInstanceId: ability.instanceId });
    return dryRun.triggered.length > 0;
  } catch { return false; }
}

/** Validate and atomically consume a card before resolving its direct rules. */
export function playAbility(input: PlayAbilityInput): AbilityResolution {
  if (!catalogMatches(input.runtime, input.registry)) throw new AbilityResolutionError(`Ability catalog mismatch: runtime=${input.runtime.catalogVersion}, registry=${input.registry?.catalogVersion ?? ABILITY_CATALOG_VERSION}`);
  const card = input.world.cards.find((entry) => entry.instanceId === input.instanceId);
  const instance = input.runtime.instances.find((entry) => entry.instanceId === input.instanceId);
  if (!cardAndInstanceAgree(card, instance)) throw new AbilityResolutionError("Ability card and runtime instance disagree");
  const source = card ?? instance;
  if (!source || source.owner !== input.owner) throw new AbilityResolutionError("Ability card is not owned or is unavailable");
  const definition = input.registry?.definitionsById[source.definitionId] ?? getAbilityDefinition(source.definitionId);
  if (!definition || !supportsAbilitySourceKind(definition, source.kind) || definition.activation.type !== "action" || !definition.activation.windows.includes(input.window)) throw new AbilityResolutionError("Ability is not available in this action window");
  if (definition.activation.consume === "card" && !card) throw new AbilityResolutionError("Ability card is not owned or is unavailable");
  if (isAbilityBlockedByStatus(input.world, input.owner, definition, input.registry)) throw new AbilityResolutionError("A status blocks this ability tag");
  const ability: AbilityInstance = instance ?? { ...card!, createdAtSequence: input.runtime.sequence + 1, parameters: {} };
  const availabilityContext = { world: input.world, ability, event: { trigger: "on-ability-played" as const, sourceEventId: `ability:${input.instanceId}`, eventActor: input.owner } };
  if (!allConditionsPass(definition.activation.availability, availabilityContext)) throw new AbilityResolutionError("Ability availability conditions are not satisfied");
  const runtime = addAbilityInstance(input.runtime, ability);
  const world = definition.activation.consume === "card" ? { ...input.world, cards: input.world.cards.filter((entry) => entry.instanceId !== input.instanceId) } : input.world;
  const result = resolveAbilityEvent({ ...input, world, runtime, directInstanceId: ability.instanceId, event: { trigger: "on-ability-played", sourceEventId: `ability:${input.instanceId}`, eventActor: input.owner } });
  if (result.triggered.length === 0) throw new AbilityResolutionError("Ability has no triggered direct rules");
  return { ...result, events: [{ type: "ABILITY_PLAYED", instanceId: ability.instanceId, definitionId: ability.definitionId, owner: ability.owner }, ...result.events] };
}

export function resolveAbilityEvent(input: AbilityResolutionInput): AbilityResolution {
  const depth = input.depth ?? 0;
  if (depth > MAX_ABILITY_DEPTH) throw new AbilityResolutionError("Ability event nesting depth exceeded 16", input.chain ?? []);
  if (!catalogMatches(input.runtime, input.registry)) throw new AbilityResolutionError(`Ability catalog mismatch: runtime=${input.runtime.catalogVersion}, registry=${input.registry?.catalogVersion ?? ABILITY_CATALOG_VERSION}`, input.chain ?? []);
  let world = input.world;
  // Event-scoped limits are keyed by sourceEventId; reducers clear old event
  // keys opportunistically while turn/round scopes clear at their boundaries.
  let runtime = input.runtime;
  world = { ...world, statuses: runtime.statuses };
  let pendingDraw = input.pendingDraw;
  let pendingLoad = input.pendingLoad;
  let pendingBust = input.pendingBust;
  let pendingTrigger = input.pendingTrigger;
  let pendingComparison = input.pendingComparison;
  let events: readonly AbilityDomainEvent[] = [];
  const triggered: string[] = [];
  for (const entry of collect(runtime, input.event.trigger, input.directInstanceId, input.registry)) {
    const liveInstance = runtime.instances.find((instance) => instance.instanceId === entry.instance.instanceId);
    if (!liveInstance || isAbilityInstanceExpired(liveInstance)) continue;
    const context = { world, ability: liveInstance, event: { ...input.event, pendingDraw, pendingBust } };
    if (!allConditionsPass(entry.rule.conditions, context)) continue;
    if (!canConsumeRule(runtime, entry.instance.instanceId, entry.rule.id, entry.rule.limit, input.event.sourceEventId)) continue;
    try {
      const abilityRng = SeededRng.fromSnapshot(runtime.rng);
      const result = applyEffects(entry.rule.effects, { ...context, rng: abilityRng, runtime, registry: input.registry, ruleId: entry.rule.id, publishAdvice: input.publishAdvice }, { draw: pendingDraw, load: pendingLoad, bust: pendingBust, trigger: pendingTrigger, comparison: pendingComparison });
      world = result.world;
      pendingDraw = result.pendingDraw;
      pendingLoad = result.pendingLoad;
      pendingBust = result.pendingBust;
      pendingTrigger = result.pendingTrigger;
      pendingComparison = result.pendingComparison;
      runtime = { ...result.runtime, rng: abilityRng.snapshot() };
      runtime = consumeRule(runtime, entry.instance.instanceId, entry.rule.id, entry.rule.limit, input.event.sourceEventId);
      const ttl = consumeAbilityTriggerTtl(runtime, world.cards, entry.instance.instanceId, input.registry);
      runtime = ttl.runtime;
      world = { ...world, cards: ttl.cards, statuses: ttl.runtime.statuses };
      events = [
        ...events,
        ...result.events,
        { type: "ABILITY_TRIGGERED", instanceId: entry.instance.instanceId, definitionId: entry.instance.definitionId, ruleId: entry.rule.id, owner: entry.instance.owner },
        ...ttl.expiredStatuses.map((status) => ({ type: "STATUS_REMOVED" as const, statusDefinitionId: status.statusDefinitionId, owner: status.owner, reason: "expired" as const })),
        ...ttl.expired.map((instance) => ({ type: "ABILITY_EXPIRED" as const, instanceId: instance.instanceId, definitionId: instance.definitionId, owner: instance.owner, reason: "triggers" as const }))
      ];
      triggered.push(`${entry.instance.instanceId}:${entry.rule.id}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new AbilityResolutionError(`${entry.instance.instanceId}/${entry.rule.id}: ${reason}`, [...triggered, `${entry.instance.instanceId}:${entry.rule.id}`], { instanceId: entry.instance.instanceId, definitionId: entry.instance.definitionId, ruleId: entry.rule.id });
    }
  }
  return { world, pendingDraw, pendingLoad, pendingBust, pendingTrigger, pendingComparison, runtime, events, triggered };
}

export { MAX_ABILITY_DEPTH };
