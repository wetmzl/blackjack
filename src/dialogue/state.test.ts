import { describe, expect, it } from "vitest";
import { createCard } from "../core/blackjack/card";
import { createMatch } from "../core/match/reducer";
import type { Card } from "../core/blackjack/types";
import type { GameEvent, MatchState, RoundOutcome, RoundPhase } from "../core/match/types";
import { DIALOGUE_EVENT_CODES } from "./types";
import { resolveDialogueState } from "./state";

const card = (rank: Card["rank"], suit: Card["suit"] = "spades") => createCard(suit, rank);

function findMatch(predicate: (state: MatchState) => boolean): MatchState {
  for (let index = 0; index < 10_000; index += 1) {
    const state = createMatch(`dialogue-state-${index}`);
    if (predicate(state)) return state;
  }
  throw new Error("No dialogue fixture found");
}

function turnsMatch(): MatchState {
  return findMatch((state) => state.round.phase === "turns");
}

function withActions(...events: GameEvent[]): MatchState {
  const base = turnsMatch();
  return { ...base, round: { ...base.round, phase: "turns" }, history: [...base.history, ...events] };
}

function reveal(playerCards: Card[], opponentCards: Card[], outcome: RoundOutcome): MatchState {
  const base = turnsMatch();
  const history: GameEvent[] = [
    { type: "ROUND_STARTED", roundIndex: 0 },
    ...playerCards.map((entry): GameEvent => ({ type: "CARD_DEALT", actor: "player", card: entry, private: true })),
    ...opponentCards.map((entry): GameEvent => ({ type: "CARD_DEALT", actor: "opponent", card: entry, private: true })),
    { type: "ROUND_RESOLVED", outcome }
  ];
  return { ...base, round: { ...base.round, phase: "round-reveal", currentActor: null, outcome }, history };
}

function rouletteState(phase: "roulette-reaction" | "roulette-trigger"): MatchState {
  const base = turnsMatch();
  return {
    ...base,
    round: { ...base.round, phase },
    history: [...base.history, { type: "ROUND_RESULT_ACKNOWLEDGED" }]
  };
}

function triggerState(actor: "player" | "opponent", result: "fired" | "empty-chamber" | "misfire"): MatchState {
  const base = turnsMatch();
  return {
    ...base,
    round: { ...base.round, phase: "roulette-result" },
    history: [...base.history, {
      type: "TRIGGER_PULLED", actor, probability: result === "fired" ? 1 : 0,
      baseProbability: result === "misfire" ? 0.5 : result === "fired" ? 1 : 0,
      misfireChance: result === "misfire" ? 0.5 : 0, result, fired: result === "fired"
    }]
  };
}

const comparison = (winner: "player" | "opponent"): RoundOutcome => ({
  winner,
  reason: "comparison",
  penaltyTarget: winner === "player" ? "opponent" : "player",
  bulletsAdded: 1
});

