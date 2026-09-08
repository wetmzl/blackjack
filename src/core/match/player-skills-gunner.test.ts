import { describe, expect, it } from "vitest";
import { createCard } from "../blackjack/card";
import { createHand } from "../blackjack/hand";
import type { Card, PhysicalCard, Rank, Suit } from "../blackjack/types";
import { getAbilityDefinition } from "../abilities/registry";
import { gameReducer, createMatch, resolveRound } from "./reducer";
import type { MatchState, ParticipantState, RoundState } from "./types";

const card = (rank: Rank, suit: Suit = "clubs"): Card => createCard(suit, rank);
const skillCard = (definitionId: string, instanceId = `skill-${definitionId}`) => ({ kind: "player-skill" as const, definitionId, owner: "player" as const, instanceId });

function fixture(definitionIds: readonly string[], playerCards: readonly Card[] = [card("10"), card("7")]): MatchState {
  const base = createMatch(`gunner-${definitionIds.join("-")}`, { unlockedPlayerSkillIds: definitionIds });
  const cards = definitionIds.map((id, index) => skillCard(id, `gunner-${id}-${index}`));
  const instances = cards.map((entry, index) => ({ ...entry, createdAtSequence: base.abilities.sequence + index + 1, parameters: {} }));
  const player: ParticipantState = { id: "player", hand: createHand(playerCards), stood: false, busted: false };
  const opponent: ParticipantState = { id: "opponent", hand: createHand([card("10"), card("8")]), stood: false, busted: false };
  const round: RoundState = { ...base.round, phase: "turns", currentActor: "player", player, opponent, outcome: null };
  return {
    ...base,
    player,
    opponent,
    round,
    shoe: { cards: [card("2"), card("3")] as PhysicalCard[], cursor: 0, shuffleIndex: 1 },
    playerSkills: { ...base.playerSkills, cards },
    abilities: { ...base.abilities, instances: [...base.abilities.instances, ...instances], sequence: base.abilities.sequence + instances.length }
  };
}

function play(state: MatchState, definitionId: string, index = 0): MatchState {
  return gameReducer(state, { type: "PLAY_ABILITY", instanceId: `gunner-${definitionId}-${index}` });
}

describe("initial Gunslinger Player Skills", () => {
  it("registers all three as initially unlocked active cards", () => {
    for (const id of ["live-ammunition-bet", "prepaid-premium", "heart-hunter"] as const) {
      const definition = getAbilityDefinition(id);
      expect(definition).toMatchObject({ sourceKind: "player-skill", primaryDomain: "gunslinger", skillTags: ["gunslinger"], activation: { type: "action", windows: ["owner-turn"], consume: "card" } });
      expect(definition?.sourceKind === "player-skill" ? definition.unlock : undefined).toBeUndefined();
    }
  });

  it("stacks Live Ammunition Bet on top of the loser's base load", () => {
    let state = fixture(["live-ammunition-bet", "live-ammunition-bet"]);
    state = play(state, "live-ammunition-bet", 0);
    state = { ...state, round: { ...state.round, currentActor: "player" } };
    state = play(state, "live-ammunition-bet", 1);
    const resolved = resolveRound(state, { winner: "opponent", reason: "comparison", penaltyTarget: "player", bulletsAdded: 1 });
    expect(resolved.roulette.player.bullets).toBe(3);
    expect(resolved.round.outcome?.bulletsAdded).toBe(3);
  });

  it("Prepaid Premium loads immediately, then preserves the loss load while cancelling its trigger", () => {
    const prepared = { ...fixture(["prepaid-premium"]), shoe: { cards: Array.from({ length: 16 }, (_, index) => card(String(2 + index % 8) as Rank)) as PhysicalCard[], cursor: 0, shuffleIndex: 1 } };
    const armed = play(prepared, "prepaid-premium");
    expect(armed.roulette.player.bullets).toBe(1);
    expect(armed.abilities.statuses).toContainEqual(expect.objectContaining({ statusDefinitionId: "prepaid-premium-covered", duration: "round" }));

    const resolved = resolveRound(armed, { winner: "opponent", reason: "comparison", penaltyTarget: "player", bulletsAdded: 1 });
    expect(resolved.roulette.player.bullets).toBe(2);
    const reaction = gameReducer(resolved, { type: "ACK_ROUND_RESULT" });
    const nextRound = gameReducer(reaction, { type: "TRIGGER_ROULETTE" });
    expect(nextRound.roundIndex).toBe(armed.roundIndex + 1);
    expect(nextRound.history.slice(reaction.history.length)).not.toContainEqual(expect.objectContaining({ type: "TRIGGER_PULLED" }));
    expect(nextRound.history).toContainEqual(expect.objectContaining({ type: "PENDING_EVENT_CANCELLED" }));
  });

  it("does not expose Prepaid Premium when the player's gun is already full", () => {
    const state = { ...fixture(["prepaid-premium"]), roulette: { player: { capacity: 6, bullets: 6 }, opponent: { capacity: 6, bullets: 0 } } };
    const next = play(state, "prepaid-premium");
    expect(next).toBe(state);
    expect(next.playerSkills.cards).toHaveLength(1);
  });

  it("Heart Hunter replaces either loser's base load with the player's final heart count", () => {
    const hearts = [card("10", "hearts"), card("7", "hearts"), card("2", "clubs")];
    const armed = play(fixture(["heart-hunter"], hearts), "heart-hunter");
    const playerLoses = resolveRound(armed, { winner: "opponent", reason: "comparison", penaltyTarget: "player", bulletsAdded: 1 });
    expect(playerLoses.roulette.player.bullets).toBe(2);

    const opponentLoses = resolveRound(armed, { winner: "player", reason: "comparison", penaltyTarget: "opponent", bulletsAdded: 1 });
    expect(opponentLoses.roulette.opponent.bullets).toBe(2);
  });

  it("applies Heart Hunter before additive bets, including a zero-heart base", () => {
    let state = fixture(["heart-hunter", "live-ammunition-bet"], [card("10", "clubs"), card("7", "spades")]);
    state = play(state, "heart-hunter");
    state = { ...state, round: { ...state.round, currentActor: "player" } };
    state = play(state, "live-ammunition-bet", 1);
    const resolved = resolveRound(state, { winner: "opponent", reason: "comparison", penaltyTarget: "player", bulletsAdded: 1 });
    expect(resolved.roulette.player.bullets).toBe(1);
    expect(resolved.round.outcome?.bulletsAdded).toBe(1);
  });
});
