import { describe, expect, it } from "vitest";
import { createCard } from "../blackjack/card";
import { createHand, handValue } from "../blackjack/hand";
import { createRng } from "../rng/seeded";
import { createAbilityRuntime, type AbilityInstance, type AbilityWorld } from "./index";
import { ABILITY_CATALOG_VERSION, createAbilityRegistry } from "./registry";
import { AbilityResolutionError, resolveAbilityEvent } from "./engine";
import { AbilityDefinitionSchema } from "./schema";

const hand = (...cards: Array<ReturnType<typeof createCard>>) => createHand(cards);
const instance = (definitionId: string, owner: "player" | "opponent" = "opponent"): AbilityInstance => ({ kind: "ai-skill", definitionId, owner, instanceId: `${definitionId}-${owner}`, createdAtSequence: 1, parameters: {} });
function world(player = hand(createCard("spades", "10")), opponent = hand(createCard("hearts", "9"))): AbilityWorld {
  return { hands: { player, opponent }, guns: { player: { capacity: 6, bullets: 1 }, opponent: { capacity: 6, bullets: 1 } }, shoe: { cards: [createCard("clubs", "2")], cursor: 0, shuffleIndex: 1 }, cards: [], statuses: [] };
}
function resolve(definitionId: string, owner: "player" | "opponent", event: Parameters<typeof resolveAbilityEvent>[0]["event"], pending: Partial<Parameters<typeof resolveAbilityEvent>[0]> = {}, worlds?: AbilityWorld) {
  const ability = instance(definitionId, owner);
  return resolveAbilityEvent({ world: worlds ?? world(), runtime: { ...createAbilityRuntime(createRng(definitionId).snapshot()), instances: [ability] }, event, ...pending });
}

