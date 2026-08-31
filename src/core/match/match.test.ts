import { describe, expect, it } from "vitest";
import { createCard } from "../blackjack/card";
import { createHand, handValue } from "../blackjack/hand";
import { createRng } from "../rng/seeded";
import { buildObservation } from "../ai/observation";
import { decideAiAction, finalHitProbability } from "../ai/policy";
import { addBullets, createGun, deathProbability, pullTrigger } from "../roulette/roulette";
import { chooseDialogue } from "../../dialogue/types";
import wData from "../../content/characters/data/w.json";
import { createMatch, gameReducer, getLegalActions, resolveRound } from "./reducer";
import type { MatchState, ParticipantState, RoundState } from "./types";

const W_DIALOGUE = wData.dialogue;

const card = (rank: Parameters<typeof createCard>[1], suit: Parameters<typeof createCard>[0] = "spades") => createCard(suit, rank);

function withHands(state: MatchState, playerCards: ReturnType<typeof card>[], opponentCards: ReturnType<typeof card>[], actor: "player" | "opponent" = "player"): MatchState {
  const player: ParticipantState = { id: "player", hand: createHand(playerCards), stood: false, busted: false };
  const opponent: ParticipantState = { id: "opponent", hand: createHand(opponentCards), stood: false, busted: false };
  const round: RoundState = { ...state.round, phase: "turns", currentActor: actor, player, opponent, outcome: null };
  return { ...state, player, opponent, round, roundIndex: round.index, status: "active", scene: "match", view: "table", outcome: undefined };
}

function findSeed(predicate: (state: MatchState) => boolean): string {
  for (let index = 0; index < 10000; index += 1) {
    const seed = `case-${index}`;
    if (predicate(createMatch(seed))) return seed;
  }
  throw new Error("No deterministic fixture seed found");
}

describe("createMatch and legal actions", () => {
  it("deals a round, gives two opening skills with early preparation, and starts with the opponent", () => {
    const state = createMatch(findSeed((candidate) => candidate.round.phase === "turns"));
    expect(state.round.phase).toBe("turns");
    expect(state.round.starter).toBe("opponent");
    expect(state.round.currentActor).toBe("opponent");
    expect(state.player.hand.cards).toHaveLength(2);
    expect(state.opponent.hand.cards).toHaveLength(2);
    expect(state.skills.cards).toHaveLength(2);
    expect(getLegalActions(state)).toEqual(expect.arrayContaining([{ type: "AI_TURN" }, { type: "ESCAPE_MATCH" }]));
    expect(getLegalActions(state)).not.toContainEqual({ type: "PLAYER_HIT" });
  });

  it("applies exactly one opponent move for one AI interaction", () => {
    const state = createMatch(findSeed((candidate) => candidate.round.phase === "turns" && candidate.round.currentActor === "opponent"));
    const next = gameReducer(state, { type: "AI_TURN" });
    const added = next.history.slice(state.history.length);
    expect(added.filter((event) => event.type === "AI_DECISION")).toHaveLength(1);
    expect(added.filter((event) => event.type === "OPPONENT_HIT" || event.type === "OPPONENT_STOOD")).toHaveLength(1);
  });

  it("settles initial Blackjack immediately with a double penalty and two rewards", () => {
    const seed = findSeed((candidate) => candidate.history.some((event) => event.type === "INITIAL_BLACKJACK_CHECK" && event.player && !event.opponent));
    const state = createMatch(seed);
    expect(state.history).toContainEqual({ type: "BLACKJACK", actor: "player" });
    expect(state.history).toContainEqual({ type: "BULLET_ADDED", actor: "opponent", amount: 2 });
    expect(state.history).toContainEqual(expect.objectContaining({ type: "ROUND_RESOLVED", outcome: expect.objectContaining({ reason: "blackjack", winner: "player", playerSkillReward: 2 }) }));
    expect(state.skills.cards.length).toBeGreaterThanOrEqual(3);
  });

  it("automatically stands on 21 and prevents another player hit", () => {
    const base = createMatch("auto-21");
    const state: MatchState = { ...withHands(base, [card("10"), card("9")], [card("10"), card("7")]), shoe: { cards: [card("2", "hearts")], cursor: 0, shuffleIndex: 1 } };
    const next = gameReducer(state, { type: "PLAYER_HIT" });
    expect(next.player.stood).toBe(true);
    expect(next.round.currentActor).toBe("opponent");
    expect(getLegalActions(next)).not.toContainEqual({ type: "PLAYER_HIT" });
  });

  it("keeps the opponent as starter after a survived round", () => {
    const state = createMatch(findSeed((candidate) => candidate.round.phase === "turns"));
    const completed = gameReducer(withHands(state, [card("10"), card("7")], [card("10"), card("7")]), { type: "PLAYER_STAND" });
    const reveal = gameReducer(completed, { type: "AI_STAND" });
    expect(reveal.round.phase).toBe("round-reveal");
    const next = gameReducer(reveal, { type: "ACK_ROUND_RESULT" });
    expect(next.round.index).toBe(1);
    expect(next.round.starter).toBe("opponent");
    expect(next.round.currentActor).toBe("opponent");
  });
});

