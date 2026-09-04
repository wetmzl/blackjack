import { describe, expect, it } from "vitest";
import { createHand } from "../blackjack/hand";
import { createCard, createDerivedCard } from "../blackjack/card";
import { createRng } from "../rng/seeded";
import { AbilityDefinitionSchema, StatusDefinitionSchema } from "./schema";
import { ABILITY_DEFINITIONS, createAbilityRegistry, getAbilityDefinition, instantiateAbility, supportsAbilitySourceKind, validateAbilityBinding } from "./registry";
import { advanceRoundAbilityTtls, canConsumeRule, clearCounters, clearEventCounters, consumeRule, createAbilityRuntime, expireOwnerActionStatuses, expireStatuses, garbageCollectAbilityInstances } from "./runtime";
import { AbilityResolutionError, MAX_ABILITY_DEPTH, canPlayAbility, playAbility, resolveAbilityEvent } from "./engine";
import { drawExactResultingTotal, replaceLastHandCard } from "./card-zone-adapter";
import { evaluateCondition } from "./conditions";
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
  return { kind: "ai-skill", definitionId, owner, instanceId, createdAtSequence, parameters: {} };
}

const relativeFixture = {
  id: "relative-load-adjustment", name: "relative", description: "fixture", sourceKind: "ai-skill", primaryDomain: "rule-control",
  activation: { type: "automatic" }, tags: ["test-fixture"], rules: [
    { id: "owner-failed-load", trigger: "before-bullet-load", conditions: [{ type: "round-penalty-target-is", target: "owner" }], effects: [{ type: "add-to-pending-load", target: "owner", amount: -1 }] },
    { id: "rival-bust-load", trigger: "before-bullet-load", conditions: [{ type: "round-reason-is", value: "bust" }, { type: "round-penalty-target-is", target: "rival" }], effects: [{ type: "add-to-pending-load", target: "rival", amount: 1 }] }
  ]
} as const;

