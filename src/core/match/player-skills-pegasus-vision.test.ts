import { describe, expect, it } from "vitest";
import { createCard } from "../blackjack/card";
import { createHand } from "../blackjack/hand";
import type { PhysicalCard } from "../blackjack/types";
import { instantiateAbility } from "../abilities/registry";
import { advanceRoundAbilityTtls } from "../abilities/runtime";
import type { AbilityRuntimeState, AbilityStatus, SkillCardInstance } from "../abilities/types";
import { createMatch, gameReducer } from "./reducer";
import type { MatchState, ParticipantState, RoundState } from "./types";

function fixture(copyCount = 1): MatchState {
  const base = createMatch("player-pegasus-vision", { unlockedPlayerSkillIds: ["pegasus-vision"] });
  const cards: SkillCardInstance[] = Array.from({ length: copyCount }, (_, index) => ({
    kind: "player-skill",
    definitionId: "pegasus-vision",
    owner: "player",
    instanceId: `player-pegasus-vision-${index + 1}`
  }));
  const instances = cards.map((card, index) => instantiateAbility(
    { definitionId: card.definitionId, enabled: true, parameters: {} },
    "player",
    card.instanceId,
    base.abilities.sequence + index + 1,
    undefined,
    "player-skill"
  ));
  const player: ParticipantState = { id: "player", hand: createHand([createCard("hearts", "10"), createCard("clubs", "7")]), stood: false, busted: false };
  const opponent: ParticipantState = { id: "opponent", hand: createHand([createCard("diamonds", "10"), createCard("spades", "7")]), stood: false, busted: false };
  const round: RoundState = { ...base.round, phase: "turns", currentActor: "opponent", player, opponent, outcome: null };
  return {
    ...base,
    player,
    opponent,
    round,
    shoe: { cards: [createCard("clubs", "2")] as PhysicalCard[], cursor: 0, shuffleIndex: 1 },
    playerSkills: { ...base.playerSkills, cards },
    abilities: { ...base.abilities, instances: [...base.abilities.instances, ...instances], sequence: base.abilities.sequence + instances.length }
  };
}

describe("Pegasus Vision Player Skill", () => {
  it("stacks once per passive copy when the opponent stands without a Hit and applies the total once", () => {
    const stood = gameReducer(fixture(2), { type: "AI_STAND" });
    expect(stood.abilities.statuses).toContainEqual(expect.objectContaining({
      statusDefinitionId: "pegasus-vision-advantage",
      owner: "player",
      stacks: 2,
      duration: "match"
    }));
    expect(stood.history.filter((event) => event.type === "ABILITY_TRIGGERED" && event.definitionId === "pegasus-vision" && event.ruleId === "gain-rival-stand-advantage")).toHaveLength(2);

    const resolved = gameReducer(stood, { type: "PLAYER_STAND" });
    expect(resolved.round.outcome).toMatchObject({ winner: "player", reason: "comparison", penaltyTarget: "opponent" });
    expect(resolved.round.outcome?.comparisonScores).toEqual({ player: 19, opponent: 17 });
  });

  it("clears only Pegasus Vision advantage as soon as the opponent Hits", () => {
    const initial = fixture(2);
    const sourceInstanceId = initial.playerSkills.cards.at(-1)!.instanceId;
    const statuses: AbilityStatus[] = [
      { statusDefinitionId: "pegasus-vision-advantage", owner: "player", sourceInstanceId, stacks: 4, duration: "match", parameters: {}, createdAtSequence: initial.abilities.sequence + 1 },
      { statusDefinitionId: "player-point-advantage", owner: "player", sourceInstanceId, stacks: 2, duration: "round", parameters: {}, createdAtSequence: initial.abilities.sequence + 2 }
    ];
    const ready = { ...initial, abilities: { ...initial.abilities, statuses, sequence: initial.abilities.sequence + 2 } };
    const hit = gameReducer(ready, { type: "AI_HIT" });
    expect(hit.abilities.statuses.some((status) => status.statusDefinitionId === "pegasus-vision-advantage")).toBe(false);
    expect(hit.abilities.statuses).toContainEqual(expect.objectContaining({ statusDefinitionId: "player-point-advantage", stacks: 2 }));
    expect(hit.history).toContainEqual(expect.objectContaining({ type: "STATUS_REMOVED", statusDefinitionId: "pegasus-vision-advantage", owner: "player", reason: "consumed" }));
  });

  it("keeps each passive card for five round boundaries and removes its linked advantage on expiry", () => {
    const state = fixture();
    const card = state.playerSkills.cards[0]!;
    const status: AbilityStatus = { statusDefinitionId: "pegasus-vision-advantage", owner: "player", sourceInstanceId: card.instanceId, stacks: 3, duration: "match", parameters: {}, createdAtSequence: state.abilities.sequence + 1 };
    let runtime: AbilityRuntimeState = { ...state.abilities, statuses: [status], sequence: state.abilities.sequence + 1 };
    let cards: readonly SkillCardInstance[] = [card];
    for (let round = 0; round < 4; round += 1) {
      const advanced = advanceRoundAbilityTtls(runtime, cards);
      runtime = advanced.runtime;
      cards = advanced.cards;
    }
    expect(runtime.instances.find((instance) => instance.instanceId === card.instanceId)?.ttl).toEqual({ type: "rounds", remaining: 1 });
    expect(cards).toEqual([card]);
    expect(runtime.statuses).toEqual([status]);

    const expired = advanceRoundAbilityTtls(runtime, cards);
    expect(expired.runtime.instances.find((instance) => instance.instanceId === card.instanceId)?.ttl).toEqual({ type: "rounds", remaining: 0 });
    expect(expired.cards).toEqual([]);
    expect(expired.runtime.statuses).toEqual([]);
  });

  it("preserves shared advantage when an older stacked copy expires first", () => {
    const state = fixture(2);
    const [olderCard, newerCard] = state.playerSkills.cards;
    const status: AbilityStatus = { statusDefinitionId: "pegasus-vision-advantage", owner: "player", sourceInstanceId: newerCard!.instanceId, stacks: 6, duration: "match", parameters: {}, createdAtSequence: state.abilities.sequence + 1 };
    const runtime = {
      ...state.abilities,
      instances: state.abilities.instances.map((instance) => instance.instanceId === olderCard!.instanceId
        ? { ...instance, ttl: { type: "rounds" as const, remaining: 1 } }
        : instance.instanceId === newerCard!.instanceId
          ? { ...instance, ttl: { type: "rounds" as const, remaining: 3 } }
          : instance),
      statuses: [status],
      sequence: state.abilities.sequence + 1
    };
    const advanced = advanceRoundAbilityTtls(runtime, state.playerSkills.cards);
    expect(advanced.cards).toEqual([newerCard]);
    expect(advanced.runtime.statuses).toEqual([status]);
    expect(advanced.runtime.instances.find((instance) => instance.instanceId === newerCard!.instanceId)?.ttl).toEqual({ type: "rounds", remaining: 2 });
  });
});
