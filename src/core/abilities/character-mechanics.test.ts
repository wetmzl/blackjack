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
  return { hands: { player, opponent }, guns: { player: { capacity: 6, bullets: 1 }, opponent: { capacity: 6, bullets: 1 } }, shoe: { cards: [createCard("clubs", "2")], cursor: 0, shuffleIndex: 1 }, cards: [], skillDraws: 0, statuses: [] };
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
    expect(result.world.hands.opponent.cards.at(-1)?.attributes.source).toBe("derived");
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
      expect(target.cards.at(-1)?.attributes.source).toBe("derived");
      expect(first.runtime.rng).toEqual(second.runtime.rng);
      expect(target.cards.at(-1)).toEqual(second.world.hands[owner].cards.at(-1));
    }
  });

  it("adds exactly 33% per current-round rival Hit and only for the owner penalty", () => {
    const pending = { id: "trigger", actor: "opponent" as const };
    const result = resolve("ai-sword-and-handcannon", "opponent", { trigger: "before-trigger-pull", sourceEventId: "trigger", eventActor: "opponent", roundHitCounts: { player: 2, opponent: 0 }, roundOutcome: { reason: "comparison", penaltyTarget: "opponent" } }, { pendingTrigger: pending });
    expect(result.pendingTrigger?.misfireChance).toBeCloseTo(0.66);
    expect(result.runtime.instances[0]?.ttl).toEqual({ type: "triggers", remaining: 29 });
  });

  it("accumulates Platinum's stand advantage, clears it after a player Hit, and applies it only to comparison", () => {
    const source = instance("platinum-vision");
    const initialRuntime = { ...createAbilityRuntime(createRng("platinum-vision").snapshot()), instances: [source] };
    const stood = resolveAbilityEvent({
      world: world(),
      runtime: initialRuntime,
      event: { trigger: "after-stand", sourceEventId: "platinum-stand-1", eventActor: "player", roundHitCounts: { player: 0, opponent: 0 } }
    });
    expect(stood.world.statuses).toContainEqual(expect.objectContaining({ statusDefinitionId: "platinum-vision-advantage", owner: "opponent", stacks: 1, duration: "match" }));

    const stoodTwice = resolveAbilityEvent({
      world: stood.world,
      runtime: stood.runtime,
      event: { trigger: "after-stand", sourceEventId: "platinum-stand-2", eventActor: "player", roundHitCounts: { player: 0, opponent: 0 } }
    });
    expect(stoodTwice.world.statuses).toContainEqual(expect.objectContaining({ statusDefinitionId: "platinum-vision-advantage", stacks: 2 }));

    const cleared = resolveAbilityEvent({
      world: stoodTwice.world,
      runtime: stoodTwice.runtime,
      event: { trigger: "after-hand-changed", sourceEventId: "platinum-hit", eventActor: "player", roundHitCounts: { player: 1, opponent: 0 } }
    });
    expect(cleared.world.statuses.some((status) => status.statusDefinitionId === "platinum-vision-advantage")).toBe(false);

    const comparison = resolveAbilityEvent({
      world: stoodTwice.world,
      runtime: stoodTwice.runtime,
      event: { trigger: "before-round-resolution", sourceEventId: "platinum-comparison", roundOutcome: { reason: "comparison", penaltyTarget: "player" } },
      pendingComparison: { id: "platinum-comparison", scores: { player: 20, opponent: 20 } }
    });
    expect(comparison.pendingComparison?.scores).toEqual({ player: 20, opponent: 22 });
    expect(comparison.triggered).toContain("platinum-vision-opponent:apply-comparison-advantage");
  });

  it("selects Dorothy's majority suit once per round and applies +2 per resonant card to both actors", () => {
    const resonance = instance("dorothy-resonance-device");
    const initialRuntime = { ...createAbilityRuntime(createRng("dorothy-resonance").snapshot()), instances: [resonance] };
    const hands = world(
      hand(createCard("hearts", "10"), createCard("clubs", "6")),
      hand(createCard("hearts", "4"), createCard("hearts", "8"))
    );
    const assigned = resolveAbilityEvent({
      world: hands,
      runtime: initialRuntime,
      event: { trigger: "after-hand-changed", sourceEventId: "dorothy-opening", eventActor: "opponent" }
    });
    expect(assigned.world.statuses).toContainEqual(expect.objectContaining({
      statusDefinitionId: "dorothy-resonance-suit",
      owner: "opponent",
      stacks: 1,
      duration: "round",
      parameters: { suit: "hearts" }
    }));
    expect(assigned.triggered).toEqual(["dorothy-resonance-device-opponent:assign-resonance-suit"]);

    const compared = resolveAbilityEvent({
      world: assigned.world,
      runtime: assigned.runtime,
      event: { trigger: "before-round-resolution", sourceEventId: "dorothy-comparison", roundOutcome: { reason: "comparison", penaltyTarget: "player" } },
      pendingComparison: { id: "dorothy-comparison", scores: { player: 16, opponent: 12 } }
    });
    expect(compared.pendingComparison?.scores).toEqual({ player: 18, opponent: 16 });
    expect(compared.triggered).toContain("dorothy-resonance-device-opponent:apply-resonance-advantage");
  });

  it("uses the fixed suit order to resolve Dorothy's equal-count opening hands", () => {
    const resonance = instance("dorothy-resonance-device");
    const runtime = { ...createAbilityRuntime(createRng("dorothy-resonance-tie").snapshot()), instances: [resonance] };
    const tied = resolveAbilityEvent({
      world: world(undefined, hand(createCard("hearts", "8"), createCard("spades", "9"))),
      runtime,
      event: { trigger: "after-hand-changed", sourceEventId: "dorothy-tie", eventActor: "opponent" }
    });
    expect(tied.world.statuses[0]?.parameters.suit).toBe("spades");
    const repeated = resolveAbilityEvent({
      world: tied.world,
      runtime: tied.runtime,
      event: { trigger: "after-hand-changed", sourceEventId: "dorothy-hit", eventActor: "opponent" }
    });
    expect(repeated.triggered).toHaveLength(0);
    expect(repeated.world.statuses[0]?.parameters.suit).toBe("spades");
  });

  it("loads one extra bullet for either resonant-card leader only when that leader wins", () => {
    const resonance = instance("dorothy-resonance-device");
    const trap = instance("dorothy-quicksand-trap");
    const status = { statusDefinitionId: "dorothy-resonance-suit", owner: "opponent" as const, sourceInstanceId: resonance.instanceId, stacks: 1, duration: "round" as const, parameters: { suit: "hearts" }, createdAtSequence: 3 };
    const runtime = { ...createAbilityRuntime(createRng("dorothy-quicksand").snapshot()), instances: [resonance, trap], statuses: [status], sequence: 3 };
    const ownerLeading = { ...world(
      hand(createCard("hearts", "10"), createCard("clubs", "7")),
      hand(createCard("hearts", "4"), createCard("hearts", "8"))
    ), statuses: [status] };
    const ownerWin = resolveAbilityEvent({
      world: ownerLeading,
      runtime,
      event: { trigger: "before-bullet-load", sourceEventId: "dorothy-owner-win", roundOutcome: { reason: "comparison", penaltyTarget: "player" } },
      pendingLoad: { id: "dorothy-owner-win", actor: "player", amount: 1, reason: "comparison" }
    });
    expect(ownerWin.pendingLoad?.amount).toBe(2);
    expect(ownerWin.triggered).toContain("dorothy-quicksand-trap-opponent:owner-leading-win-extra-load");

    const rivalLeading = { ...ownerLeading, hands: { player: hand(createCard("hearts", "10"), createCard("hearts", "2")), opponent: hand(createCard("hearts", "8"), createCard("clubs", "9")) } };
    const rivalWin = resolveAbilityEvent({
      world: rivalLeading,
      runtime,
      event: { trigger: "before-bullet-load", sourceEventId: "dorothy-rival-win", roundOutcome: { reason: "blackjack", penaltyTarget: "opponent" } },
      pendingLoad: { id: "dorothy-rival-win", actor: "opponent", amount: 2, reason: "blackjack" }
    });
    expect(rivalWin.pendingLoad?.amount).toBe(3);
    expect(rivalWin.triggered).toContain("dorothy-quicksand-trap-opponent:rival-leading-win-extra-load");

    const tied = { ...ownerLeading, hands: { player: hand(createCard("hearts", "10")), opponent: hand(createCard("hearts", "9")) } };
    const tiedWin = resolveAbilityEvent({
      world: tied,
      runtime,
      event: { trigger: "before-bullet-load", sourceEventId: "dorothy-tied", roundOutcome: { reason: "comparison", penaltyTarget: "player" } },
      pendingLoad: { id: "dorothy-tied", actor: "player", amount: 1, reason: "comparison" }
    });
    expect(tiedWin.pendingLoad?.amount).toBe(1);
    expect(tiedWin.triggered).not.toContain("dorothy-quicksand-trap-opponent:owner-leading-win-extra-load");
  });

  it("uses the previous final display as Lappland's carnival index and applies the matching score bonus", () => {
    const index = instance("carnival-index");
    const runtime = { ...createAbilityRuntime(createRng("carnival-index").snapshot()), instances: [index], sequence: 1 };

    const opening = resolveAbilityEvent({
      world: world(hand(createCard("spades", "10"), createCard("clubs", "2")), hand(createCard("hearts", "10"), createCard("diamonds", "9"))),
      runtime,
      event: { trigger: "before-round-resolution", sourceEventId: "carnival-opening", roundOutcome: { reason: "comparison", penaltyTarget: "player" } },
      pendingComparison: { id: "carnival-opening", scores: { player: 12, opponent: 19 } }
    });
    expect(opening.pendingComparison?.scores).toEqual({ player: 13, opponent: 19 });
    expect(opening.triggered).toContain("carnival-index-opponent:reward-rival-reaching-index");

    const threshold = { statusDefinitionId: "carnival-index-value", owner: "opponent" as const, sourceInstanceId: index.instanceId, stacks: 18, duration: "match" as const, parameters: {}, createdAtSequence: 2 };
    const indexedWorld = { ...world(hand(createCard("spades", "10"), createCard("clubs", "7")), hand(createCard("hearts", "10"), createCard("diamonds", "8"))), statuses: [threshold] };
    const missed = resolveAbilityEvent({
      world: indexedWorld,
      runtime: { ...runtime, statuses: [threshold], sequence: 2 },
      event: { trigger: "before-round-resolution", sourceEventId: "carnival-missed", roundOutcome: { reason: "comparison", penaltyTarget: "player" } },
      pendingComparison: { id: "carnival-missed", scores: { player: 17, opponent: 18 } }
    });
    expect(missed.pendingComparison?.scores).toEqual({ player: 17, opponent: 20 });
    expect(missed.triggered).toContain("carnival-index-opponent:reward-owner-missed-index");

    const reachedWorld = { ...indexedWorld, hands: { ...indexedWorld.hands, player: hand(createCard("spades", "10"), createCard("clubs", "8")) } };
    const reached = resolveAbilityEvent({
      world: reachedWorld,
      runtime: { ...runtime, statuses: [threshold], sequence: 2 },
      event: { trigger: "before-round-resolution", sourceEventId: "carnival-reached", roundOutcome: { reason: "comparison", penaltyTarget: "opponent" } },
      pendingComparison: { id: "carnival-reached", scores: { player: 18, opponent: 17 } }
    });
    expect(reached.pendingComparison?.scores).toEqual({ player: 19, opponent: 17 });

    const replaced = resolveAbilityEvent({
      world: reached.world,
      runtime: reached.runtime,
      event: { trigger: "on-round-end", sourceEventId: "carnival-round-end", roundOutcome: { reason: "comparison", penaltyTarget: "opponent", comparisonScores: { player: 19, opponent: 17 } } }
    });
    expect(replaced.world.statuses).toContainEqual(expect.objectContaining({ statusDefinitionId: "carnival-index-value", owner: "opponent", stacks: 19 }));
    expect(replaced.events).toContainEqual(expect.objectContaining({ type: "ABILITY_TRIGGERED", ruleId: "replace-index-at-round-end" }));
  });

  it("falls back to the visible hand total for non-comparison carnival updates", () => {
    const index = instance("carnival-index");
    const runtime = { ...createAbilityRuntime(createRng("carnival-bust").snapshot()), instances: [index], sequence: 1 };
    const bustedWorld = world(hand(createCard("spades", "K"), createCard("clubs", "Q"), createCard("diamonds", "2")));
    const updated = resolveAbilityEvent({
      world: bustedWorld,
      runtime,
      event: { trigger: "on-round-end", sourceEventId: "carnival-bust-end", roundOutcome: { reason: "bust", penaltyTarget: "player" } }
    });
    expect(updated.world.statuses).toContainEqual(expect.objectContaining({ statusDefinitionId: "carnival-index-value", stacks: 22 }));
  });

  it("raises either actor's bust limit only while Lappland reaches the carnival index", () => {
    const index = instance("carnival-index");
    const heat = instance("carnival-heats-up");
    const threshold = { statusDefinitionId: "carnival-index-value", owner: "opponent" as const, sourceInstanceId: index.instanceId, stacks: 18, duration: "match" as const, parameters: {}, createdAtSequence: 3 };
    const runtime = { ...createAbilityRuntime(createRng("carnival-heat").snapshot()), instances: [index, heat], statuses: [threshold], sequence: 3 };
    const reached = { ...world(undefined, hand(createCard("hearts", "10"), createCard("diamonds", "8"))), statuses: [threshold] };
    for (const actor of ["player", "opponent"] as const) {
      const result = resolveAbilityEvent({ world: reached, runtime, event: { trigger: "before-bust-check", sourceEventId: `carnival-bust-${actor}`, eventActor: actor }, pendingBust: { id: `carnival-bust-${actor}`, actor, limit: 21 } });
      expect(result.pendingBust?.limit).toBe(23);
      expect(result.triggered).toContain("carnival-heats-up-opponent:raise-shared-bust-limit");
    }

    const below = { ...reached, hands: { ...reached.hands, opponent: hand(createCard("hearts", "10"), createCard("diamonds", "7")) } };
    const unchanged = resolveAbilityEvent({ world: below, runtime, event: { trigger: "before-bust-check", sourceEventId: "carnival-below", eventActor: "player" }, pendingBust: { id: "carnival-below", actor: "player", limit: 21 } });
    expect(unchanged.pendingBust?.limit).toBe(21);
    expect(unchanged.triggered).not.toContain("carnival-heats-up-opponent:raise-shared-bust-limit");
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
      id: "strict-new-primitive", name: "strict", description: "strict", sourceKind: "ai-skill", primaryDomain: "cheater",
      activation: { type: "passive" }, ttl: { type: "rounds", amount: 2 }, tags: ["test-fixture"], rules: [{ id: "rule", trigger: "after-hand-changed", conditions: [{ type: "hand-all-color", target: "owner", color: "red" }], effects: [{ type: "add-derived-card-for-exact-total", target: "owner", total: 21 }] }]
    } as const;
    expect(AbilityDefinitionSchema.safeParse(base).success).toBe(true);
    expect(AbilityDefinitionSchema.safeParse({ ...base, rules: [{ ...base.rules[0], conditions: [{ ...base.rules[0].conditions[0], extra: true }] }] }).success).toBe(false);
    expect(AbilityDefinitionSchema.safeParse({ ...base, rules: [{ ...base.rules[0], effects: [{ ...base.rules[0].effects[0], extra: true }] }] }).success).toBe(false);
    const impossible = { id: "atomic-derived", name: "atomic", description: "atomic", sourceKind: "ai-skill", primaryDomain: "cheater", activation: { type: "passive" }, ttl: { type: "rounds", amount: 2 }, tags: ["test-fixture"], rules: [{ id: "derive", trigger: "after-hand-changed", effects: [{ type: "add-derived-card-for-exact-total", target: "owner", total: 21 }] }] } as const;
    const registry = createAbilityRegistry([impossible]);
    const initialWorld = world(hand(createCard("spades", "K"), createCard("hearts", "K"), createCard("clubs", "K")));
    const runtime = { ...createAbilityRuntime(createRng("atomic").snapshot()), instances: [instance("atomic-derived")] };
    expect(() => resolveAbilityEvent({ world: initialWorld, runtime, registry, event: { trigger: "after-hand-changed", sourceEventId: "atomic", eventActor: "opponent" } })).toThrow(AbilityResolutionError);
    expect(initialWorld.hands.opponent.cards).toHaveLength(1);
    expect(runtime.rng).toEqual(createRng("atomic").snapshot());
  });
});
