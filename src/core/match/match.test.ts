import { describe, expect, it } from "vitest";
import { createCard, createDerivedCard } from "../blackjack/card";
import { createHand, handValue } from "../blackjack/hand";
import type { Card } from "../blackjack/types";
import { createRng, SeededRng } from "../rng/seeded";
import { buildObservation } from "../ai/observation";
import { calculateAiThreshold, decideAiAction, sampleAiNoise } from "../ai/policy";
import { addBullets, createGun, deathProbability, pullTrigger } from "../roulette/roulette";
import { chooseDialogue } from "../../dialogue/types";
import wData from "../../content/characters/data/w.json";
import { createMatch, gameReducer, getLegalActions, normalizeAbilityHands, resolveRound } from "./reducer";
import type { MatchState, ParticipantState, RoundState } from "./types";

const W_DIALOGUE = wData.dialogue;

const card = (rank: Parameters<typeof createCard>[1], suit: Parameters<typeof createCard>[0] = "spades") => createCard(suit, rank);
const skillCard = (definitionId: string, instanceId = `test-${definitionId}`) => ({ kind: "player-skill" as const, definitionId, owner: "player" as const, instanceId });

function withHands(state: MatchState, playerCards: Card[], opponentCards: Card[], actor: "player" | "opponent" = "player"): MatchState {
  const player: ParticipantState = { id: "player", hand: createHand(playerCards), stood: false, busted: false };
  const opponent: ParticipantState = { id: "opponent", hand: createHand(opponentCards), stood: false, busted: false };
  const round: RoundState = { ...state.round, phase: "turns", currentActor: actor, player, opponent, outcome: null };
  return { ...state, player, opponent, round, roundIndex: round.index, status: "active", scene: "match", view: "table", outcome: undefined };
}