describe("ability schemas and immutable registry", () => {
  it("applies parameter defaults and rejects missing, unknown, and out-of-range values", () => {
    const registry = createAbilityRegistry([{
      id: "parameter-fixture", name: "parameter", description: "fixture", sourceKind: "ai-skill", primaryDomain: "rule-control",
      parameters: {
        amount: { type: "number", minimum: -1, maximum: 1, default: -1 },
        required: { type: "boolean" }
      },
      activation: { type: "passive" }, ttl: { type: "rounds", amount: 2 }, rules: [], tags: ["test-fixture"]
    }]);
    expect(validateAbilityBinding({ definitionId: "parameter-fixture", enabled: true, parameters: { required: true } }, registry).parameters).toEqual({ amount: -1, required: true });
    expect(() => validateAbilityBinding({ definitionId: "parameter-fixture", enabled: true, parameters: {} }, registry)).toThrow(/Missing parameter/);
    expect(() => validateAbilityBinding({ definitionId: "parameter-fixture", enabled: true, parameters: { required: true, amount: 2 } }, registry)).toThrow(/Invalid parameter/);
    expect(() => validateAbilityBinding({ definitionId: "parameter-fixture", enabled: true, parameters: { required: true, extra: 1 } }, registry)).toThrow(/Unknown parameter/);
  });

  it("registers three disjoint ability domains as deeply frozen data", () => {
    expect(ABILITY_DEFINITIONS).toHaveLength(19);
    expect(ABILITY_DEFINITIONS.filter((definition) => definition.sourceKind === "player-skill")).toHaveLength(8);
    expect(ABILITY_DEFINITIONS.filter((definition) => definition.sourceKind === "ai-skill")).toHaveLength(10);
    expect(ABILITY_DEFINITIONS.filter((definition) => definition.sourceKind === "talent")).toHaveLength(1);
    expect(getAbilityDefinition("silent-drizzle")).toMatchObject({ name: "细雨无声", activation: { type: "automatic" } });
    expect(ABILITY_DEFINITIONS.filter((definition) => definition.sourceKind !== "talent").every((definition) => definition.rules.length > 0)).toBe(true);
    expect(Object.isFrozen(ABILITY_DEFINITIONS[0]?.rules[0]?.effects[0])).toBe(true);
  });

  it("rejects unknown triggers, conditions, effects, selectors, and extra fields", () => {
    const base = {
      id: "schema-fixture", name: "schema", description: "fixture", sourceKind: "ai-skill", primaryDomain: "rule-control",
      activation: { type: "passive" }, ttl: { type: "rounds", amount: 2 }, tags: ["test-fixture"], rules: [{ id: "rule", trigger: "on-match-created", effects: [{ type: "draw-skill-cards", target: "owner", amount: 1 }] }]
    };
    expect(AbilityDefinitionSchema.safeParse(base).success).toBe(true);
    expect(AbilityDefinitionSchema.safeParse({ ...base, profileLore: "档案中的文学化技能描写。" }).success).toBe(true);
    expect(AbilityDefinitionSchema.safeParse({ ...base, profileLore: "档案", profileLoreExtra: true }).success).toBe(false);
    expect(AbilityDefinitionSchema.safeParse({ ...base, rules: [{ ...base.rules[0], conditions: [{ type: "hand-rank-has-suit-partner", target: "owner", rank: "Q" }] }] }).success).toBe(true);
    expect(AbilityDefinitionSchema.safeParse({ ...base, rules: [{ ...base.rules[0], conditions: [{ type: "hand-rank-has-suit-partner", target: "owner", rank: "Q", extra: true }] }] }).success).toBe(false);
    expect(AbilityDefinitionSchema.safeParse({ ...base, rules: [{ ...base.rules[0], conditions: [{ type: "hand-rank-has-suit-partner", target: "owner", rank: "joker" }] }] }).success).toBe(false);
    expect(AbilityDefinitionSchema.safeParse({ ...base, rules: [{ ...base.rules[0], trigger: "unknown-trigger" }] }).success).toBe(false);
    expect(AbilityDefinitionSchema.safeParse({ ...base, rules: [{ ...base.rules[0], conditions: [{ type: "unknown-condition" }] }] }).success).toBe(false);
    expect(AbilityDefinitionSchema.safeParse({ ...base, rules: [{ ...base.rules[0], effects: [{ type: "unknown-effect", target: "owner" }] }] }).success).toBe(false);
    expect(AbilityDefinitionSchema.safeParse({ ...base, rules: [{ ...base.rules[0], effects: [{ type: "draw-skill-cards", target: "player", amount: 1 }] }] }).success).toBe(false);
    expect(AbilityDefinitionSchema.safeParse({ ...base, executable: "doSomething()" }).success).toBe(false);
    expect(AbilityDefinitionSchema.safeParse({ ...base, sourceKind: "player-skill", primaryDomain: "rule-control", drop: { enabled: true, baseWeight: 1 }, stackable: false, activation: { type: "action", windows: ["owner-turn"], consume: "none" } }).success).toBe(false);
    expect(AbilityDefinitionSchema.safeParse({ ...base, activation: { type: "action", windows: ["owner-turn"], consume: "card" } }).success).toBe(false);
    expect(AbilityDefinitionSchema.safeParse({ ...base, ttl: undefined }).success).toBe(false);
    expect(AbilityDefinitionSchema.safeParse({ ...base, ttl: { type: "triggers", amount: 0 } }).success).toBe(false);
    expect(AbilityDefinitionSchema.safeParse({ ...base, sourceKind: "talent", ttl: { type: "rounds", amount: 1 } }).success).toBe(false);
    expect(AbilityDefinitionSchema.safeParse({ ...base, activation: { type: "action", windows: ["owner-turn"], consume: "none" }, ttl: { type: "triggers", amount: 1 } }).success).toBe(false);
    expect(AbilityDefinitionSchema.safeParse({ ...base, rules: [{ ...base.rules[0], trigger: "after-stand" }] }).success).toBe(true);
    expect(StatusDefinitionSchema.safeParse({ id: "next-action", rules: [], defaultDuration: "until-owner-action", blocksAbilityTags: ["active-skill-card"] }).success).toBe(true);
  });

  it("rejects unresolved parameter, status, and ability references while building a registry", () => {
    const definition = (id: string, effect: unknown, availability?: readonly unknown[]) => ({
      id, name: "reference", description: "fixture", sourceKind: "ai-skill", primaryDomain: "rule-control",
      activation: availability ? { type: "action", windows: ["owner-turn"], consume: "none", availability } : { type: "passive" },
      ...(!availability ? { ttl: { type: "rounds", amount: 2 } } : {}),
      rules: [{ id: "rule", trigger: "on-match-created", effects: [effect] }], tags: ["test-fixture"]
    });
    expect(() => createAbilityRegistry([definition("reference-parameter", { type: "draw-skill-cards", target: "owner", amount: { type: "parameter", key: "missing" } })])).toThrow(/Unknown parameter/);
    expect(() => createAbilityRegistry([definition("reference-status", { type: "add-status", target: "owner", statusDefinitionId: "missing-status" })])).toThrow(/Unknown status/);
    expect(() => createAbilityRegistry([definition("reference-ability", { type: "draw-skill-cards", target: "owner", amount: 1 }, [{ type: "owner-has-card", abilityId: "missing-ability" }])])).toThrow(/Unknown ability/);
  });

  it("enforces concrete instance source kinds during event collection", () => {
    expect(supportsAbilitySourceKind(getAbilityDefinition("sword-and-handcannon")!, "player-skill")).toBe(true);
    expect(supportsAbilitySourceKind(getAbilityDefinition("sword-and-handcannon")!, "ai-skill")).toBe(false);
    expect(supportsAbilitySourceKind(getAbilityDefinition("ai-sword-and-handcannon")!, "ai-skill")).toBe(true);
    for (const [definitionId, kind] of [["ai-sword-and-handcannon", "ai-skill"], ["forge-heralds-the-year", "player-skill"]] as const) {
      const owner = "opponent" as const;
      const instance = { kind, definitionId, owner, instanceId: `${definitionId}-${kind}`, createdAtSequence: 1, parameters: {} } as AbilityInstance;
      const runtime = { ...createAbilityRuntime(createRng(`${definitionId}-${kind}`).snapshot()), instances: [instance] };
      expect(() => resolveAbilityEvent({ world: world(), runtime, event: { trigger: "on-match-created", sourceEventId: `${definitionId}-${kind}` } })).not.toThrow();
    }
    const invalid = { kind: "player-skill" as const, definitionId: "silent-drizzle", owner: "opponent" as const, instanceId: "wrong-kind", createdAtSequence: 1, parameters: {} };
    const runtime = { ...createAbilityRuntime(createRng("wrong-kind").snapshot()), instances: [invalid] };
    expect(() => resolveAbilityEvent({ world: world(), runtime, event: { trigger: "on-match-created", sourceEventId: "wrong-kind" } })).toThrow(AbilityResolutionError);
    expect(runtime.rng).toEqual(createRng("wrong-kind").snapshot());
  });
});