describe("new character mechanics", () => {
  it("raises both actors' bust limits by the current W hand-count difference", () => {
    const worlds = world(hand(createCard("spades", "K"), createCard("clubs", "10"), createCard("diamonds", "2")), hand(createCard("hearts", "K"), createCard("hearts", "9"), createCard("hearts", "2"), createCard("hearts", "A")));
    for (const eventActor of ["player", "opponent"] as const) {
      const result = resolve("bomb-maniac", "opponent", { trigger: "before-bust-check", sourceEventId: `bust-${eventActor}`, eventActor }, { pendingBust: { id: `bust-${eventActor}`, actor: eventActor, limit: 21 } }, worlds);
      expect(result.pendingBust?.limit).toBe(22);
      expect(result.triggered).toHaveLength(1);
    }
  });

  it("creates an exact derived 21 card without consuming the shoe", () => {
    const physical = [createCard("clubs", "2"), createCard("clubs", "3")];
    const before = { cards: physical, cursor: 0, shuffleIndex: 1 };
    const result = resolve("w-night-queen", "opponent", { trigger: "after-hand-changed", sourceEventId: "draw", eventActor: "opponent" }, {}, { ...world(hand(createCard("spades", "2"), createCard("spades", "2"), createCard("spades", "2"), createCard("spades", "2")), hand(createCard("hearts", "Q"), createCard("hearts", "2"))) , shoe: before });
    expect(handValue(result.world.hands.opponent)).toBe(21);
    expect(result.world.hands.opponent.cards.at(-1)?.origin).toBe("derived");
    expect(result.world.shoe).toBe(before);
  });

  it.each([
    ["Q without same-suit partner", ["hearts", "Q", "spades", "2"]],
    ["same-suit partner without Q", ["hearts", "2", "hearts", "3"]],
    ["partner in another suit", ["hearts", "Q", "diamonds", "2"]],
    ["already 21", ["hearts", "Q", "hearts", "A"]],
    ["over 21", ["hearts", "Q", "hearts", "K", "hearts", "5"]]
  ] as const)("does not trigger Night Queen for %s", (_label, values) => {
    const cards = [];
    for (let index = 0; index < values.length; index += 2) cards.push(createCard(values[index] as Parameters<typeof createCard>[0], values[index + 1] as Parameters<typeof createCard>[1]));
    const result = resolve("w-night-queen", "opponent", { trigger: "after-hand-changed", sourceEventId: "counterexample", eventActor: "opponent" }, {}, world(undefined, hand(...cards)));
    expect(result.triggered).toHaveLength(0);
    expect(result.world.hands.opponent.cards).toEqual(cards);
  });

  it("Night Queen is owner-relative and deterministic across both owners", () => {
    for (const owner of ["player", "opponent"] as const) {
      const hands = owner === "player"
        ? world(hand(createCard("hearts", "Q"), createCard("hearts", "2")))
        : world(undefined, hand(createCard("hearts", "Q"), createCard("hearts", "2")));
      const event = { trigger: "after-hand-changed" as const, sourceEventId: `night-${owner}`, eventActor: owner };
      const first = resolve("w-night-queen", owner, event, {}, hands);
      const second = resolve("w-night-queen", owner, event, {}, hands);
      const target = first.world.hands[owner];
      expect(first.triggered).toHaveLength(1);
      expect(handValue(target)).toBe(21);
      expect(target.cards.at(-1)?.origin).toBe("derived");
      expect(first.runtime.rng).toEqual(second.runtime.rng);
      expect(target.cards.at(-1)).toEqual(second.world.hands[owner].cards.at(-1));
    }
  });

  it("adds exactly 33% per current-round rival Hit and only for the owner penalty", () => {
    const pending = { id: "trigger", actor: "opponent" as const };
    const result = resolve("ai-sword-and-handcannon", "opponent", { trigger: "before-trigger-pull", sourceEventId: "trigger", eventActor: "opponent", roundHitCounts: { player: 2, opponent: 0 }, roundOutcome: { reason: "comparison", penaltyTarget: "opponent" } }, { pendingTrigger: pending });
    expect(result.pendingTrigger?.misfireChance).toBeCloseTo(0.66);
    expect(result.runtime.instances[0]?.ttl).toEqual({ type: "triggers", remaining: 2 });
  });

  it("runs the separate Player Skill counterparts without sharing AI definitions", () => {
    const sword: AbilityInstance = { kind: "player-skill", definitionId: "sword-and-handcannon", owner: "player", instanceId: "player-sword", createdAtSequence: 1, parameters: {} };
    const swordResult = resolveAbilityEvent({ world: world(), runtime: { ...createAbilityRuntime(createRng("player-sword").snapshot()), instances: [sword] }, event: { trigger: "before-trigger-pull", sourceEventId: "player-sword", roundHitCounts: { player: 0, opponent: 2 }, roundOutcome: { reason: "comparison", penaltyTarget: "player" }, eventActor: "player" }, pendingTrigger: { id: "player-sword", actor: "player" } });
    expect(swordResult.pendingTrigger?.misfireChance).toBeCloseTo(0.66);
    expect(swordResult.runtime.instances[0]?.ttl).toEqual({ type: "triggers", remaining: 2 });
    const forge: AbilityInstance = { kind: "player-skill", definitionId: "forge-heralds-the-year", owner: "player", instanceId: "player-forge", createdAtSequence: 1, parameters: {} };
    const forgeResult = resolveAbilityEvent({ world: world(hand(createCard("hearts", "2"), createCard("diamonds", "8"))), runtime: { ...createAbilityRuntime(createRng("player-forge").snapshot()), instances: [forge] }, event: { trigger: "before-bullet-load", sourceEventId: "player-forge", roundOutcome: { reason: "comparison", penaltyTarget: "opponent" }, eventActor: "player" }, pendingLoad: { id: "player-forge", actor: "opponent", amount: 1, reason: "comparison" } });
    expect(forgeResult.pendingLoad?.amount).toBe(2);
    expect(forgeResult.runtime.instances[0]?.ttl).toEqual({ type: "triggers", remaining: 1 });
  });

  it("does not trigger Sword and Handcannon with no Hits or a different penalty target, and clamps at one", () => {
    const baseEvent = { trigger: "before-trigger-pull" as const, sourceEventId: "trigger", eventActor: "opponent" as const, roundHitCounts: { player: 0, opponent: 0 }, roundOutcome: { reason: "comparison" as const, penaltyTarget: "opponent" as const } };
    expect(resolve("ai-sword-and-handcannon", "opponent", baseEvent, { pendingTrigger: { id: "trigger", actor: "opponent" } }).triggered).toHaveLength(0);
    expect(resolve("ai-sword-and-handcannon", "opponent", { ...baseEvent, roundOutcome: { ...baseEvent.roundOutcome, penaltyTarget: "player" } }, { pendingTrigger: { id: "trigger", actor: "opponent" } }).triggered).toHaveLength(0);
    const clamped = resolve("ai-sword-and-handcannon", "opponent", { ...baseEvent, roundHitCounts: { player: 10, opponent: 0 } }, { pendingTrigger: { id: "trigger", actor: "opponent", misfireChance: 0.5 } });
    expect(clamped.pendingTrigger?.misfireChance).toBe(1);
  });

  it("adds Forge's extra load for a red ordinary win", () => {
    const pending = { id: "load", actor: "player" as const, amount: 1, reason: "comparison" as const };
    const result = resolve("ai-forge-heralds-the-year", "opponent", { trigger: "before-bullet-load", sourceEventId: "load", eventActor: "opponent", roundOutcome: { reason: "comparison", penaltyTarget: "player" } }, { pendingLoad: pending }, world(hand(createCard("spades", "10")), hand(createCard("hearts", "2"), createCard("diamonds", "8"))));
    expect(result.pendingLoad?.amount).toBe(2);
  });

  it.each([
    ["mixed", [createCard("hearts", "2"), createCard("spades", "8")], { reason: "comparison" as const, penaltyTarget: "player" as const }],
    ["blackjack", [createCard("hearts", "10"), createCard("diamonds", "A")], { reason: "blackjack" as const, penaltyTarget: "player" as const }],
    ["owner loses", [createCard("hearts", "2"), createCard("diamonds", "8")], { reason: "comparison" as const, penaltyTarget: "opponent" as const }]
  ] as const)("does not trigger Forge for %s", (_label, cards, outcome) => {
    const result = resolve("ai-forge-heralds-the-year", "opponent", { trigger: "before-bullet-load", sourceEventId: "load-negative", eventActor: "player", roundOutcome: outcome }, { pendingLoad: { id: "load-negative", actor: "player", amount: 1, reason: outcome.reason } }, world(undefined, hand(...cards)));
    expect(result.triggered).toHaveLength(0);
    expect(result.pendingLoad?.amount).toBe(1);
  });

  it("Bomb Maniac raises the limit for both owners even when the hand still busts", () => {
    for (const owner of ["player", "opponent"] as const) {
      const over = owner === "player"
        ? world(hand(createCard("hearts", "K"), createCard("hearts", "K"), createCard("hearts", "2"), createCard("hearts", "2")), hand(createCard("spades", "10"), createCard("spades", "2")))
        : world(hand(createCard("spades", "10"), createCard("spades", "2")), hand(createCard("hearts", "K"), createCard("hearts", "K"), createCard("hearts", "2"), createCard("hearts", "2")));
      const result = resolve("bomb-maniac", owner, { trigger: "before-bust-check", sourceEventId: `over-${owner}`, eventActor: owner }, { pendingBust: { id: `over-${owner}`, actor: owner, limit: 21 } }, over);
      expect(result.triggered).toHaveLength(1);
      expect(result.pendingBust?.limit).toBe(23);
    }
  });

  it("does not protect either actor when W has no hand-count advantage", () => {
    for (const owner of ["player", "opponent"] as const) {
      const equalHands = world(
        hand(createCard("spades", "K"), createCard("clubs", "9"), createCard("diamonds", "2"), createCard("hearts", "A")),
        hand(createCard("hearts", "K"), createCard("hearts", "9"), createCard("hearts", "2"), createCard("hearts", "A"))
      );
      const result = resolve("bomb-maniac", owner, { trigger: "before-bust-check", sourceEventId: `equal-${owner}`, eventActor: owner }, { pendingBust: { id: `equal-${owner}`, actor: owner, limit: 21 } }, equalHands);
      expect(result.triggered).toHaveLength(0);
      expect(result.pendingBust?.limit).toBe(21);
    }
  });

  it("accepts the new primitives through the isolated registry", () => {
    expect(createAbilityRegistry([], [], ABILITY_CATALOG_VERSION).catalogVersion).toBe(ABILITY_CATALOG_VERSION);
  });

  it("strictly rejects extra fields on new primitives and keeps impossible derived effects atomic", () => {
    const base = {
      id: "strict-new-primitive", name: "strict", description: "strict", sourceKind: "ai-skill", primaryDomain: "rule-control",
      activation: { type: "passive" }, ttl: { type: "rounds", amount: 2 }, tags: ["test-fixture"], rules: [{ id: "rule", trigger: "after-hand-changed", conditions: [{ type: "hand-all-color", target: "owner", color: "red" }], effects: [{ type: "add-derived-card-for-exact-total", target: "owner", total: 21 }] }]
    } as const;
    expect(AbilityDefinitionSchema.safeParse(base).success).toBe(true);
    expect(AbilityDefinitionSchema.safeParse({ ...base, rules: [{ ...base.rules[0], conditions: [{ ...base.rules[0].conditions[0], extra: true }] }] }).success).toBe(false);
    expect(AbilityDefinitionSchema.safeParse({ ...base, rules: [{ ...base.rules[0], effects: [{ ...base.rules[0].effects[0], extra: true }] }] }).success).toBe(false);
    const impossible = { id: "atomic-derived", name: "atomic", description: "atomic", sourceKind: "ai-skill", primaryDomain: "rule-control", activation: { type: "passive" }, ttl: { type: "rounds", amount: 2 }, tags: ["test-fixture"], rules: [{ id: "derive", trigger: "after-hand-changed", effects: [{ type: "add-derived-card-for-exact-total", target: "owner", total: 21 }] }] } as const;
    const registry = createAbilityRegistry([impossible]);
    const initialWorld = world(hand(createCard("spades", "K"), createCard("hearts", "K"), createCard("clubs", "K")));
    const runtime = { ...createAbilityRuntime(createRng("atomic").snapshot()), instances: [instance("atomic-derived")] };
    expect(() => resolveAbilityEvent({ world: initialWorld, runtime, registry, event: { trigger: "after-hand-changed", sourceEventId: "atomic", eventActor: "opponent" } })).toThrow(AbilityResolutionError);
    expect(initialWorld.hands.opponent.cards).toHaveLength(1);
    expect(runtime.rng).toEqual(createRng("atomic").snapshot());
  });
});