describe("finite dialogue state resolver", () => {
  it("keeps Blackjack pools distinct from generic round-win pools", () => {
    const playerBlackjack = findMatch((state) => state.round.outcome?.reason === "blackjack" && state.round.outcome.winner === "player");
    const opponentBlackjack = findMatch((state) => state.round.outcome?.reason === "blackjack" && state.round.outcome.winner === "opponent");
    expect(resolveDialogueState(playerBlackjack).event).toBe("PLAYER_BLACKJACK");
    expect(resolveDialogueState(opponentBlackjack).event).toBe("OPPONENT_BLACKJACK");
  });

  it("selects one result pool when special-hand predicates also overlap", () => {
    const bothTwentyOne = reveal(
      [card("2"), card("4"), card("5"), card("10")],
      [card("A", "hearts"), card("K", "hearts")],
      { winner: null, reason: "push", penaltyTarget: null, bulletsAdded: 0}
    );
    const smallTwentyOneVersusTwenty = reveal(
      [card("2"), card("4"), card("5"), card("10")],
      [card("10", "hearts"), card("Q", "hearts")],
      comparison("player")
    );
    expect(resolveDialogueState(bothTwentyOne).event).toBe("SPECIAL_TWENTY_ONE_PUSH");
    expect(resolveDialogueState(smallTwentyOneVersusTwenty).event).toBe("PLAYER_WIN_ROUND");
  });

  it("uses reason-specific bust and ordinary comparison pools", () => {
    const playerBust = reveal(
      [card("10"), card("9"), card("5")],
      [card("10", "hearts"), card("8", "hearts")],
      { winner: "opponent", reason: "bust", penaltyTarget: "player", bulletsAdded: 1}
    );
    const ordinaryWin = reveal([card("10"), card("8")], [card("10", "hearts"), card("7", "hearts")], comparison("player"));
    expect(resolveDialogueState(playerBust).event).toBe("PLAYER_BUST");
    expect(resolveDialogueState(ordinaryWin).event).toBe("PLAYER_WIN_ROUND");
  });

  it("distinguishes the three requested AI action contexts", () => {
    const firstHit = withActions({ type: "OPPONENT_HIT", value: 14 });
    const firstStand = withActions({ type: "OPPONENT_STOOD" });
    const repeatedHit = withActions(
      { type: "PLAYER_STOOD" },
      { type: "OPPONENT_HIT", value: 12 },
      { type: "OPPONENT_HIT", value: 16 }
    );
    expect(resolveDialogueState(firstHit).event).toBe("OPPONENT_FIRST_HIT");
    expect(resolveDialogueState(firstStand).event).toBe("OPPONENT_FIRST_STAND");
    expect(resolveDialogueState(repeatedHit).event).toBe("OPPONENT_REPEAT_HIT_AFTER_PLAYER_STAND");
  });

  it("returns exactly one registered pool for every match phase", () => {
    const phases: RoundPhase[] = [
      "dealing", "initial-blackjack-check", "turns", "settlement", "round-reveal",
      "roulette-reaction", "roulette-trigger", "roulette-result", "round-end"
    ];
    const base = turnsMatch();
    for (const phase of phases) {
      const state = { ...base, round: { ...base.round, phase } };
      const selected = resolveDialogueState(state);
      expect(DIALOGUE_EVENT_CODES).toContain(selected.event);
      expect(typeof selected.event).toBe("string");
    }
  });

  it("has a reachable, non-overlapping state for every active dialogue pool", () => {
    const playerBlackjack = findMatch((state) => state.round.outcome?.reason === "blackjack" && state.round.outcome.winner === "player");
    const opponentBlackjack = findMatch((state) => state.round.outcome?.reason === "blackjack" && state.round.outcome.winner === "opponent");
    const push: RoundOutcome = { winner: null, reason: "push", penaltyTarget: null, bulletsAdded: 0};
    const states: MatchState[] = [
      turnsMatch(),
      withActions({ type: "PLAYER_HIT", value: 14 }),
      withActions({ type: "PLAYER_STOOD" }),
      withActions({ type: "OPPONENT_HIT", value: 14 }),
      withActions({ type: "OPPONENT_STOOD" }),
      withActions({ type: "PLAYER_STOOD" }, { type: "OPPONENT_HIT", value: 12 }, { type: "OPPONENT_HIT", value: 16 }),
      playerBlackjack,
      opponentBlackjack,
      reveal([card("10"), card("9"), card("5")], [card("10", "hearts"), card("8", "hearts")], { winner: "opponent", reason: "bust", penaltyTarget: "player", bulletsAdded: 1}),
      reveal([card("10"), card("8")], [card("10", "hearts"), card("9", "hearts"), card("5", "clubs")], { winner: "player", reason: "bust", penaltyTarget: "opponent", bulletsAdded: 1}),
      triggerState("player", "empty-chamber"),
      triggerState("opponent", "empty-chamber"),
      triggerState("player", "misfire"),
      triggerState("opponent", "misfire"),
      reveal([card("10"), card("7")], [card("10", "hearts"), card("8", "hearts")], comparison("opponent")),
      reveal([card("10"), card("7")], [card("9", "hearts"), card("8", "hearts")], push),
      rouletteState("roulette-reaction"),
      rouletteState("roulette-trigger"),
      triggerState("player", "fired"),
      triggerState("opponent", "fired"),
      reveal([card("A"), card("K")], [card("A", "hearts"), card("Q", "hearts")], push),
      reveal([card("10"), card("Q")], [card("10", "hearts"), card("9", "hearts")], comparison("player")),
      reveal([card("10"), card("3")], [card("8", "hearts"), card("5", "hearts")], push)
    ];
    const selected = states.map((state) => resolveDialogueState(state).event);
    expect(new Set(selected)).toEqual(new Set(DIALOGUE_EVENT_CODES));
    expect(selected).toHaveLength(DIALOGUE_EVENT_CODES.length);
  });
});