describe("generic resolution and lifecycle", () => {
  it("creates derived exact-total cards without consuming the shoe and keeps them out of physical-card conditions", () => {
    const shoe = { cards: [createCard("clubs", "2")], cursor: 0, shuffleIndex: 1 };
    const hand = createHand([createCard("hearts", "6"), createCard("hearts", "6")]);
    const result = drawExactResultingTotal(shoe, hand, createRng("derived-exact"), 21);
    expect(result).toBeDefined();
    expect(result?.derived).toBe(true);
    expect(result?.card.origin).toBe("derived");
    expect(result?.shoe).toBe(shoe);
    expect(result?.shoe.cursor).toBe(0);

    const ability = mechanic("hand-change-observer", "player");
    const conditionWorld = { ...world(), hands: { ...world().hands, player: createHand([createCard("spades", "10"), result!.card]) } };
    const context = { world: conditionWorld, ability, event: { trigger: "after-hand-changed" as const, sourceEventId: "derived-origin", eventActor: "player" as const } };
    expect(evaluateCondition({ type: "hand-card-origin-is", target: "owner", card: "last-card", origin: "derived" }, context)).toBe(true);
    expect(evaluateCondition({ type: "hand-card-origin-is", target: "owner", card: "last-card", origin: "shoe" }, context)).toBe(false);
  });

  it("dissipates a derived card replaced from hand instead of returning it to the shoe", () => {
    const derived = createDerivedCard("hearts", "5");
    const hand = createHand([createCard("spades", "10"), derived]);
    const shoe = { cards: [createCard("clubs", "2"), createCard("diamonds", "3")], cursor: 0, shuffleIndex: 1 };
    const result = replaceLastHandCard(shoe, hand, createRng("replace-derived"), "at-most", 21);
    expect(result).toBeDefined();
    expect(result?.shoe.cursor).toBe(1);
    expect(result?.hand.cards.some((card) => card.origin === "derived")).toBe(false);
    expect(result?.shoe.cards.every((card) => card.origin === "shoe")).toBe(true);
    expect(result?.shoe.cards).not.toContainEqual(derived);
  });

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
      id: "ordering-fixture", name: "ordering", description: "fixture", sourceKind: "ai-skill", primaryDomain: "rule-control", activation: { type: "passive" }, ttl: { type: "triggers", amount: 10 }, tags: ["test-fixture"],
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

  it("consumes trigger TTL only after successful activation and removes an expired passive card", () => {
    const definition = {
      id: "trigger-ttl-fixture", name: "trigger ttl", description: "fixture", sourceKind: "player-skill", primaryDomain: "roulette",
      activation: { type: "passive" }, ttl: { type: "triggers", amount: 2 }, tags: ["test-fixture"],
      drop: { enabled: true, baseWeight: 1 }, stackable: false,
      rules: [{ id: "load", trigger: "before-bullet-load", conditions: [{ type: "round-penalty-target-is", target: "owner" }], effects: [{ type: "add-to-pending-load", target: "owner", amount: 1 }] }]
    } as const;
    const registry = createAbilityRegistry([definition]);
    const card: SkillCardInstance = { kind: "player-skill", definitionId: definition.id, owner: "player", instanceId: "ttl-card" };
    const instance = instantiateAbility({ definitionId: definition.id, enabled: true, parameters: {} }, "player", card.instanceId, 1, registry, "player-skill");
    const linkedStatus: AbilityStatus = { statusDefinitionId: "copper-seal-sealed", owner: "player", sourceInstanceId: card.instanceId, stacks: 1, duration: "match", parameters: {}, createdAtSequence: 1 };
    let runtime: AbilityRuntimeState = { ...createAbilityRuntime(createRng("trigger-ttl").snapshot()), instances: [instance], statuses: [linkedStatus], sequence: 1 };
    let abilityWorld: AbilityWorld = { ...world([card]), statuses: [linkedStatus] };
    const event = { trigger: "before-bullet-load" as const, sourceEventId: "ttl-1", roundOutcome: { reason: "comparison" as const, penaltyTarget: "player" as const } };

    const first = resolveAbilityEvent({ world: abilityWorld, runtime, registry, event, pendingLoad: { id: "ttl-1", actor: "player", amount: 1, reason: "comparison" } });
    expect(first.pendingLoad?.amount).toBe(2);
    expect(first.runtime.instances[0]?.ttl).toEqual({ type: "triggers", remaining: 1 });
    expect(first.world.cards).toEqual([card]);
    expect(first.runtime.statuses).toEqual([linkedStatus]);
    expect(first.events.some((entry) => entry.type === "ABILITY_EXPIRED")).toBe(false);

    runtime = first.runtime;
    abilityWorld = first.world;
    const second = resolveAbilityEvent({ world: abilityWorld, runtime, registry, event: { ...event, sourceEventId: "ttl-2" }, pendingLoad: { id: "ttl-2", actor: "player", amount: 1, reason: "comparison" } });
    expect(second.pendingLoad?.amount).toBe(2);
    expect(second.runtime.instances[0]?.ttl).toEqual({ type: "triggers", remaining: 0 });
    expect(second.world.cards).toEqual([]);
    expect(second.runtime.statuses).toEqual([]);
    expect(second.world.statuses).toEqual([]);
    expect(second.events).toContainEqual(expect.objectContaining({ type: "STATUS_REMOVED", statusDefinitionId: linkedStatus.statusDefinitionId, reason: "expired" }));
    expect(second.events).toContainEqual(expect.objectContaining({ type: "ABILITY_EXPIRED", instanceId: card.instanceId, reason: "triggers" }));

    const third = resolveAbilityEvent({ world: second.world, runtime: second.runtime, registry, event: { ...event, sourceEventId: "ttl-3" }, pendingLoad: { id: "ttl-3", actor: "player", amount: 1, reason: "comparison" } });
    expect(third.triggered).toEqual([]);
    expect(third.pendingLoad?.amount).toBe(1);
  });

  it("counts round TTL after the round and frees the passive card slot at zero", () => {
    const definition = {
      id: "round-ttl-fixture", name: "round ttl", description: "fixture", sourceKind: "player-skill", primaryDomain: "rule-control",
      activation: { type: "passive" }, ttl: { type: "rounds", amount: 2 }, tags: ["test-fixture"],
      drop: { enabled: true, baseWeight: 1 }, stackable: false, rules: []
    } as const;
    const registry = createAbilityRegistry([definition]);
    const card: SkillCardInstance = { kind: "player-skill", definitionId: definition.id, owner: "player", instanceId: "round-ttl-card" };
    const instance = instantiateAbility({ definitionId: definition.id, enabled: true, parameters: {} }, "player", card.instanceId, 1, registry, "player-skill");
    const initial = { ...createAbilityRuntime(createRng("round-ttl").snapshot()), instances: [instance], sequence: 1 };
    const first = advanceRoundAbilityTtls(initial, [card], registry);
    expect(first.runtime.instances[0]?.ttl).toEqual({ type: "rounds", remaining: 1 });
    expect(first.cards).toEqual([card]);
    expect(first.expired).toEqual([]);
    const second = advanceRoundAbilityTtls(first.runtime, first.cards, registry);
    expect(second.runtime.instances[0]?.ttl).toEqual({ type: "rounds", remaining: 0 });
    expect(second.cards).toEqual([]);
    expect(second.expired.map((entry) => entry.instanceId)).toEqual([card.instanceId]);
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
    const statuses: AbilityStatus[] = (["turn", "round", "match", "until-owner-action", "until-consumed"] as const).map((duration, index) => ({ statusDefinitionId: "copper-seal-sealed", owner: "player", sourceInstanceId: source.instanceId, stacks: 1, duration, parameters: {}, createdAtSequence: index + 1 }));
    let runtime: AbilityRuntimeState = { ...createAbilityRuntime(createRng("lifecycle").snapshot()), instances: [source], statuses, counters: { "consumed:rule:match": 1 } };
    expect(expireStatuses(runtime, "turn").statuses.map((status) => status.duration)).toEqual(["round", "match", "until-owner-action", "until-consumed"]);
    runtime = expireOwnerActionStatuses(runtime, "opponent");
    expect(runtime.statuses.some((status) => status.duration === "until-owner-action")).toBe(true);
    runtime = expireOwnerActionStatuses(runtime, "player");
    expect(runtime.statuses.some((status) => status.duration === "until-owner-action")).toBe(false);
    runtime = garbageCollectAbilityInstances(runtime, []);
    expect(runtime.instances).toHaveLength(1);
    runtime = garbageCollectAbilityInstances({ ...runtime, statuses: [] }, []);
    expect(runtime.instances).toHaveLength(0);
    expect(runtime.counters).toEqual({});
  });

  it("preflights direct effects without consuming a card and resolves valid actions atomically", () => {
    const invalid = {
      id: "invalid-action-context", name: "invalid", description: "fixture", sourceKind: "player-skill", primaryDomain: "rule-control", drop: { enabled: true, baseWeight: 1 }, stackable: false,
      activation: { type: "action", windows: ["owner-turn"], consume: "card" }, tags: ["test-fixture"],
      rules: [{ id: "requires-draw", trigger: "on-ability-played", effects: [{ type: "replace-pending-draw", target: "owner", policy: { type: "exact-resulting-total", total: 21, fallback: "create-derived-card" } }] }]
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

  it("resolves Night Queen as an immediate derived-card action", () => {
    const card: SkillCardInstance = { kind: "player-skill", definitionId: "night-queen", owner: "player", instanceId: "night-queen-test" };
    const instance: AbilityInstance = { ...card, createdAtSequence: 1, parameters: {} };
    const runtime = { ...createAbilityRuntime(createRng("fallback").snapshot()), instances: [instance] };
    const input = { world: { ...world([card]), hands: { ...world().hands, player: createHand([createCard("hearts", "Q"), createCard("hearts", "6")]) } }, runtime, instanceId: card.instanceId, owner: "player" as const, window: "owner-turn" as const };
    const result = playAbility(input);
    expect(result.world.hands.player.cards).toHaveLength(3);
    expect(result.world.hands.player.cards.at(-1)?.origin).toBe("derived");
    expect(result.world.hands.player.cards.reduce((total, entry) => total + (entry.rank === "A" ? 11 : entry.rank === "K" || entry.rank === "Q" || entry.rank === "J" ? 10 : Number(entry.rank)), 0)).toBe(21);
  });

  it("reveals only the rival private-card suit without changing world or RNG", () => {
    const card: SkillCardInstance = { kind: "player-skill", definitionId: "scent-of-a-woman", owner: "player", instanceId: "scent-test" };
    const instance: AbilityInstance = { ...card, createdAtSequence: 1, parameters: {} };
    const initial = world([card]);
    const inputWorld = { ...initial, hands: { player: createHand([createCard("spades", "10")]), opponent: createHand([createCard("clubs", "9"), createCard("hearts", "7")]) }, shoe: { cards: [createCard("diamonds", "A")], cursor: 0, shuffleIndex: 1 } };
    const runtime = { ...createAbilityRuntime(createRng("scent").snapshot()), instances: [instance] };
    const result = playAbility({ world: inputWorld, runtime, instanceId: card.instanceId, owner: "player", window: "owner-turn" });
    const revealed = result.events.find((event) => event.type === "CARD_SUIT_REVEALED");
    expect(revealed).toEqual({ type: "CARD_SUIT_REVEALED", viewer: "player", target: "opponent", cardIndex: 1, suit: "hearts" });
    expect(revealed && "rank" in revealed).toBe(false);
    expect(result.world.hands).toEqual(inputWorld.hands);
    expect(result.world.shoe).toEqual(inputWorld.shoe);
    expect(result.runtime.rng).toEqual(runtime.rng);
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
    expect(getAbilityDefinition("early-preparation")?.sourceKind).toBe("talent");
    expect(getAbilityDefinition(relativeFixture.id)).toBeUndefined();
  });
});