describe("round resolution and roulette", () => {
  it("waits for confirmation after both players open with Blackjack", () => {
    const seed = findSeed((candidate) => candidate.history.some((event) => event.type === "INITIAL_BLACKJACK_CHECK" && event.player && event.opponent));
    const state = createMatch(seed);
    expect(state.round.index).toBe(0);
    expect(state.round.phase).toBe("round-reveal");
    expect(getLegalActions(state)).toContainEqual({ type: "ACK_ROUND_RESULT" });
    expect(state.history.filter((event) => event.type === "BLACKJACK")).toHaveLength(2);
    expect(gameReducer(state, { type: "ACK_ROUND_RESULT" }).round.index).toBe(1);
  });
  it("resolves a player bust immediately and waits for the reaction window", () => {
    const base = createMatch("bust-fixture");
    const state: MatchState = { ...withHands(base, [card("10"), card("9")], [card("10"), card("7")]), shoe: { cards: [card("5", "hearts")], cursor: 0, shuffleIndex: 1 } };
    const next = gameReducer(state, { type: "PLAYER_HIT" });
    expect(next.round.phase).toBe("round-reveal");
    expect(next.round.outcome).toMatchObject({ winner: "opponent", reason: "bust", penaltyTarget: "player", bulletsAdded: 1 });
    expect(next.roulette.player.bullets).toBe(1);
    expect(next.player.busted).toBe(true);
    expect(getLegalActions(next)).toEqual(expect.arrayContaining([{ type: "ACK_ROUND_RESULT" }]));
  });

  it("waits after result acknowledgement before triggering the opponent gun", () => {
    const base = createMatch("opponent-trigger");
    const state = withHands(base, [card("10"), card("9")], [card("10"), card("8")]);
    const loaded: MatchState = { ...state, roulette: { ...state.roulette, opponent: { capacity: 6, bullets: 5 } } };
    const reveal = gameReducer(gameReducer(loaded, { type: "PLAYER_STAND" }), { type: "AI_STAND" });
    const waiting = gameReducer(reveal, { type: "ACK_ROUND_RESULT" });
    expect(waiting.round.phase).toBe("roulette-trigger");
    expect(waiting.history.some((event) => event.type === "TRIGGER_PULLED")).toBe(false);
    const trigger = gameReducer(waiting, { type: "TRIGGER_ROULETTE" });
    expect(trigger.status).toBe("finished");
    expect(trigger.view).toBe("table");
    expect(trigger.outcome).toEqual({ winner: "player", reason: "opponent-killed" });
    expect(trigger.history.some((event) => event.type === "TRIGGER_PULLED" && event.actor === "opponent" && event.fired)).toBe(true);
    const summary = gameReducer(trigger, { type: "ACK_TRIGGER_RESULT" });
    expect(summary.view).toBe("match-summary");
  });

  it("keeps a survived trigger paused until its acknowledgement", () => {
    const base = createMatch(findSeed((candidate) => {
      const hands = withHands(candidate, [card("10"), card("9")], [card("10"), card("8")]);
      const reveal = gameReducer(gameReducer(hands, { type: "PLAYER_STAND" }), { type: "AI_STAND" });
      const waiting = gameReducer(reveal, { type: "ACK_ROUND_RESULT" });
      const result = gameReducer(waiting, { type: "TRIGGER_ROULETTE" });
      return result.history.some((event) => event.type === "TRIGGER_PULLED" && !event.fired);
    }));
    const state = withHands(base, [card("10"), card("9")], [card("10"), card("8")]);
    const reveal = gameReducer(gameReducer(state, { type: "PLAYER_STAND" }), { type: "AI_STAND" });
    const waiting = gameReducer(reveal, { type: "ACK_ROUND_RESULT" });
    const result = gameReducer(waiting, { type: "TRIGGER_ROULETTE" });
    expect(result.round.phase).toBe("roulette-result");
    expect(getLegalActions(result)).toContainEqual({ type: "ACK_TRIGGER_RESULT" });
    const next = gameReducer(result, { type: "ACK_TRIGGER_RESULT" });
    expect(next.round.index).toBe(1);
  });

  it("requires push confirmation before dealing the next round", () => {
    const base = createMatch("push-fixture");
    const state = withHands(base, [card("10"), card("7")], [card("10"), card("7")]);
    const reveal = gameReducer(gameReducer(state, { type: "PLAYER_STAND" }), { type: "AI_STAND" });
    expect(reveal.status).toBe("active");
    expect(reveal.round.phase).toBe("round-reveal");
    expect(reveal.round.index).toBe(0);
    expect(getLegalActions(reveal)).toContainEqual({ type: "ACK_ROUND_RESULT" });
    const next = gameReducer(reveal, { type: "ACK_ROUND_RESULT" });
    expect(next.round.index).toBe(1);
    expect(next.roulette.player.bullets).toBe(0);
    expect(next.roulette.opponent.bullets).toBe(0);
  });

  it("sends an opponent initial Blackjack to the player's roulette reaction", () => {
    const seed = findSeed((candidate) => candidate.history.some((event) => event.type === "INITIAL_BLACKJACK_CHECK" && !event.player && event.opponent));
    const state = createMatch(seed);
    expect(state.history).toContainEqual({ type: "BLACKJACK", actor: "opponent" });
    expect(state.round.outcome).toMatchObject({ winner: "opponent", reason: "blackjack", penaltyTarget: "player", bulletsAdded: 2, playerSkillReward: 0 });
    expect(state.round.phase).toBe("round-reveal");
    expect(state.roulette.player.bullets).toBe(2);
    expect(getLegalActions(state)).toContainEqual({ type: "ACK_ROUND_RESULT" });
    const reaction = gameReducer(state, { type: "ACK_ROUND_RESULT" });
    expect(reaction.round.phase).toBe("roulette-reaction");
    expect(getLegalActions(reaction)).toContainEqual({ type: "TRIGGER_ROULETTE" });
  });

  it("models bullet probability and clamps loading/removal", () => {
    const empty = createGun();
    expect(deathProbability(empty)).toBe(0);
    const loaded = addBullets(empty, 9);
    expect(loaded.bullets).toBe(6);
    expect(deathProbability(loaded)).toBe(1);
    expect(pullTrigger(loaded, createRng("certain")).result.fired).toBe(true);
  });
});

