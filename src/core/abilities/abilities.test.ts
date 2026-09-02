import { describe, expect, it } from "vitest";
import { createHand } from "../blackjack/hand";
import { createCard } from "../blackjack/card";
import { createRng } from "../rng/seeded";
import { AbilityDefinitionSchema } from "./schema";
import { ABILITY_DEFINITIONS, createAbilityRegistry, getAbilityDefinition, validateAbilityBinding } from "./registry";
import { canConsumeRule, clearCounters, clearEventCounters, consumeRule, createAbilityRuntime, expireStatuses, garbageCollectAbilityInstances } from "./runtime";
import { AbilityResolutionError, MAX_ABILITY_DEPTH, canPlayAbility, playAbility, resolveAbilityEvent } from "./engine";
import type { AbilityInstance, AbilityRuntimeState, AbilityStatus, AbilityWorld, SkillCardInstance } from "./types";

const gun = { capacity: 6, bullets: 2 };
function world(cards: readonly SkillCardInstance[] = []): AbilityWorld {
  return {
    hands: { player: createHand([createCard("spades", "10")]), opponent: createHand([createCard("hearts", "9")]) },
    guns: { player: gun, opponent: { ...gun, bullets: 0 } },
    shoe: { cards: [], cursor: 0, shuffleIndex: 1 }, cards, statuses: []
  };
}

function mechanic(definitionId: string, owner: "player" | "opponent", instanceId = `${definitionId}-${owner}`, createdAtSequence = 1): AbilityInstance {
  return { kind: "character-mechanic", definitionId, owner, instanceId, createdAtSequence, parameters: {} };
}

const relativeFixture = {
  id: "relative-load-adjustment", name: "relative", description: "fixture", sourceKind: "character-mechanic",
  activation: { type: "automatic" }, tags: [], rules: [
    { id: "owner-failed-load", trigger: "before-bullet-load", conditions: [{ type: "round-penalty-target-is", target: "owner" }], effects: [{ type: "add-to-pending-load", target: "owner", amount: -1 }] },
    { id: "rival-bust-load", trigger: "before-bullet-load", conditions: [{ type: "round-reason-is", value: "bust" }, { type: "round-penalty-target-is", target: "rival" }], effects: [{ type: "add-to-pending-load", target: "rival", amount: 1 }] }
  ]
} as const;