function withSkillCard(state: MatchState, definitionId: string, instanceId = `contract-${definitionId}`): MatchState {
  const cardInstance = skillCard(definitionId, instanceId);
  const oldCardIds = new Set(state.skills.cards.map((entry) => entry.instanceId));
  const sequence = state.abilities.sequence + 1;
  return {
    ...state,
    skills: { ...state.skills, equippedSkillIds: [definitionId], cards: [cardInstance] },
    abilities: {
      ...state.abilities,
      instances: [...state.abilities.instances.filter((instance) => !oldCardIds.has(instance.instanceId)), { ...cardInstance, createdAtSequence: sequence, parameters: {} }],
      sequence
    }
  };
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
    expect(state.history.filter((event) => event.type === "ABILITY_TRIGGERED" && event.ruleId === "opening-draw")).toHaveLength(1);
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
  it("normalizes an ability-created bust through the same bust and round-resolution path", () => {
    const base = withHands(createMatch("ability-bust-normalization"), [card("K"), card("9"), card("5")], [card("10"), card("7")]);
    const next = normalizeAbilityHands(base);
    expect(next.player).toMatchObject({ busted: true, stood: true });
    expect(next.history).toContainEqual({ type: "BUST", actor: "player" });
    expect(next.round.phase).toBe("round-reveal");
    expect(next.round.outcome).toMatchObject({ winner: "opponent", reason: "bust", penaltyTarget: "player" });
    expect(next.roulette.player.bullets).toBe(1);
  });

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
    const state: MatchState = { ...base, player, opponent, round, skills: { ...base.skills, cards: [skillCard("hunter-instinct")] }, abilities: { ...base.abilities, instances: [...base.abilities.instances, { ...skillCard("hunter-instinct"), createdAtSequence: base.abilities.sequence + 1, parameters: {} }], sequence: base.abilities.sequence + 1 }, shoe: { cards: [card("2", "hearts")], cursor: 0, shuffleIndex: 1 } };
    const advised = gameReducer(state, { type: "PLAY_ABILITY", instanceId: "test-hunter-instinct" });
    expect(advised.skills.advice).toBe("hit");
    expect(gameReducer(advised, { type: "PLAYER_STAND" }).skills.advice).toBeNull();
  });

  it("broadcasts after-hand-changed only when an active ability actually mutates a hand", () => {
    const observer = [{ definitionId: "hand-change-observer", enabled: true, parameters: {} }];
    const hunterBase = withHands(createMatch("hunter-no-hand-event", { playerMechanics: observer }), [card("10"), card("6")], [card("10"), card("7")]);
    const hunter = withSkillCard(hunterBase, "hunter-instinct", "hunter-no-hand-event-card");
    const advised = gameReducer(hunter, { type: "PLAY_ABILITY", instanceId: "hunter-no-hand-event-card" });
    expect(advised.history.slice(hunter.history.length)).not.toContainEqual(expect.objectContaining({ type: "ABILITY_TRIGGERED", ruleId: "observe-owner-hand-change" }));

    const switchBase = withHands(createMatch("switch-hand-event", { playerMechanics: observer }), [card("10"), card("6")], [card("10"), card("7")]);
    const switcheroo = withSkillCard({ ...switchBase, shoe: { cards: [card("2", "clubs")], cursor: 0, shuffleIndex: 1 } }, "switcheroo", "switch-hand-event-card");
    const switched = gameReducer(switcheroo, { type: "PLAY_ABILITY", instanceId: "switch-hand-event-card" });
    expect(switched.history.slice(switcheroo.history.length)).toContainEqual(expect.objectContaining({ type: "ABILITY_TRIGGERED", ruleId: "observe-owner-hand-change" }));
  });

  it("gives one opening card without Early Preparation", () => {
    const state = createMatch(findSeed((candidate) => candidate.round.phase === "turns"), { equippedSkillIds: ["hunter-instinct", "switcheroo", "rhodes-heartthrob"] });
    expect(state.skills.cards).toHaveLength(1);
  });

  it.each(["hunter-instinct", "switcheroo", "rhodes-heartthrob", "night-queen"] as const)("exposes, resolves, and deterministically records the active %s contract", (definitionId) => {
    const makeState = (): MatchState => {
      const base = withHands(createMatch(`contract-${definitionId}`),
        definitionId === "night-queen" ? [card("6", "hearts"), card("6", "hearts")] : [card("10"), card("6")],
        [card("10"), card("7")]);
      return withSkillCard({ ...base, shoe: { cards: [card("2", "clubs"), card("A", "diamonds")], cursor: 0, shuffleIndex: 1 } }, definitionId);
    };
    const state = makeState();
    const action = { type: "PLAY_ABILITY" as const, instanceId: `contract-${definitionId}` };
    expect(getLegalActions(state)).toContainEqual(action);
    const opponentTurn = { ...state, round: { ...state.round, currentActor: "opponent" as const } };
    expect(getLegalActions(opponentTurn)).not.toContainEqual(action);
    const next = gameReducer(state, action);
    expect(next).not.toBe(state);
    expect(next.skills.cards.some((entry) => entry.instanceId === action.instanceId)).toBe(false);
    expect(next.history).toContainEqual(expect.objectContaining({ type: "ABILITY_PLAYED", instanceId: action.instanceId, definitionId }));
    expect(next.history).toContainEqual(expect.objectContaining({ type: "ABILITY_TRIGGERED", instanceId: action.instanceId }));
    expect(next).toEqual(gameReducer(makeState(), action));
  });

  it("does not expose or consume Switcheroo when the remaining draw pile has no candidate", () => {
    const base = withHands(createMatch("switcheroo-no-candidate"), [card("K"), card("9"), card("2")], [card("10"), card("7")]);
    const state = withSkillCard({ ...base, shoe: { cards: [card("K", "clubs")], cursor: 0, shuffleIndex: 1 } }, "switcheroo", "switcheroo-no-candidate-card");
    const action = { type: "PLAY_ABILITY" as const, instanceId: "switcheroo-no-candidate-card" };
    expect(getLegalActions(state)).not.toContainEqual(action);
    expect(gameReducer(state, action)).toBe(state);
    expect(state.skills.cards).toHaveLength(1);
  });

  it("Night Queen guarantees 21 even when no matching shoe card exists", () => {
    const base = createMatch("night-queen");
    const state = { ...withHands(base, [card("6", "hearts"), card("6", "hearts")], [card("10"), card("7")]), skills: { ...base.skills, equippedSkillIds: ["night-queen"], cards: [skillCard("night-queen")] }, abilities: { ...base.abilities, instances: [...base.abilities.instances, { ...skillCard("night-queen"), createdAtSequence: base.abilities.sequence + 1, parameters: {} }], sequence: base.abilities.sequence + 1 }, shoe: { cards: [card("2", "clubs")], cursor: 0, shuffleIndex: 1 } };
    const armed = gameReducer(state, { type: "PLAY_ABILITY", instanceId: "test-night-queen" });
    const hit = gameReducer(armed, { type: "PLAYER_HIT" });
    expect(hit.player.hand.cards).toHaveLength(3);
    expect(handValue(hit.player.hand)).toBe(21);
    expect(hit.player.hand.cards.at(-1)?.origin).toBe("derived");
    expect(hit.shoe.cursor).toBe(0);
    expect(hit.abilities.statuses.some((status) => status.statusDefinitionId === "night-queen-armed")).toBe(false);
    expect(hit.history).toContainEqual(expect.objectContaining({ type: "PLAYER_HIT" }));
    expect(hit.history).toContainEqual(expect.objectContaining({ type: "PLAYER_STOOD" }));
  });

  it("dissipates derived cards when they leave a hand or the round ends", () => {
    const derived = createDerivedCard("hearts", "5");
    const base = withHands(createMatch("derived-lifecycle"), [card("10"), derived], [card("10"), card("7")]);
    const switcheroo = withSkillCard({ ...base, shoe: { cards: [card("2", "clubs"), card("3", "diamonds")], cursor: 0, shuffleIndex: 1 } }, "switcheroo", "derived-switch");
    const replaced = gameReducer(switcheroo, { type: "PLAY_ABILITY", instanceId: "derived-switch" });
    expect(replaced.player.hand.cards.some((entry) => entry.origin === "derived")).toBe(false);
    expect(replaced.shoe.cards.every((entry) => entry.origin === "shoe")).toBe(true);
    expect(replaced.shoe.cursor).toBe(1);

    const endBase = withHands(createMatch("derived-round-end"), [card("10"), derived], [card("10"), card("7")]);
    const atRoundEnd = { ...endBase, round: { ...endBase.round, phase: "round-end" as const, currentActor: null } };
    const nextRound = gameReducer(atRoundEnd, { type: "CONTINUE_ROUND" });
    expect([...nextRound.player.hand.cards, ...nextRound.opponent.hand.cards].every((entry) => entry.origin === "shoe")).toBe(true);
    expect(nextRound.shoe.cards.every((entry) => entry.origin === "shoe")).toBe(true);
  });

  it("does not consume a second Night Queen while already armed", () => {
    const base = createMatch("night-queen-repeat");
    const state = { ...withHands(base, [card("6", "hearts"), card("6", "hearts")], [card("10"), card("7")]), skills: { ...base.skills, equippedSkillIds: ["night-queen"], cards: [skillCard("night-queen", "night-1"), skillCard("night-queen", "night-2")] }, abilities: { ...base.abilities, instances: [...base.abilities.instances, { ...skillCard("night-queen", "night-1"), createdAtSequence: base.abilities.sequence + 1, parameters: {} }, { ...skillCard("night-queen", "night-2"), createdAtSequence: base.abilities.sequence + 2, parameters: {} }], sequence: base.abilities.sequence + 2 }, shoe: { cards: [card("9", "clubs")], cursor: 0, shuffleIndex: 1 } };
    const armed = gameReducer(state, { type: "PLAY_ABILITY", instanceId: "night-1" });
    const repeated = gameReducer(armed, { type: "PLAY_ABILITY", instanceId: "night-2" });
    expect(repeated).toBe(armed);
    expect(repeated.skills.cards).toHaveLength(1);
  });

  it("does not consume a second Rhodes Heartthrob while its round status is armed", () => {
    const base = withHands(createMatch("rhodes-repeat"), [card("10"), card("6")], [card("10"), card("7")]);
    const first = skillCard("rhodes-heartthrob", "rhodes-repeat-1");
    const second = skillCard("rhodes-heartthrob", "rhodes-repeat-2");
    const state: MatchState = {
      ...base,
      skills: { ...base.skills, equippedSkillIds: ["rhodes-heartthrob"], cards: [first, second] },
      abilities: {
        ...base.abilities,
        instances: [...base.abilities.instances, { ...first, createdAtSequence: base.abilities.sequence + 1, parameters: {} }, { ...second, createdAtSequence: base.abilities.sequence + 2, parameters: {} }],
        sequence: base.abilities.sequence + 2
      }
    };
    const armed = gameReducer(state, { type: "PLAY_ABILITY", instanceId: first.instanceId });
    expect(gameReducer(armed, { type: "PLAY_ABILITY", instanceId: second.instanceId })).toBe(armed);
    expect(armed.skills.cards).toContainEqual(second);
  });

  it("Switcheroo resolves immediately when the opponent already stood", () => {
    const base = createMatch("switcheroo-stood");
    const state = { ...withHands(base, [card("10"), card("9")], [card("10"), card("7")]), skills: { ...base.skills, cards: [skillCard("switcheroo")] }, abilities: { ...base.abilities, instances: [...base.abilities.instances, { ...skillCard("switcheroo"), createdAtSequence: base.abilities.sequence + 1, parameters: {} }], sequence: base.abilities.sequence + 1 }, opponent: { ...base.opponent, stood: true }, round: { ...withHands(base, [card("10"), card("9")], [card("10"), card("7")]).round, currentActor: "player" as const, opponent: { ...base.opponent, hand: createHand([card("10"), card("7")]), stood: true, busted: false } }, shoe: { cards: [card("A", "clubs")], cursor: 0, shuffleIndex: 1 } };
    const next = gameReducer(state, { type: "PLAY_ABILITY", instanceId: "test-switcheroo" });
    expect(next.round.phase).toBe("round-reveal");
    expect(next.round.outcome?.winner).toBe("player");
    expect(next.history.some((event) => event.type === "PLAYER_HIT")).toBe(false);
  });

  it("Rhodes Heartthrob avoids a non-full player trigger after loading", () => {
    const base = createMatch("rhodes");
    const state = { ...withHands(base, [card("10"), card("7")], [card("10"), card("8")]), skills: { ...base.skills, cards: [skillCard("rhodes-heartthrob")] }, abilities: { ...base.abilities, instances: [...base.abilities.instances, { ...skillCard("rhodes-heartthrob"), createdAtSequence: base.abilities.sequence + 1, parameters: {} }], sequence: base.abilities.sequence + 1 } };
    const armed = gameReducer(state, { type: "PLAY_ABILITY", instanceId: "test-rhodes-heartthrob" });
    const reveal = gameReducer(gameReducer(armed, { type: "PLAYER_STAND" }), { type: "AI_STAND" });
    const reaction = gameReducer(reveal, { type: "ACK_ROUND_RESULT" });
    const next = gameReducer(reaction, { type: "TRIGGER_ROULETTE" });
    expect(next.history.some((event) => event.type === "PENDING_EVENT_CANCELLED")).toBe(true);
    expect(next.history).toContainEqual(expect.objectContaining({ type: "STATUS_REMOVED", statusDefinitionId: "rhodes-heartthrob-armed", reason: "consumed" }));
    expect(next.abilities.instances.some((instance) => instance.instanceId === "test-rhodes-heartthrob")).toBe(false);
    expect(next.history.some((event) => event.type === "TRIGGER_PULLED")).toBe(false);
    expect(next.round.index).toBe(1);
  });

  it("Rhodes Heartthrob is ineffective when loading fills the gun", () => {
    const base = createMatch("rhodes-full");
    const state = { ...withHands(base, [card("10"), card("7")], [card("10"), card("8")]), skills: { ...base.skills, cards: [skillCard("rhodes-heartthrob")] }, abilities: { ...base.abilities, instances: [...base.abilities.instances, { ...skillCard("rhodes-heartthrob"), createdAtSequence: base.abilities.sequence + 1, parameters: {} }], sequence: base.abilities.sequence + 1 }, roulette: { ...base.roulette, player: { capacity: 6, bullets: 5 } } };
    const armed = gameReducer(state, { type: "PLAY_ABILITY", instanceId: "test-rhodes-heartthrob" });
    const reveal = gameReducer(gameReducer(armed, { type: "PLAYER_STAND" }), { type: "AI_STAND" });
    const reaction = gameReducer(reveal, { type: "ACK_ROUND_RESULT" });
    expect(reaction.round.phase).toBe("roulette-reaction");
    const fired = gameReducer(reaction, { type: "TRIGGER_ROULETTE" });
    expect(fired.status).toBe("finished");
    expect(fired.abilities.statuses.some((status) => status.statusDefinitionId === "rhodes-heartthrob-armed")).toBe(false);
    expect(fired.history).toContainEqual(expect.objectContaining({ type: "STATUS_REMOVED", statusDefinitionId: "rhodes-heartthrob-armed", reason: "expired" }));
  });

  it("keeps player turn after a non-21 Switcheroo", () => {
    const base = createMatch("switcheroo-continue");
    const state = { ...withHands(base, [card("10"), card("5")], [card("10"), card("7")]), skills: { ...base.skills, cards: [skillCard("switcheroo")] }, abilities: { ...base.abilities, instances: [...base.abilities.instances, { ...skillCard("switcheroo"), createdAtSequence: base.abilities.sequence + 1, parameters: {} }], sequence: base.abilities.sequence + 1 }, shoe: { cards: [card("2", "clubs")], cursor: 0, shuffleIndex: 1 } };
    const next = gameReducer(state, { type: "PLAY_ABILITY", instanceId: "test-switcheroo" });
    expect(next.player.hand.cards.at(-1)).not.toEqual(card("5"));
    expect(next.shoe.cards).toContainEqual(card("5"));
    expect(next.shoe.cursor).toBe(0);
    expect(next.round.currentActor).toBe("player");
    expect(next.round.phase).toBe("turns");
    expect(next.history.some((event) => event.type === "PLAYER_HIT")).toBe(false);
  });

  it("Siracusan Fury doubles only a lower, non-Blackjack opponent load and clamps", () => {
    const base = createMatch("fury");
    const state = { ...base, skills: { ...base.skills, equippedSkillIds: ["siracusan-fury"] }, abilities: { ...base.abilities, instances: [{ kind: "player-skill" as const, definitionId: "siracusan-fury", owner: "player" as const, instanceId: "fury", createdAtSequence: base.abilities.sequence + 1, parameters: {} }], sequence: base.abilities.sequence + 1 }, roulette: { player: { capacity: 6, bullets: 3 }, opponent: { capacity: 6, bullets: 0 } } };
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

  it("applies the documented threshold formula and hits at the inclusive boundary", () => {
    const profile = { P: 0.25, A: 1.5, B: 2, C: 0.5 };
    const noise = { match: 0.2, play: -0.1 };
    const base = withHands(createMatch("ai-threshold"), [card("10"), card("7")], [card("10"), card("6")], "opponent");
    const state = { ...base, roulette: { player: { capacity: 6, bullets: 5 }, opponent: { capacity: 6, bullets: 1 } } };
    const observation = buildObservation(state, "opponent");
    expect(calculateAiThreshold(observation, profile, noise)).toBeCloseTo(17.2);
    expect(decideAiAction(observation, profile, noise)).toEqual({
      handValue: 16,
      threshold: expect.closeTo(17.2),
      bulletDifference: 4,
      matchNoise: 0.2,
      playNoise: -0.1,
      action: "hit"
    });

    const neutral = { P: 0, A: 1, B: 1, C: 1 };
    const equalGuns = { player: { capacity: 6, bullets: 0 }, opponent: { capacity: 6, bullets: 0 } };
    const sixteen = { ...base, roulette: equalGuns };
    const seventeen = withHands(sixteen, [card("10"), card("7")], [card("10"), card("7")], "opponent");
    expect(decideAiAction(buildObservation(sixteen, "opponent"), neutral, { match: 0, play: 0 }).action).toBe("hit");
    expect(decideAiAction(buildObservation(seventeen, "opponent"), neutral, { match: 0, play: 0 }).action).toBe("stand");
  });

  it("keeps Rmatch for the match and samples one new Rplay per hand", () => {
    const state = createMatch("ai-noise-lifecycle");
    expect(state.aiNoise.match).toBeGreaterThanOrEqual(-0.3);
    expect(state.aiNoise.match).toBeLessThan(0.3);
    expect(state.aiNoise.play).toBeGreaterThanOrEqual(-0.3);
    expect(state.aiNoise.play).toBeLessThan(0.3);
    expect(createMatch("ai-noise-lifecycle").aiNoise).toEqual(state.aiNoise);

    const ai = SeededRng.fromSnapshot(state.rng.ai);
    const expectedPlayNoise = sampleAiNoise(ai);
    const outcome = { winner: null, reason: "push", penaltyTarget: null, bulletsAdded: 0, playerSkillReward: 0 } as const;
    const ready = { ...state, round: { ...state.round, phase: "roulette-result", currentActor: null, outcome } } as MatchState;
    const next = gameReducer(ready, { type: "ACK_TRIGGER_RESULT" });
    expect(next.roundIndex).toBe(state.roundIndex + 1);
    expect(next.aiNoise.match).toBe(state.aiNoise.match);
    expect(next.aiNoise.play).toBe(expectedPlayNoise);
    expect(next.rng.ai).toEqual(ai.snapshot());
  });
});