describe("skills", () => {
  it("shows Hunter advice and clears it on the next action", () => {
    const base = createMatch("hunter");
    const player = { id: "player" as const, hand: createHand([card("10"), card("6")]), stood: false, busted: false };
    const opponent = { id: "opponent" as const, hand: createHand([card("10"), card("7")]), stood: false, busted: false };
    const round: RoundState = { ...base.round, phase: "turns", currentActor: "player", player, opponent, outcome: null };
    const state: MatchState = { ...base, player, opponent, round, skills: { ...base.skills, cards: ["hunter-instinct"] }, shoe: { cards: [card("2", "hearts")], cursor: 0, shuffleIndex: 1 } };
    const advised = gameReducer(state, { type: "USE_SKILL", skillId: "hunter-instinct" });
    expect(advised.skills.advice).toBe("hit");
    expect(gameReducer(advised, { type: "PLAYER_STAND" }).skills.advice).toBeNull();
  });

  it("gives one opening card without Early Preparation", () => {
    const state = createMatch(findSeed((candidate) => candidate.round.phase === "turns"), { equippedSkillIds: ["hunter-instinct", "switcheroo", "rhodes-heartthrob"] });
    expect(state.skills.cards).toHaveLength(1);
  });

  it("Night Queen guarantees 21 even when no matching shoe card exists", () => {
    const base = createMatch("night-queen");
    const state = { ...withHands(base, [card("6", "hearts"), card("6", "hearts")], [card("10"), card("7")]), skills: { ...base.skills, equippedSkillIds: ["night-queen"], cards: ["night-queen"] }, shoe: { cards: [card("2", "clubs")], cursor: 0, shuffleIndex: 1 } };
    const armed = gameReducer(state, { type: "USE_SKILL", skillId: "night-queen" });
    const hit = gameReducer(armed, { type: "PLAYER_HIT" });
    expect(hit.player.hand.cards).toHaveLength(3);
    expect(handValue(hit.player.hand)).toBe(21);
    expect(hit.shoe.cursor).toBe(1);
    expect(hit.skills.nightQueenArmed).toBe(false);
    expect(hit.history).toContainEqual(expect.objectContaining({ type: "PLAYER_HIT" }));
    expect(hit.history).toContainEqual(expect.objectContaining({ type: "PLAYER_STOOD" }));
  });

  it("does not consume a second Night Queen while already armed", () => {
    const base = createMatch("night-queen-repeat");
    const state = { ...withHands(base, [card("6", "hearts"), card("6", "hearts")], [card("10"), card("7")]), skills: { ...base.skills, equippedSkillIds: ["night-queen"], cards: ["night-queen", "night-queen"] }, shoe: { cards: [card("9", "clubs")], cursor: 0, shuffleIndex: 1 } };
    const armed = gameReducer(state, { type: "USE_SKILL", skillId: "night-queen" });
    const repeated = gameReducer(armed, { type: "USE_SKILL", skillId: "night-queen" });
    expect(repeated).toBe(armed);
    expect(repeated.skills.cards).toEqual(["night-queen"]);
  });

  it("Switcheroo resolves immediately when the opponent already stood", () => {
    const base = createMatch("switcheroo-stood");
    const state = { ...withHands(base, [card("10"), card("9")], [card("10"), card("7")]), skills: { ...base.skills, cards: ["switcheroo"] }, opponent: { ...base.opponent, stood: true }, round: { ...withHands(base, [card("10"), card("9")], [card("10"), card("7")]).round, currentActor: "player" as const, opponent: { ...base.opponent, hand: createHand([card("10"), card("7")]), stood: true, busted: false } }, shoe: { cards: [card("A", "clubs")], cursor: 0, shuffleIndex: 1 } };
    const next = gameReducer(state, { type: "USE_SKILL", skillId: "switcheroo" });
    expect(next.round.phase).toBe("round-reveal");
    expect(next.round.outcome?.winner).toBe("player");
    expect(next.history.some((event) => event.type === "PLAYER_HIT")).toBe(false);
  });

  it("Rhodes Heartthrob avoids a non-full player trigger after loading", () => {
    const base = createMatch("rhodes");
    const state = { ...withHands(base, [card("10"), card("7")], [card("10"), card("8")]), skills: { ...base.skills, cards: ["rhodes-heartthrob"] } };
    const armed = gameReducer(state, { type: "USE_SKILL", skillId: "rhodes-heartthrob" });
    const reveal = gameReducer(gameReducer(armed, { type: "PLAYER_STAND" }), { type: "AI_STAND" });
    const next = gameReducer(reveal, { type: "ACK_ROUND_RESULT" });
    expect(next.history).toContainEqual({ type: "TRIGGER_AVOIDED_BY_SKILL", actor: "player", skillId: "rhodes-heartthrob" });
    expect(next.history.some((event) => event.type === "TRIGGER_PULLED")).toBe(false);
    expect(next.round.index).toBe(1);
  });

  it("Rhodes Heartthrob is ineffective when loading fills the gun", () => {
    const base = createMatch("rhodes-full");
    const state = { ...withHands(base, [card("10"), card("7")], [card("10"), card("8")]), skills: { ...base.skills, cards: ["rhodes-heartthrob"] }, roulette: { ...base.roulette, player: { capacity: 6, bullets: 5 } } };
    const armed = gameReducer(state, { type: "USE_SKILL", skillId: "rhodes-heartthrob" });
    const reveal = gameReducer(gameReducer(armed, { type: "PLAYER_STAND" }), { type: "AI_STAND" });
    const reaction = gameReducer(reveal, { type: "ACK_ROUND_RESULT" });
    expect(reaction.round.phase).toBe("roulette-reaction");
    expect(reaction.history.some((event) => event.type === "TRIGGER_AVOIDED_BY_SKILL")).toBe(false);
  });

  it("keeps player turn after a non-21 Switcheroo", () => {
    const base = createMatch("switcheroo-continue");
    const state = { ...withHands(base, [card("10"), card("5")], [card("10"), card("7")]), skills: { ...base.skills, cards: ["switcheroo"] }, shoe: { cards: [card("2", "clubs")], cursor: 0, shuffleIndex: 1 } };
    const next = gameReducer(state, { type: "USE_SKILL", skillId: "switcheroo" });
    expect(next.round.currentActor).toBe("player");
    expect(next.round.phase).toBe("turns");
    expect(next.history.some((event) => event.type === "PLAYER_HIT")).toBe(false);
  });

  it("Siracusan Fury doubles only a lower, non-Blackjack opponent load and clamps", () => {
    const base = createMatch("fury");
    const state = { ...base, skills: { ...base.skills, equippedSkillIds: ["siracusan-fury"] }, roulette: { player: { capacity: 6, bullets: 3 }, opponent: { capacity: 6, bullets: 0 } } };
    const doubled = resolveRound(state, { winner: "player", reason: "comparison", penaltyTarget: "opponent", bulletsAdded: 1, playerSkillReward: 0 });
    expect(doubled.round.outcome?.bulletsAdded).toBe(2);
    expect(doubled.roulette.opponent.bullets).toBe(2);
    const equal = resolveRound({ ...state, roulette: { ...state.roulette, opponent: { capacity: 6, bullets: 3 } } }, { winner: "player", reason: "comparison", penaltyTarget: "opponent", bulletsAdded: 1, playerSkillReward: 0 });
    expect(equal.round.outcome?.bulletsAdded).toBe(1);
    const blackjack = resolveRound({ ...state, roulette: { player: { capacity: 6, bullets: 5 }, opponent: { capacity: 6, bullets: 5 } } }, { winner: "player", reason: "blackjack", penaltyTarget: "opponent", bulletsAdded: 2, playerSkillReward: 0 });
    expect(blackjack.round.outcome?.bulletsAdded).toBe(2);
    expect(blackjack.roulette.opponent.bullets).toBe(6);
    const clamped = resolveRound({ ...state, roulette: { player: { capacity: 6, bullets: 6 }, opponent: { capacity: 6, bullets: 5 } } }, { winner: "player", reason: "comparison", penaltyTarget: "opponent", bulletsAdded: 1, playerSkillReward: 0 });
    expect(clamped.round.outcome?.bulletsAdded).toBe(2);
    expect(clamped.roulette.opponent.bullets).toBe(6);
  });
});