describe("ability schemas and immutable registry", () => {
  it("applies parameter defaults and rejects missing, unknown, and out-of-range values", () => {
    const registry = createAbilityRegistry([{
      id: "parameter-fixture", name: "parameter", description: "fixture", sourceKind: "character-mechanic",
      parameters: {
        amount: { type: "number", minimum: -1, maximum: 1, default: -1 },
        required: { type: "boolean" }
      },
      activation: { type: "passive" }, rules: [], tags: []
    }]);
    expect(validateAbilityBinding({ definitionId: "parameter-fixture", enabled: true, parameters: { required: true } }, registry).parameters).toEqual({ amount: -1, required: true });
    expect(() => validateAbilityBinding({ definitionId: "parameter-fixture", enabled: true, parameters: {} }, registry)).toThrow(/Missing parameter/);
    expect(() => validateAbilityBinding({ definitionId: "parameter-fixture", enabled: true, parameters: { required: true, amount: 2 } }, registry)).toThrow(/Invalid parameter/);
    expect(() => validateAbilityBinding({ definitionId: "parameter-fixture", enabled: true, parameters: { required: true, extra: 1 } }, registry)).toThrow(/Unknown parameter/);
  });

  it("registers six player skills and three reusable character fixtures as deeply frozen data", () => {
    expect(ABILITY_DEFINITIONS).toHaveLength(9);
    expect(ABILITY_DEFINITIONS.filter((definition) => definition.sourceKind === "player-skill")).toHaveLength(6);
    expect(ABILITY_DEFINITIONS.filter((definition) => definition.sourceKind === "character-mechanic")).toHaveLength(3);
    expect(ABILITY_DEFINITIONS.every((definition) => definition.rules.length > 0)).toBe(true);
    expect(Object.isFrozen(ABILITY_DEFINITIONS[0]?.rules[0]?.effects[0])).toBe(true);
  });

  it("rejects unknown triggers, conditions, effects, selectors, and extra fields", () => {
    const base = {
      id: "schema-fixture", name: "schema", description: "fixture", sourceKind: "character-mechanic",
      activation: { type: "passive" }, tags: [], rules: [{ id: "rule", trigger: "on-match-created", effects: [{ type: "draw-skill-cards", target: "owner", amount: 1 }] }]
    };
    expect(AbilityDefinitionSchema.safeParse(base).success).toBe(true);
    expect(AbilityDefinitionSchema.safeParse({ ...base, rules: [{ ...base.rules[0], trigger: "unknown-trigger" }] }).success).toBe(false);
    expect(AbilityDefinitionSchema.safeParse({ ...base, rules: [{ ...base.rules[0], conditions: [{ type: "unknown-condition" }] }] }).success).toBe(false);
    expect(AbilityDefinitionSchema.safeParse({ ...base, rules: [{ ...base.rules[0], effects: [{ type: "unknown-effect", target: "owner" }] }] }).success).toBe(false);
    expect(AbilityDefinitionSchema.safeParse({ ...base, rules: [{ ...base.rules[0], effects: [{ type: "draw-skill-cards", target: "player", amount: 1 }] }] }).success).toBe(false);
    expect(AbilityDefinitionSchema.safeParse({ ...base, executable: "doSomething()" }).success).toBe(false);
    expect(AbilityDefinitionSchema.safeParse({ ...base, sourceKind: "player-skill", activation: { type: "action", windows: ["owner-turn"], consume: "none" } }).success).toBe(false);
    expect(AbilityDefinitionSchema.safeParse({ ...base, activation: { type: "action", windows: ["owner-turn"], consume: "card" } }).success).toBe(false);
  });

  it("rejects unresolved parameter, status, and ability references while building a registry", () => {
    const definition = (id: string, effect: unknown, availability?: readonly unknown[]) => ({
      id, name: "reference", description: "fixture", sourceKind: "character-mechanic",
      activation: availability ? { type: "action", windows: ["owner-turn"], consume: "none", availability } : { type: "passive" },
      rules: [{ id: "rule", trigger: "on-match-created", effects: [effect] }], tags: []
    });
    expect(() => createAbilityRegistry([definition("reference-parameter", { type: "draw-skill-cards", target: "owner", amount: { type: "parameter", key: "missing" } })])).toThrow(/Unknown parameter/);
    expect(() => createAbilityRegistry([definition("reference-status", { type: "add-status", target: "owner", statusDefinitionId: "missing-status" })])).toThrow(/Unknown status/);
    expect(() => createAbilityRegistry([definition("reference-ability", { type: "draw-skill-cards", target: "owner", amount: 1 }, [{ type: "owner-has-card", abilityId: "missing-ability" }])])).toThrow(/Unknown ability/);
  });
});