describe("deterministic match replay and isolated dialogue stream", () => {
  function replay(seed: string): MatchState {
    let state = createMatch(seed);
    for (let step = 0; step < 40 && state.status === "active"; step += 1) {
      const legal = getLegalActions(state);
      const action = legal.find((candidate) => candidate.type === "AI_TURN")
        ?? legal.find((candidate) => candidate.type === "PLAY_ABILITY")
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

  it("expires turn and match statuses with history events and removes their orphaned sources", () => {
    const base = withHands(createMatch("status-lifecycle"), [card("10"), card("6")], [card("10"), card("7")]);
    const source = { kind: "player-skill" as const, definitionId: "hunter-instinct", owner: "player" as const, instanceId: "status-source", createdAtSequence: base.abilities.sequence + 1, parameters: {} };
    const status = { statusDefinitionId: "night-queen-armed", owner: "player" as const, sourceInstanceId: source.instanceId, stacks: 1, duration: "turn" as const, parameters: {}, createdAtSequence: source.createdAtSequence };
    const turnState: MatchState = { ...base, abilities: { ...base.abilities, instances: [...base.abilities.instances, source], statuses: [status], counters: { [`${source.instanceId}:rule:turn`]: 1 }, sequence: source.createdAtSequence } };
    const switched = gameReducer(turnState, { type: "PLAYER_STAND" });
    expect(switched.abilities.statuses).toEqual([]);
    expect(switched.abilities.instances.some((instance) => instance.instanceId === source.instanceId)).toBe(false);
    expect(switched.abilities.counters[`${source.instanceId}:rule:turn`]).toBeUndefined();
    expect(switched.history).toContainEqual(expect.objectContaining({ type: "STATUS_REMOVED", statusDefinitionId: status.statusDefinitionId, reason: "expired" }));

    const matchStatus = { ...status, duration: "match" as const };
    const matchState: MatchState = { ...base, abilities: { ...base.abilities, instances: [...base.abilities.instances, source], statuses: [matchStatus], counters: { [`${source.instanceId}:rule:match`]: 1 }, sequence: source.createdAtSequence } };
    const escaped = gameReducer(matchState, { type: "ESCAPE_MATCH" });
    expect(escaped.abilities.statuses).toEqual([]);
    expect(escaped.abilities.instances.some((instance) => instance.instanceId === source.instanceId)).toBe(false);
    expect(escaped.abilities.counters).not.toHaveProperty(`${source.instanceId}:rule:match`);
    expect(escaped.history).toContainEqual(expect.objectContaining({ type: "STATUS_REMOVED", statusDefinitionId: matchStatus.statusDefinitionId, reason: "expired" }));
  });

  it("expires round statuses before the next round is dealt", () => {
    const base = createMatch("round-status-lifecycle");
    const source = { kind: "player-skill" as const, definitionId: "rhodes-heartthrob", owner: "player" as const, instanceId: "round-status-source", createdAtSequence: base.abilities.sequence + 1, parameters: {} };
    const status = { statusDefinitionId: "rhodes-heartthrob-armed", owner: "player" as const, sourceInstanceId: source.instanceId, stacks: 1, duration: "round" as const, parameters: {}, createdAtSequence: source.createdAtSequence };
    const state: MatchState = {
      ...base,
      round: { ...base.round, phase: "round-reveal", currentActor: null, outcome: { winner: null, reason: "push", penaltyTarget: null, bulletsAdded: 0, playerSkillReward: 0 } },
      abilities: { ...base.abilities, instances: [...base.abilities.instances, source], statuses: [status], sequence: source.createdAtSequence }
    };
    const next = gameReducer(state, { type: "ACK_ROUND_RESULT" });
    expect(next.round.index).toBe(state.round.index + 1);
    expect(next.abilities.statuses).toEqual([]);
    expect(next.abilities.instances.some((instance) => instance.instanceId === source.instanceId)).toBe(false);
    expect(next.history).toContainEqual(expect.objectContaining({ type: "STATUS_REMOVED", statusDefinitionId: status.statusDefinitionId, reason: "expired" }));
  });
});

describe("character mechanic integration", () => {
  it("rejects player-skill definitions at the match mechanic boundary", () => {
    expect(() => createMatch("invalid-mechanic-source", { opponentMechanics: [{ definitionId: "switcheroo", enabled: true, parameters: {} }] })).toThrow(/character-mechanic/);
  });

  it("records a locating failure when an automatic definition is missing", () => {
    const base = createMatch("missing-definition");
    const state = { ...base, abilities: { ...base.abilities, instances: [{ kind: "character-mechanic" as const, definitionId: "missing-mechanic", owner: "player" as const, instanceId: "missing-instance", createdAtSequence: base.abilities.sequence + 1, parameters: {} }], sequence: base.abilities.sequence + 1 } };
    const next = resolveRound(state, { winner: "player", reason: "comparison", penaltyTarget: "opponent", bulletsAdded: 1, playerSkillReward: 0 });
    expect(next.history).toContainEqual(expect.objectContaining({ type: "ABILITY_RESOLUTION_FAILED", instanceId: "missing-instance", definitionId: "missing-mechanic" }));
  });

  it("keeps mechanic resolution isolated when another match is created", () => {
    const matchA = createMatch("mechanic-isolation-a", { playerMechanics: [{ definitionId: "owner-load-penalty", enabled: true, parameters: {} }] });
    createMatch("mechanic-isolation-b");
    const resolved = resolveRound({ ...matchA, roulette: { player: createGun(), opponent: createGun() } }, { winner: "opponent", reason: "bust", penaltyTarget: "player", bulletsAdded: 1, playerSkillReward: 0 });
    expect(resolved.roulette.player.bullets).toBe(0);
  });

  it("generates a card-free active mechanic action for either owner and enforces its per-turn limit", () => {
    for (const owner of ["player", "opponent"] as const) {
      const configured = createMatch(`active-mechanic-${owner}`, {
        playerMechanics: owner === "player" ? [{ definitionId: "action-advice-mechanic", enabled: true, parameters: { minimumHandSize: 2 } }] : [],
        opponentMechanics: owner === "opponent" ? [{ definitionId: "action-advice-mechanic", enabled: true, parameters: { minimumHandSize: 2 } }] : []
      });
      const state = withHands(configured, [card("10"), card("6")], [card("10"), card("7")], owner);
      const instance = state.abilities.instances.find((entry) => entry.definitionId === "action-advice-mechanic" && entry.owner === owner);
      expect(instance).toBeDefined();
      const action = { type: "PLAY_ABILITY" as const, instanceId: instance!.instanceId };
      expect(getLegalActions(state)).toContainEqual(action);
      const played = gameReducer(state, action);
      expect(played.history).toContainEqual(expect.objectContaining({ type: "ABILITY_PLAYED", instanceId: instance!.instanceId, owner }));
      expect(Object.keys(played.abilities.counters).some((key) => key.includes(":event:"))).toBe(false);
      expect(getLegalActions(played)).not.toContainEqual(action);
      expect(played.abilities.instances).toContainEqual(instance);
    }
  });

  it("rejects a directly dispatched roulette-reaction ability owned by a non-penalized actor", () => {
    const configured = createMatch("reaction-owner-guard", {
      opponentMechanics: [{ definitionId: "action-advice-mechanic", enabled: true, parameters: { minimumHandSize: 2 } }]
    });
    const instance = configured.abilities.instances.find((entry) => entry.definitionId === "action-advice-mechanic")!;
    const state: MatchState = {
      ...configured,
      round: { ...configured.round, phase: "roulette-reaction", currentActor: null, outcome: { winner: "opponent", reason: "comparison", penaltyTarget: "player", bulletsAdded: 1, playerSkillReward: 0 } }
    };
    const action = { type: "PLAY_ABILITY" as const, instanceId: instance.instanceId };
    expect(getLegalActions(state)).not.toContainEqual(action);
    expect(gameReducer(state, action)).toBe(state);
  });

  it("applies owner and rival fixtures on the real round-resolution path for either owner", () => {
    for (const owner of ["player", "opponent"] as const) {
      const state = createMatch(`mechanic-owner-${owner}`, {
        playerMechanics: owner === "player" ? [{ definitionId: "owner-load-penalty", enabled: true, parameters: {} }] : [],
        opponentMechanics: owner === "opponent" ? [{ definitionId: "owner-load-penalty", enabled: true, parameters: {} }] : []
      });
      const penalty = resolveRound({ ...state, roulette: { player: createGun(), opponent: createGun() } }, { winner: owner === "player" ? "opponent" : "player", reason: "bust", penaltyTarget: owner, bulletsAdded: 1, playerSkillReward: 0 });
      expect(penalty.roulette[owner].bullets).toBe(0);
      const blackjack = resolveRound({ ...state, roulette: { player: createGun(), opponent: createGun() } }, { winner: owner === "player" ? "opponent" : "player", reason: "blackjack", penaltyTarget: owner, bulletsAdded: 2, playerSkillReward: 0 });
      expect(blackjack.roulette[owner].bullets).toBe(2);
    }
    for (const owner of ["player", "opponent"] as const) {
      const state = createMatch(`mechanic-rival-${owner}`, {
        playerMechanics: owner === "player" ? [{ definitionId: "rival-bust-load", enabled: true, parameters: {} }] : [],
        opponentMechanics: owner === "opponent" ? [{ definitionId: "rival-bust-load", enabled: true, parameters: {} }] : []
      });
      const penaltyTarget = owner === "player" ? "opponent" : "player";
      const penalty = resolveRound({ ...state, roulette: { player: createGun(), opponent: createGun() } }, { winner: owner, reason: "bust", penaltyTarget, bulletsAdded: 1, playerSkillReward: 0 });
      expect(penalty.roulette[penaltyTarget].bullets).toBe(2);
    }
  });
});

describe("legal action safety property", () => {
  it("executes 10,000 deterministically sampled legal actions without invalid consumption or broken invariants", () => {
    const actionRng = createRng("ability-property-actions");
    let executed = 0;
    let abilityActions = 0;
    for (let seedIndex = 0; executed < 10_000; seedIndex += 1) {
      let state = createMatch(`legal-action-${seedIndex}`);
      for (let step = 0; step < 80 && executed < 10_000; step += 1) {
        const legal = getLegalActions(state).filter((candidate) => candidate.type !== "ESCAPE_MATCH");
        if (legal.length === 0) break;
        for (const candidate of legal) expect(gameReducer(state, candidate), JSON.stringify(candidate)).not.toBe(state);
        const action = legal[actionRng.nextInt(legal.length)]!;
        const next = gameReducer(state, action);
        expect(next).not.toBe(state);
        if (action.type === "PLAY_ABILITY") abilityActions += 1;
        expect(next.abilities.instances.map((instance) => instance.instanceId).length)
          .toBe(new Set(next.abilities.instances.map((instance) => instance.instanceId)).size);
        expect(next.abilities.statuses.every((status) => next.abilities.instances.some((instance) => instance.instanceId === status.sourceInstanceId))).toBe(true);
        const playedIds = next.history.filter((event) => event.type === "ABILITY_PLAYED").map((event) => event.instanceId);
        expect(playedIds.length).toBe(new Set(playedIds).size);
        expect(next.roulette.player.bullets).toBeGreaterThanOrEqual(0);
        expect(next.roulette.opponent.bullets).toBeGreaterThanOrEqual(0);
        expect(next.roulette.player.bullets).toBeLessThanOrEqual(next.roulette.player.capacity);
        expect(next.roulette.opponent.bullets).toBeLessThanOrEqual(next.roulette.opponent.capacity);
        expect(next.shoe.cards.every((card) => card.origin === "shoe")).toBe(true);
        state = next;
        executed += 1;
      }
    }
    expect(executed).toBe(10_000);
    expect(abilityActions).toBeGreaterThan(100);
  }, 30_000);
});