describe("observation and AI", () => {
  it("never gives AI the player's private cards or shoe order", () => {
    const state = createMatch("observation");
    const observation = buildObservation(state, "opponent");
    expect(observation.player.cards[0]).not.toBeNull();
    expect(observation.player.cards[1]).toBeNull();
    expect(observation.opponent.cards.every((entry) => entry !== null)).toBe(true);
    expect(JSON.stringify(observation)).not.toContain(JSON.stringify(state.player.hand.cards[1]));
    expect("shoe" in observation).toBe(false);
  });

  it("applies the documented rationality/personality formula with deterministic roll", () => {
    expect(finalHitProbability({ rationality: 0.8, personalityHitProbability: 1 }, 0)).toBeCloseTo(0.2);
    const state = createMatch("ai-debug");
    const result = decideAiAction(buildObservation(state, "opponent"), { rationality: 0.8, personalityHitProbability: 1 }, createRng("ai-roll"));
    expect(result.decision).toEqual(expect.objectContaining({ rationality: 0.8, personalityHitProbability: 1, optimalHit: expect.any(Number), finalHitProbability: expect.any(Number), roll: expect.any(Number), action: expect.any(String) }));
  });
});

describe("deterministic match replay and isolated dialogue stream", () => {
  function replay(seed: string): MatchState {
    let state = createMatch(seed);
    for (let step = 0; step < 40 && state.status === "active"; step += 1) {
      const legal = getLegalActions(state);
      const action = legal.find((candidate) => candidate.type === "AI_TURN")
        ?? legal.find((candidate) => candidate.type === "PLAYER_STAND")
        ?? legal.find((candidate) => candidate.type === "ACK_ROUND_RESULT")
        ?? legal.find((candidate) => candidate.type === "TRIGGER_ROULETTE")
        ?? legal.find((candidate) => candidate.type === "ACK_TRIGGER_RESULT")
        ?? legal.find((candidate) => candidate.type === "CONTINUE_ROUND");
      if (!action) break;
      state = gameReducer(state, action);
    }
    return state;
  }

  it("returns the same full state for the same seed and actions", () => {
    expect(replay("replay-seed")).toEqual(replay("replay-seed"));
  });

  it("does not let dialogue draws change deck or roulette streams", () => {
    const deckA = createRng("match:deck");
    const deckB = createRng("match:deck");
    const rouletteA = createRng("match:roulette");
    const rouletteB = createRng("match:roulette");
    const dialogue = createRng("match:dialogue");
    for (let index = 0; index < 10; index += 1) {
      chooseDialogue(W_DIALOGUE, "PLAYER_HIT", dialogue);
      chooseDialogue(W_DIALOGUE, "OPPONENT_BUST", dialogue);
      expect(deckA.next()).toBe(deckB.next());
      expect(rouletteA.next()).toBe(rouletteB.next());
    }
  });
});

describe("match lifecycle", () => {
  it("supports escape only through summary and acknowledgement", () => {
    const escaped = gameReducer(createMatch("escape"), { type: "ESCAPE_MATCH" });
    expect(escaped.status).toBe("finished");
    expect(escaped.view).toBe("match-summary");
    expect(escaped.outcome).toEqual({ winner: null, reason: "escaped" });
    expect(getLegalActions(escaped)).toEqual([{ type: "ACK_MATCH_RESULT" }]);
    const lobby = gameReducer(escaped, { type: "ACK_MATCH_RESULT" });
    expect(lobby.scene).toBe("lobby");
    expect(lobby.history.at(-1)).toEqual({ type: "MATCH_RESULT_ACKNOWLEDGED" });
  });
});