describe("generic resolution and lifecycle", () => {
  it("uses owner/rival relative semantics for both actors", () => {
    const registry = createAbilityRegistry([relativeFixture]);
    for (const owner of ["player", "opponent"] as const) {
      const instance = mechanic(relativeFixture.id, owner);
      const runtime = { ...createAbilityRuntime(createRng(`ability-${owner}`).snapshot()), instances: [instance] };
      const ownerLoad = resolveAbilityEvent({ world: world(), runtime, registry, event: { trigger: "before-bullet-load", sourceEventId: `${owner}-owner`, roundOutcome: { reason: "comparison", penaltyTarget: owner } }, pendingLoad: { id: "load-owner", actor: owner, amount: 1, reason: "comparison" } });
      expect(ownerLoad.pendingLoad?.amount).toBe(0);
      const rival = owner === "player" ? "opponent" : "player";
      const rivalLoad = resolveAbilityEvent({ world: world(), runtime, registry, event: { trigger: "before-bullet-load", sourceEventId: `${owner}-rival`, roundOutcome: { reason: "bust", penaltyTarget: rival } }, pendingLoad: { id: "load-rival", actor: rival, amount: 1, reason: "bust" } });
      expect(rivalLoad.pendingLoad?.amount).toBe(2);
    }
  });

  it("orders rules by priority, instance creation sequence, and rule index", () => {
    const ordering = {
      id: "ordering-fixture", name: "ordering", description: "fixture", sourceKind: "character-mechanic", activation: { type: "passive" }, tags: [],
      rules: [
        { id: "late-a", trigger: "before-bullet-load", priority: 10, effects: [{ type: "add-to-pending-load", target: "owner", amount: 1 }] },
        { id: "first", trigger: "before-bullet-load", priority: -1, effects: [{ type: "add-to-pending-load", target: "owner", amount: 1 }] },
        { id: "late-b", trigger: "before-bullet-load", priority: 10, effects: [{ type: "add-to-pending-load", target: "owner", amount: 1 }] }
      ]
    } as const;
    const registry = createAbilityRegistry([ordering]);
    const instances = [mechanic(ordering.id, "player", "created-second", 2), mechanic(ordering.id, "player", "created-first", 1)];
    const runtime = { ...createAbilityRuntime(createRng("ordering").snapshot()), instances };
    const result = resolveAbilityEvent({ world: world(), runtime, registry, event: { trigger: "before-bullet-load", sourceEventId: "ordering", roundOutcome: { reason: "comparison", penaltyTarget: "player" } }, pendingLoad: { id: "ordering", actor: "player", amount: 0, reason: "comparison" } });
    expect(result.events.filter((event) => event.type === "ABILITY_TRIGGERED").map((event) => `${event.instanceId}:${event.ruleId}`)).toEqual([
      "created-first:first", "created-second:first",
      "created-first:late-a", "created-first:late-b",
      "created-second:late-a", "created-second:late-b"
    ]);
  });

  it("enforces and clears event, turn, round, and match counters", () => {
    const limit = { perEvent: 1, perTurn: 2, perRound: 3, perMatch: 4 } as const;
    let runtime = createAbilityRuntime(createRng("limits").snapshot());
    expect(canConsumeRule(runtime, "instance", "rule", limit, "event-a")).toBe(true);
    runtime = consumeRule(runtime, "instance", "rule", limit, "event-a");
    expect(canConsumeRule(runtime, "instance", "rule", limit, "event-a")).toBe(false);
    runtime = clearEventCounters(runtime, "event-a");
    expect(canConsumeRule(runtime, "instance", "rule", limit, "event-b")).toBe(true);
    runtime = consumeRule(runtime, "instance", "rule", limit, "event-b");
    runtime = clearEventCounters(runtime, "event-b");
    expect(canConsumeRule(runtime, "instance", "rule", limit, "event-c")).toBe(false);
    runtime = clearCounters(runtime, "turn");
    expect(canConsumeRule(runtime, "instance", "rule", limit, "event-c")).toBe(true);
    runtime = clearCounters(clearCounters(runtime, "round"), "match");
    expect(canConsumeRule(runtime, "instance", "rule", limit, "event-c")).toBe(true);
  });

  it("expires only the requested duration and garbage-collects unreferenced consumed actions and counters", () => {
    const source: AbilityInstance = { kind: "player-skill", definitionId: "hunter-instinct", owner: "player", instanceId: "consumed", createdAtSequence: 1, parameters: {} };
    const statuses: AbilityStatus[] = (["turn", "round", "match", "until-consumed"] as const).map((duration, index) => ({ statusDefinitionId: "night-queen-armed", owner: "player", sourceInstanceId: source.instanceId, stacks: 1, duration, parameters: {}, createdAtSequence: index + 1 }));
    let runtime: AbilityRuntimeState = { ...createAbilityRuntime(createRng("lifecycle").snapshot()), instances: [source], statuses, counters: { "consumed:rule:match": 1 } };
    expect(expireStatuses(runtime, "turn").statuses.map((status) => status.duration)).toEqual(["round", "match", "until-consumed"]);
    runtime = garbageCollectAbilityInstances(runtime, []);
    expect(runtime.instances).toHaveLength(1);
    runtime = garbageCollectAbilityInstances({ ...runtime, statuses: [] }, []);
    expect(runtime.instances).toHaveLength(0);
    expect(runtime.counters).toEqual({});
  });

  it("preflights direct effects without consuming a card and resolves valid actions atomically", () => {
    const invalid = {
      id: "invalid-action-context", name: "invalid", description: "fixture", sourceKind: "player-skill",
      activation: { type: "action", windows: ["owner-turn"], consume: "card" }, tags: [],
      rules: [{ id: "requires-draw", trigger: "on-ability-played", effects: [{ type: "replace-pending-draw", target: "owner", policy: { type: "exact-resulting-total", total: 21, fallback: "synthesize-compatible-card" } }] }]
    } as const;
    const registry = createAbilityRegistry([invalid]);
    const card: SkillCardInstance = { kind: "player-skill", definitionId: invalid.id, owner: "player", instanceId: "invalid-card" };
    const instance: AbilityInstance = { ...card, createdAtSequence: 1, parameters: {} };
    const runtime = { ...createAbilityRuntime(createRng("invalid-action").snapshot()), instances: [instance] };
    const input = { world: world([card]), runtime, registry, instanceId: card.instanceId, owner: "player" as const, window: "owner-turn" as const };
    expect(canPlayAbility(input)).toBe(false);
    expect(() => playAbility(input)).toThrow(AbilityResolutionError);
    expect(input.world.cards).toEqual([card]);

    const hunterCard: SkillCardInstance = { kind: "player-skill", definitionId: "hunter-instinct", owner: "player", instanceId: "hunter-card" };
    const hunterInstance: AbilityInstance = { ...hunterCard, createdAtSequence: 1, parameters: {} };
    const hunterInput = { world: world([hunterCard]), runtime: { ...createAbilityRuntime(createRng("hunter-action").snapshot()), instances: [hunterInstance] }, instanceId: hunterCard.instanceId, owner: "player" as const, window: "owner-turn" as const, publishAdvice: () => "hit" as const };
    expect(canPlayAbility(hunterInput)).toBe(true);
    const played = playAbility(hunterInput);
    expect(played.world.cards).toEqual([]);
    expect(played.events).toEqual(expect.arrayContaining([expect.objectContaining({ type: "ABILITY_PLAYED", instanceId: hunterCard.instanceId }), expect.objectContaining({ type: "ABILITY_TRIGGERED", ruleId: "publish-advice" })]));
  });

  it("keeps the original draw, consumes Night Queen status, and records the exact failing rule when 21 is impossible", () => {
    const instance: AbilityInstance = { kind: "player-skill", definitionId: "night-queen", owner: "player", instanceId: "night-queen-test", createdAtSequence: 1, parameters: {} };
    const runtime = { ...createAbilityRuntime(createRng("fallback").snapshot()), instances: [instance], statuses: [{ statusDefinitionId: "night-queen-armed", owner: "player" as const, sourceInstanceId: instance.instanceId, stacks: 1, duration: "until-consumed" as const, parameters: {}, createdAtSequence: 1 }] };
    const impossible = { ...world(), hands: { ...world().hands, player: createHand([createCard("spades", "K"), createCard("hearts", "K"), createCard("clubs", "K")]) } };
    const original = createCard("diamonds", "2");
    const result = resolveAbilityEvent({ world: impossible, runtime, event: { trigger: "before-card-draw", sourceEventId: "draw", eventActor: "player" }, pendingDraw: { id: "draw", actor: "player", card: original } });
    expect(result.pendingDraw).toEqual({ id: "draw", actor: "player", card: original });
    expect(result.events).toContainEqual(expect.objectContaining({ type: "ABILITY_RESOLUTION_FAILED", definitionId: "night-queen", ruleId: "guarantee-twenty-one" }));
    expect(result.events).toContainEqual(expect.objectContaining({ type: "STATUS_REMOVED", reason: "consumed" }));
    expect(result.runtime.statuses).toHaveLength(0);
  });

  it("rejects catalog mismatches and reports the supplied chain beyond the nesting boundary", () => {
    const mismatched = { ...createAbilityRuntime(createRng("catalog").snapshot()), catalogVersion: "future-catalog" };
    expect(() => resolveAbilityEvent({ world: world(), runtime: mismatched, event: { trigger: "on-match-created", sourceEventId: "catalog" } })).toThrow(/catalog mismatch/i);
    try {
      resolveAbilityEvent({ world: world(), runtime: createAbilityRuntime(createRng("depth").snapshot()), event: { trigger: "on-match-created", sourceEventId: "depth" }, depth: MAX_ABILITY_DEPTH + 1, chain: ["a:rule", "b:rule"] });
      throw new Error("expected nesting failure");
    } catch (error) {
      expect(error).toBeInstanceOf(AbilityResolutionError);
      expect((error as AbilityResolutionError).chain).toEqual(["a:rule", "b:rule"]);
    }
  });

  it("keeps canonical lookups independent of isolated test registries", () => {
    createAbilityRegistry([relativeFixture], [], "isolated-test-catalog");
    expect(getAbilityDefinition("early-preparation")?.sourceKind).toBe("player-skill");
    expect(getAbilityDefinition(relativeFixture.id)).toBeUndefined();
  });
});
