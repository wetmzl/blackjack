import { describe, expect, it } from "vitest";
import { getAbilityDefinition } from "../abilities/registry";
import { AbilityDefinitionSchema } from "../abilities/schema";
import { createCard } from "../blackjack/card";
import { createHand } from "../blackjack/hand";
import type { PhysicalCard, Rank, Suit } from "../blackjack/types";
import { abilityTriggerNotice } from "../../presentation/ability-notices";
import { createMatch, gameReducer } from "./reducer";
import type { MatchState } from "./types";

const binding = { definitionId: "typhon-eternal-hunt", enabled: true, parameters: {} } as const;
const neutralProfile = { P: 0, A: 0, B: 0, C: 0 } as const;
const suits: readonly Suit[] = ["spades", "hearts", "diamonds", "clubs"];

function cards(ranks: readonly Rank[], prefix: string): PhysicalCard[] {
  return ranks.map((rank, index) => createCard(suits[index % suits.length]!, rank, `${prefix}-${index}-${rank}`));
}

function turnState(playerRanks: readonly Rank[], opponentRanks: readonly Rank[], actor: "player" | "opponent", playerStood = false): MatchState {
  const base = createMatch(`typhon-${playerRanks.join("-")}-${opponentRanks.join("-")}-${actor}`, {
    opponentId: "typhon",
    opponentAiSkills: [binding],
    aiProfile: neutralProfile
  });
  const playerCards = cards(playerRanks, "typhon-player");
  const opponentCards = cards(opponentRanks, "typhon-opponent");
  const nextCard = createCard("clubs", "2", "typhon-next-card");
  const player = { ...base.player, hand: createHand(playerCards), stood: playerStood, busted: false, bustLimit: undefined };
  const opponent = { ...base.opponent, hand: createHand(opponentCards), stood: false, busted: false, bustLimit: undefined };
  return {
    ...base,
    player,
    opponent,
    shoe: { cards: [...playerCards, ...opponentCards, nextCard], cursor: playerCards.length + opponentCards.length, shuffleIndex: 1 },
    round: { ...base.round, phase: "turns", currentActor: actor, player, opponent, outcome: null }
  };
}

describe("Typhon Eternal Hunt", () => {
  it("registers a strict data-driven turn skip and AI threshold modifier", () => {
    const definition = getAbilityDefinition("typhon-eternal-hunt")!;
    expect(definition).toMatchObject({ name: "永恒狩猎", sourceKind: "ai-skill", activation: { type: "automatic" } });
    expect(definition.rules.map((rule) => rule.trigger)).toEqual(["before-turn", "before-ai-decision", "before-ai-decision"]);
    expect(definition.rules[1]?.effects).toEqual([{ type: "add-to-pending-ai-threshold", target: "owner", amount: 100 }]);
    expect(definition.rules[2]?.effects).toEqual([{ type: "add-to-pending-ai-threshold", target: "owner", amount: -100 }]);
    expect(AbilityDefinitionSchema.safeParse({ ...definition, rules: [{ ...definition.rules[1], effects: [{ ...definition.rules[1]!.effects[0], extra: true }] }] }).success).toBe(false);
  });

  it("keeps skipping Typhon's turn until the player stands", () => {
    const state = turnState(["2", "3"], ["10", "7"], "player");
    const afterHit = gameReducer(state, { type: "PLAYER_HIT" });
    const events = afterHit.history.slice(state.history.length);

    expect(events).toContainEqual(expect.objectContaining({ type: "TURN_SKIPPED", actor: "opponent" }));
    expect(events.some((event) => event.type === "OPPONENT_HIT" || event.type === "OPPONENT_STOOD")).toBe(false);
    expect(afterHit.round.currentActor).toBe("player");
    expect(afterHit.opponent.stood).toBe(false);
    expect(abilityTriggerNotice(events, "提丰")).toContainEqual(expect.objectContaining({ text: expect.stringContaining("跳过本回合") }));

    const afterStand = gameReducer(afterHit, { type: "PLAYER_STAND" });
    expect(afterStand.round.currentActor).toBe("opponent");
    expect(afterStand.history.slice(afterHit.history.length).some((event) => event.type === "TURN_SKIPPED")).toBe(false);
  });

  it("adds +100 while behind and forces Hit through bySkill", () => {
    const state = turnState(["10", "8"], ["10", "6"], "opponent", true);
    const next = gameReducer(state, { type: "AI_TURN" });

    expect(next.lastAiDecision).toMatchObject({ handValue: 16, bySkill: 100, threshold: 116, action: "hit" });
    expect(next.history.slice(state.history.length)).toContainEqual(expect.objectContaining({ type: "OPPONENT_HIT" }));
  });

  it("adds -100 while ahead and forces Stand through bySkill", () => {
    const state = turnState(["10", "6"], ["10", "8"], "opponent", true);
    const next = gameReducer(state, { type: "AI_TURN" });

    expect(next.lastAiDecision).toMatchObject({ handValue: 18, bySkill: -100, threshold: -84, action: "stand" });
    expect(next.history.slice(state.history.length)).toContainEqual(expect.objectContaining({ type: "OPPONENT_STOOD" }));
  });

  it("leaves bySkill at zero when the base hand totals are equal", () => {
    const state = turnState(["10", "6"], ["10", "6"], "opponent", true);
    const next = gameReducer(state, { type: "AI_TURN" });

    expect(next.lastAiDecision).toMatchObject({ handValue: 16, bySkill: 0, threshold: 16, action: "hit" });
  });
});
