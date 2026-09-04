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
import { createMatch as createOfferedMatch, gameReducer, getLegalActions, normalizeAbilityHands, resolveRound, type CreateMatchOptions } from "./reducer";
import { canPlayAbility, playAbility } from "../abilities/engine";
import { fixedCardValue } from "../abilities/card-zone-adapter";
import type { MatchState, ParticipantState, RoundState } from "./types";

const W_DIALOGUE = wData.dialogue;

const card = (rank: Parameters<typeof createCard>[1], suit: Parameters<typeof createCard>[0] = "spades") => createCard(suit, rank);
const skillCard = (definitionId: string, instanceId = `test-${definitionId}`) => ({ kind: "player-skill" as const, definitionId, owner: "player" as const, instanceId });
const createMatch = (seed: string, options: CreateMatchOptions = {}) => gameReducer(createOfferedMatch(seed, options), { type: "SKIP_SKILL_OFFER" });

function withHands(state: MatchState, playerCards: Card[], opponentCards: Card[], actor: "player" | "opponent" = "player"): MatchState {
  const player: ParticipantState = { id: "player", hand: createHand(playerCards), stood: false, busted: false };
  const opponent: ParticipantState = { id: "opponent", hand: createHand(opponentCards), stood: false, busted: false };
  const round: RoundState = { ...state.round, phase: "turns", currentActor: actor, player, opponent, outcome: null };
  return { ...state, player, opponent, round, roundIndex: round.index, status: "active", scene: "match", view: "table", outcome: undefined };
}

function withSkillCard(state: MatchState, definitionId: string, instanceId = `contract-${definitionId}`): MatchState {
  const cardInstance = skillCard(definitionId, instanceId);
  const oldCardIds = new Set(state.playerSkills.cards.map((entry) => entry.instanceId));
  const sequence = state.abilities.sequence + 1;
  return {
    ...state,
    playerSkills: { ...state.playerSkills, unlockedDefinitionIds: [definitionId], cards: [cardInstance] },
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
  it("deals only after the opening offer is resolved and starts with the opponent", () => {
    const state = createMatch(findSeed((candidate) => candidate.round.phase === "turns"));
    expect(state.round.phase).toBe("turns");
    expect(state.round.starter).toBe("opponent");
    expect(state.round.currentActor).toBe("opponent");
    expect(state.player.hand.cards).toHaveLength(2);
    expect(state.opponent.hand.cards).toHaveLength(2);
    expect(state.playerSkills.cards).toHaveLength(0);
    expect(state.history).toContainEqual(expect.objectContaining({ type: "SKILL_OFFER_RESOLVED", skipped: true }));
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

  it("settles initial Blackjack immediately with a double penalty", () => {
    const seed = findSeed((candidate) => candidate.history.some((event) => event.type === "INITIAL_BLACKJACK_CHECK" && event.player && !event.opponent));
    const state = createMatch(seed);
    expect(state.history).toContainEqual({ type: "BLACKJACK", actor: "player" });
    expect(state.history).toContainEqual({ type: "BULLET_ADDED", actor: "opponent", amount: 2 });
    expect(state.history).toContainEqual(expect.objectContaining({ type: "ROUND_RESOLVED", outcome: expect.objectContaining({ reason: "blackjack", winner: "player"}) }));
    expect(state.playerSkills.cards).toHaveLength(0);
  });

  it("automatically stands on 21 and prevents another player hit", () => {
    const base = createMatch("auto-21");
    const state: MatchState = { ...withHands(base, [card("10"), card("9")], [card("10"), card("7")]), shoe: { cards: [card("2", "hearts")], cursor: 0, shuffleIndex: 1 } };
    const next = gameReducer(state, { type: "PLAYER_HIT" });
    expect(next.player.stood).toBe(true);
    expect(next.round.currentActor).toBe("opponent");
    expect(getLegalActions(next)).not.toContainEqual({ type: "PLAYER_HIT" });
  });

  it("W Night Queen adds a derived card after a Q finds a same-suit partner and stands on 21", () => {
    const base = createMatch("night-queen-integration", { opponentAiSkills: [{ definitionId: "w-night-queen", enabled: true, parameters: {} }] });
    const state: MatchState = {
      ...withHands(base, [card("10"), card("6")], [card("Q", "hearts"), card("3", "hearts")], "opponent"),
      shoe: { cards: [card("2", "hearts"), card("2", "clubs")], cursor: 0, shuffleIndex: 1 }
    };
    const next = gameReducer(state, { type: "AI_HIT" });
    expect(next.opponent.hand.cards).toHaveLength(4);
    expect(next.opponent.hand.cards.at(-1)?.origin).toBe("derived");
    expect(handValue(next.opponent.hand)).toBe(21);
    expect(next.opponent.stood).toBe(true);
    expect(next.shoe.cursor).toBe(1);
    expect(next.shoe.cards).toEqual(state.shoe.cards);
    expect(next.history).toContainEqual(expect.objectContaining({ type: "ABILITY_TRIGGERED", definitionId: "w-night-queen", ruleId: "complete-to-twenty-one" }));
  });

  it("runs Night Queen after the initial deal and hands off a stood starter", () => {
    let found: MatchState | undefined;
    for (let index = 0; index < 10_000 && !found; index += 1) {
      const candidate = createMatch(`night-queen-initial-${index}`, { opponentAiSkills: [{ definitionId: "w-night-queen", enabled: true, parameters: {} }] });
      if (candidate.history.some((event) => event.type === "ABILITY_TRIGGERED" && event.definitionId === "w-night-queen") && candidate.opponent.hand.cards.at(-1)?.origin === "derived" && candidate.round.phase === "turns") found = candidate;
    }
    expect(found).toBeDefined();
    expect(found!.opponent.stood).toBe(true);
    expect(found!.opponent.hand.cards.at(-1)?.origin).toBe("derived");
    expect(found!.history.filter((event) => event.type === "ABILITY_TRIGGERED" && event.definitionId === "w-night-queen")).toHaveLength(1);
    expect(found!.history.some((event) => event.type === "BLACKJACK")).toBe(false);
    expect(found!.round.currentActor).toBe("player");
  });

  it("broadcasts Night Queen after a later round's initial deal", () => {
    let nextRound: MatchState | undefined;
    for (let index = 0; index < 10_000 && !nextRound; index += 1) {
      const candidate = createMatch(`night-queen-next-round-${index}`, { opponentAiSkills: [{ definitionId: "w-night-queen", enabled: true, parameters: {} }] });
      const pushed = resolveRound(withHands(candidate, [card("10"), card("7")], [card("10"), card("7")]), { winner: null, reason: "push", penaltyTarget: null, bulletsAdded: 0});
      const offered = gameReducer(pushed, { type: "ACK_ROUND_RESULT" });
      const started = gameReducer(offered, { type: "SKIP_SKILL_OFFER" });
      if (started.round.index === 1 && started.history.some((event) => event.type === "ABILITY_TRIGGERED" && event.definitionId === "w-night-queen" && event.ruleId === "complete-to-twenty-one") && started.opponent.hand.cards.at(-1)?.origin === "derived") nextRound = started;
    }
    expect(nextRound).toBeDefined();
    expect(nextRound!.round.index).toBeGreaterThan(0);
    expect(nextRound!.opponent.stood).toBe(true);
    expect(nextRound!.round.currentActor).toBe("player");
  });

  it("keeps a Q plus same-suit A initial hand as natural Blackjack", () => {
    let blackjack: MatchState | undefined;
    for (let index = 0; index < 10_000 && !blackjack; index += 1) {
      const candidate = createMatch(`night-queen-blackjack-${index}`, { opponentAiSkills: [{ definitionId: "w-night-queen", enabled: true, parameters: {} }] });
      const cards = candidate.opponent.hand.cards;
      if (cards.length === 2 && cards.some((entry) => entry.rank === "Q") && cards.some((entry) => entry.rank === "A") && candidate.history.some((event) => event.type === "BLACKJACK" && event.actor === "opponent")) blackjack = candidate;
    }
    expect(blackjack).toBeDefined();
    expect(blackjack!.history.filter((event) => event.type === "ABILITY_TRIGGERED" && event.definitionId === "w-night-queen")).toHaveLength(0);
    expect(blackjack!.opponent.hand.cards.some((entry) => entry.origin === "derived")).toBe(false);
  });

  it("keeps the opponent as starter after a survived round", () => {
    const state = createMatch(findSeed((candidate) => candidate.round.phase === "turns"));
    const completed = gameReducer(withHands(state, [card("10"), card("7")], [card("10"), card("7")]), { type: "PLAYER_STAND" });
    const reveal = gameReducer(completed, { type: "AI_STAND" });
    expect(reveal.round.phase).toBe("round-reveal");
    const next = gameReducer(reveal, { type: "ACK_ROUND_RESULT" });
    expect(next.round.index).toBe(1);
    expect(next.round.starter).toBe("opponent");
    expect(next.round.phase).toBe("skill-offer");
    expect(next.round.currentActor).toBeNull();
    const started = gameReducer(next, { type: "SKIP_SKILL_OFFER" });
    expect(started.round.currentActor).toBe("opponent");
  });
});

describe("round resolution and roulette", () => {
  it("Forge Heralds the Year adds one rival bullet on red ordinary wins but not Blackjack", () => {
    const base = createMatch("forge-integration", { opponentAiSkills: [{ definitionId: "ai-forge-heralds-the-year", enabled: true, parameters: {} }] });
    const state = withHands(base, [card("10"), card("7")], [card("2", "hearts"), card("8", "diamonds")]);
    const ordinary = resolveRound({ ...state, roulette: { player: createGun(), opponent: createGun() } }, { winner: "opponent", reason: "comparison", penaltyTarget: "player", bulletsAdded: 1});
    expect(ordinary.roulette.player.bullets).toBe(2);
    expect(ordinary.history).toContainEqual(expect.objectContaining({ type: "ROUND_RESOLVED", outcome: expect.objectContaining({ bulletsAdded: 2 }) }));
    expect(ordinary.history).toContainEqual({ type: "BULLET_ADDED", actor: "player", amount: 2 });
    const blackjack = resolveRound({ ...state, roulette: { player: createGun(), opponent: createGun() } }, { winner: "opponent", reason: "blackjack", penaltyTarget: "player", bulletsAdded: 2});
    expect(blackjack.roulette.player.bullets).toBe(2);
    expect(blackjack.history).toContainEqual({ type: "BULLET_ADDED", actor: "player", amount: 2 });
  });

  it("recomputes W's cached bust limit after either hand changes, without retriggering unchanged checks", () => {
    const base = createMatch("bomb-cache", { opponentAiSkills: [{ definitionId: "bomb-maniac", enabled: true, parameters: {} }] });
    const protectedState = normalizeAbilityHands({
      ...withHands(base, [card("10"), card("2")], [card("K"), card("9"), card("2"), card("2")], "player"),
      shoe: { cards: [card("2", "clubs")], cursor: 0, shuffleIndex: 1 }
    });
    expect(protectedState.opponent.bustLimit).toBe(23);
    const triggered = protectedState.history.filter((event) => event.type === "ABILITY_TRIGGERED" && event.definitionId === "bomb-maniac");
    expect(normalizeAbilityHands(protectedState).history.filter((event) => event.type === "ABILITY_TRIGGERED" && event.definitionId === "bomb-maniac")).toHaveLength(triggered.length);
    const afterPlayerHit = gameReducer(protectedState, { type: "PLAYER_HIT" });
    expect(afterPlayerHit.round.outcome).toMatchObject({ reason: "bust", penaltyTarget: "opponent" });
    expect(afterPlayerHit.opponent.busted).toBe(true);
  });

  it("uses the same Bomb Maniac definition to protect W and the rival", () => {
    const base = createMatch("bomb-both-actors", { opponentAiSkills: [{ definitionId: "bomb-maniac", enabled: true, parameters: {} }] });
    const state = normalizeAbilityHands(withHands(base,
      [card("K"), card("9"), card("2"), card("A")],
      [card("K"), card("8"), card("2"), card("A"), card("A")],
      "player"));
    expect(state.player).toMatchObject({ bustLimit: 22, busted: false });
    expect(state.opponent).toMatchObject({ bustLimit: 22, busted: false });
    expect(state.history.filter((event) => event.type === "ABILITY_TRIGGERED" && event.definitionId === "bomb-maniac")).toHaveLength(2);
  });

  it("allows a W hand safely above 21 to Stand and compare normally", () => {
    const base = createMatch("bomb-safe-stand", { opponentAiSkills: [{ definitionId: "bomb-maniac", enabled: true, parameters: {} }] });
    const safe = normalizeAbilityHands(withHands(base, [card("10"), card("2")], [card("K"), card("9"), card("2"), card("2")], "opponent"));
    expect(safe.opponent.bustLimit).toBe(23);
    const stood = gameReducer(safe, { type: "AI_STAND" });
    expect(stood.opponent.stood).toBe(true);
    const resolved = gameReducer(stood, { type: "PLAYER_STAND" });
    expect(resolved.round.outcome?.reason).toBe("comparison");
  });

  it("keeps ordinary 21 auto-Stand unchanged when Bomb Maniac is configured", () => {
    const base = createMatch("bomb-coexists-with-21", { opponentAiSkills: [{ definitionId: "bomb-maniac", enabled: true, parameters: {} }] });
    const state: MatchState = {
      ...withHands(base, [card("10"), card("9")], [card("10"), card("6")], "player"),
      shoe: { cards: [card("2", "hearts")], cursor: 0, shuffleIndex: 1 }
    };
    const next = gameReducer(state, { type: "PLAYER_HIT" });
    expect(next.player.stood).toBe(true);
    expect(next.player.busted).toBe(false);
    expect(next.history).not.toContainEqual(expect.objectContaining({ type: "ABILITY_TRIGGERED", definitionId: "bomb-maniac" }));
  });

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
    expect(state.round.outcome).toMatchObject({ winner: "opponent", reason: "blackjack", penaltyTarget: "player", bulletsAdded: 2});
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

  it("distinguishes a modified bullet misfire from a genuinely empty chamber", () => {
    const gun = { capacity: 6, bullets: 3 };
    const outcomes = new Map<string, ReturnType<typeof pullTrigger>["result"]>();
    for (let index = 0; index < 10_000 && outcomes.size < 3; index += 1) {
      const pulled = pullTrigger(gun, createRng(`trigger-result-${index}`), 0.33).result;
      outcomes.set(pulled.result, pulled);
    }
    expect([...outcomes.keys()].sort()).toEqual(["empty-chamber", "fired", "misfire"]);
    expect(outcomes.get("misfire")).toMatchObject({ fired: false, baseProbability: 0.5, misfireChance: 0.33 });
    expect(outcomes.get("empty-chamber")).toMatchObject({ fired: false, baseProbability: 0.5, misfireChance: 0.33 });
    expect(outcomes.get("fired")?.probability).toBeCloseTo(0.17);
  });

  it("Sword and Handcannon uses only current-round Hits, adjusts probability, and consumes one roulette roll", () => {
    const base = createMatch("sword-handcannon-integration", { opponentAiSkills: [{ definitionId: "ai-sword-and-handcannon", enabled: true, parameters: {} }] });
    const oldRng = base.rng.roulette;
    const state: MatchState = {
      ...base,
      roulette: { ...base.roulette, opponent: { capacity: 6, bullets: 3 } },
      history: [
        ...base.history,
        { type: "PLAYER_HIT", value: 18 },
        { type: "ROUND_STARTED", roundIndex: base.roundIndex },
        { type: "PLAYER_HIT", value: 16 },
        { type: "PLAYER_HIT", value: 17 },
        { type: "PLAYER_HIT", value: 18 }
      ],
      round: { ...base.round, phase: "roulette-trigger", currentActor: null, outcome: { winner: "player", reason: "comparison", penaltyTarget: "opponent", bulletsAdded: 1} }
    };
    const next = gameReducer(state, { type: "TRIGGER_ROULETTE" });
    const pulled = next.history.find((event) => event.type === "TRIGGER_PULLED");
    expect(pulled).toMatchObject({ actor: "opponent" });
    if (pulled?.type === "TRIGGER_PULLED") {
      expect(pulled.baseProbability).toBeCloseTo(0.5);
      expect(pulled.misfireChance).toBeCloseTo(0.99);
      expect(pulled.probability).toBe(0);
    }
    const newEvents = next.history.slice(state.history.length);
    expect(newEvents.findIndex((event) => event.type === "ABILITY_TRIGGERED" && event.definitionId === "ai-sword-and-handcannon"))
      .toBeLessThan(newEvents.findIndex((event) => event.type === "TRIGGER_PULLED"));
    const expectedRng = SeededRng.fromSnapshot(oldRng);
    expectedRng.next();
    expect(next.rng.roulette).toEqual(expectedRng.snapshot());
  });
});

describe("skills", () => {
  it("Switcheroo swaps physical cards in place and may still cause a bust", () => {
    const base = createMatch("switcheroo-physical-bust");
    const top = card("5", "hearts");
    const last = card("2", "clubs");
    const state = withSkillCard({ ...withHands(base, [card("K"), card("9"), last], [card("10"), card("7")]), shoe: { cards: [top, card("3", "diamonds")], cursor: 0, shuffleIndex: 1 } }, "switcheroo", "switch-physical");
    const beforeRng = state.abilities.rng;
    const beforeMatchRng = state.rng;
    const next = gameReducer(state, { type: "PLAY_ABILITY", instanceId: "switch-physical" });
    expect(next.player.hand.cards.at(-1)).toBe(top);
    expect(next.shoe.cards[0]).toBe(last);
    expect(next.shoe.cursor).toBe(0);
    expect(next.abilities.rng).toEqual(beforeRng);
    expect(next.rng).toEqual(beforeMatchRng);
    expect(next.history).toContainEqual(expect.objectContaining({ type: "BUST", actor: "player" }));
    expect(next.round.phase).toBe("round-reveal");
  });

  it.each([
    ["no Q", [card("10"), card("6")] ],
    ["Q without partner", [card("Q", "hearts"), card("6", "spades")] ],
    ["already 21", [card("Q", "hearts"), card("A", "hearts")] ]
  ] as const)("Night Queen stays unavailable for %s", (_label, cards) => {
    const state = withSkillCard(withHands(createMatch(`night-negative-${_label}`), [...cards], [card("10"), card("7")]), "night-queen", `night-negative-${_label}`);
    const action = { type: "PLAY_ABILITY" as const, instanceId: `night-negative-${_label}` };
    expect(getLegalActions(state)).not.toContainEqual(action);
    expect(gameReducer(state, action)).toBe(state);
    expect(state.playerSkills.cards).toHaveLength(1);
  });

  it("Blueberry splits a fixed-value Ace and follows normal bust settlement", () => {
    const base = createMatch("blueberry-ace");
    const state = withSkillCard(withHands(base, [card("K"), card("8"), card("A")], [card("10"), card("7")]), "blueberry-and-dark-chocolate", "blueberry-ace-card");
    const shoe = { cards: [card("2", "clubs"), card("3", "diamonds")], cursor: 0, shuffleIndex: 1 };
    const next = gameReducer({ ...state, shoe }, { type: "PLAY_ABILITY", instanceId: "blueberry-ace-card" });
    expect(next.player.hand.cards.slice(-2).every((entry) => entry.origin === "derived")).toBe(true);
    expect(next.player.hand.cards.slice(-2).reduce((sum, entry) => sum + fixedCardValue(entry), 0)).toBe(11);
    expect(next.shoe).toEqual(shoe);
    expect(next.history).toContainEqual(expect.objectContaining({ type: "BUST", actor: "player" }));
    expect(next.round.phase).toBe("round-reveal");
  });

  it.each(["10", "J", "Q", "K"] as const)("Blueberry preserves fixed value for %s", (rank) => {
    const state = withSkillCard(withHands(createMatch(`blueberry-${rank}`), [card("2"), card(rank)], [card("10"), card("7")]), "blueberry-and-dark-chocolate", `blueberry-${rank}-card`);
    const next = gameReducer(state, { type: "PLAY_ABILITY", instanceId: `blueberry-${rank}-card` });
    expect(next.player.hand.cards.slice(-2).reduce((sum, entry) => sum + fixedCardValue(entry), 0)).toBe(10);
  });

  it.each(["2", "3"] as const)("Blueberry does not consume an unsplittable %s", (rank) => {
    const state = withSkillCard(withHands(createMatch(`blueberry-invalid-${rank}`), [card("10"), card(rank)], [card("10"), card("7")]), "blueberry-and-dark-chocolate", `blueberry-invalid-${rank}-card`);
    const beforeRng = state.abilities.rng;
    const action = { type: "PLAY_ABILITY" as const, instanceId: `blueberry-invalid-${rank}-card` };
    expect(getLegalActions(state)).not.toContainEqual(action);
    expect(gameReducer(state, action)).toBe(state);
    expect(state.abilities.rng).toEqual(beforeRng);
    expect(state.playerSkills.cards).toHaveLength(1);
  });

  it("uses a deterministic Blueberry split for the same state and only advances ability RNG", () => {
    const base = createMatch("blueberry-deterministic");
    const state = withSkillCard(withHands(base, [card("10"), card("K")], [card("10"), card("7")]), "blueberry-and-dark-chocolate", "blueberry-deterministic-card");
    const first = gameReducer(state, { type: "PLAY_ABILITY", instanceId: "blueberry-deterministic-card" });
    const second = gameReducer(state, { type: "PLAY_ABILITY", instanceId: "blueberry-deterministic-card" });
    expect(first).toEqual(second);
    expect(first.abilities.rng).not.toEqual(state.abilities.rng);
    expect(first.rng).toEqual(state.rng);
  });

  it("runs Sword and Forge as player-skill instances through the reducer", () => {
    const swordBase = withSkillCard(createMatch("shared-player-sword", { unlockedPlayerSkillIds: ["sword-and-handcannon"] }), "sword-and-handcannon", "player-sword-card");
    const sword = withHands(swordBase, [card("10"), card("6")], [card("10"), card("7")]);
    const swordState: MatchState = { ...sword, roulette: { ...sword.roulette, player: { capacity: 6, bullets: 3 } }, history: [...sword.history, { type: "ROUND_STARTED", roundIndex: sword.roundIndex }, { type: "OPPONENT_HIT", value: 17 }], round: { ...sword.round, phase: "round-reveal", currentActor: null, outcome: { winner: "opponent", reason: "comparison", penaltyTarget: "player", bulletsAdded: 1} } };
    expect(swordState.abilities.instances.find((instance) => instance.definitionId === "sword-and-handcannon")?.kind).toBe("player-skill");
    const swordReaction = gameReducer(gameReducer(swordState, { type: "ACK_ROUND_RESULT" }), { type: "TRIGGER_ROULETTE" });
    expect(swordReaction.history).toContainEqual(expect.objectContaining({ type: "ABILITY_TRIGGERED", definitionId: "sword-and-handcannon", owner: "player" }));
    expect(swordReaction.history).toContainEqual(expect.objectContaining({ type: "TRIGGER_PULLED", actor: "player", baseProbability: 0.5, misfireChance: 0.33 }));
    const pulled = swordReaction.history.filter((event) => event.type === "TRIGGER_PULLED").at(-1);
    if (pulled?.type === "TRIGGER_PULLED") expect(pulled.probability).toBeCloseTo(0.17);
    const forgeBase = withSkillCard(createMatch("shared-player-forge", { unlockedPlayerSkillIds: ["forge-heralds-the-year"] }), "forge-heralds-the-year", "player-forge-card");
    const forge = withHands(forgeBase, [card("10", "hearts"), card("7", "diamonds")], [card("10"), card("6")]);
    const forgeState: MatchState = { ...forge, opponent: { ...forge.opponent, stood: true }, round: { ...forge.round, opponent: { ...forge.round.opponent, stood: true } } };
    expect(forgeState.abilities.instances.find((instance) => instance.definitionId === "forge-heralds-the-year")?.kind).toBe("player-skill");
    const forgeResolved = gameReducer(forgeState, { type: "PLAYER_STAND" });
    expect(forgeResolved.history).toContainEqual(expect.objectContaining({ type: "ABILITY_TRIGGERED", definitionId: "forge-heralds-the-year", owner: "player" }));
    expect(forgeResolved.roulette.opponent.bullets).toBe(2);
    expect(forgeResolved.round.outcome?.bulletsAdded).toBe(2);
  });

  it("shows Hunter advice and clears it on the next action", () => {
    const base = createMatch("hunter");
    const player = { id: "player" as const, hand: createHand([card("10"), card("6")]), stood: false, busted: false };
    const opponent = { id: "opponent" as const, hand: createHand([card("10"), card("7")]), stood: false, busted: false };
    const round: RoundState = { ...base.round, phase: "turns", currentActor: "player", player, opponent, outcome: null };
    const state: MatchState = { ...base, player, opponent, round, playerSkills: { ...base.playerSkills, cards: [skillCard("hunter-instinct")] }, abilities: { ...base.abilities, instances: [...base.abilities.instances, { ...skillCard("hunter-instinct"), createdAtSequence: base.abilities.sequence + 1, parameters: {} }], sequence: base.abilities.sequence + 1 }, shoe: { cards: [card("2", "hearts")], cursor: 0, shuffleIndex: 1 } };
    const advised = gameReducer(state, { type: "PLAY_ABILITY", instanceId: "test-hunter-instinct" });
    expect(advised.playerSkills.advice).toBe("hit");
    expect(gameReducer(advised, { type: "PLAYER_STAND" }).playerSkills.advice).toBeNull();
  });

  it("broadcasts after-hand-changed only when an active ability actually mutates a hand", () => {
    const observer = [{ definitionId: "hand-change-observer", enabled: true, parameters: {} }];
    const hunterBase = withHands(createMatch("hunter-no-hand-event", { playerAiSkills: observer }), [card("10"), card("6")], [card("10"), card("7")]);
    const hunter = withSkillCard(hunterBase, "hunter-instinct", "hunter-no-hand-event-card");
    const advised = gameReducer(hunter, { type: "PLAY_ABILITY", instanceId: "hunter-no-hand-event-card" });
    expect(advised.history.slice(hunter.history.length)).not.toContainEqual(expect.objectContaining({ type: "ABILITY_TRIGGERED", ruleId: "observe-owner-hand-change" }));

    const switchBase = withHands(createMatch("switch-hand-event", { playerAiSkills: observer }), [card("10"), card("6")], [card("10"), card("7")]);
    const switcheroo = withSkillCard({ ...switchBase, shoe: { cards: [card("2", "clubs")], cursor: 0, shuffleIndex: 1 } }, "switcheroo", "switch-hand-event-card");
    const switched = gameReducer(switcheroo, { type: "PLAY_ABILITY", instanceId: "switch-hand-event-card" });
    expect(switched.history.slice(switcheroo.history.length)).toContainEqual(expect.objectContaining({ type: "ABILITY_TRIGGERED", ruleId: "observe-owner-hand-change" }));
    expect(switched.round.player.hand).toBe(switched.player.hand);
    expect(switched.round.opponent.hand).toBe(switched.opponent.hand);
    expect(switched.round.player.hand.cards).toEqual(switched.player.hand.cards);
  });

  it("does not auto-grant an opening card when the offer is skipped", () => {
    const state = createMatch(findSeed((candidate) => candidate.round.phase === "turns"), { unlockedPlayerSkillIds: ["hunter-instinct", "switcheroo", "scent-of-a-woman"] });
    expect(state.playerSkills.cards).toHaveLength(0);
  });

  it.each(["hunter-instinct", "switcheroo", "scent-of-a-woman", "night-queen"] as const)("exposes, resolves, and deterministically records the active %s contract", (definitionId) => {
    const makeState = (): MatchState => {
      const base = withHands(createMatch(`contract-${definitionId}`),
        definitionId === "night-queen" ? [card("Q", "hearts"), card("6", "hearts")] : [card("10"), card("6")],
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
    expect(next.playerSkills.cards.some((entry) => entry.instanceId === action.instanceId)).toBe(false);
    expect(next.history).toContainEqual(expect.objectContaining({ type: "ABILITY_PLAYED", instanceId: action.instanceId, definitionId }));
    expect(next.history).toContainEqual(expect.objectContaining({ type: "ABILITY_TRIGGERED", instanceId: action.instanceId }));
    expect(next).toEqual(gameReducer(makeState(), action));
  });

  it("does not expose or consume Switcheroo when the remaining draw pile has no candidate", () => {
    const base = withHands(createMatch("switcheroo-no-candidate"), [card("K"), card("9"), card("2")], [card("10"), card("7")]);
    const state = withSkillCard({ ...base, shoe: { cards: [], cursor: 0, shuffleIndex: 1 } }, "switcheroo", "switcheroo-no-candidate-card");
    const action = { type: "PLAY_ABILITY" as const, instanceId: "switcheroo-no-candidate-card" };
    expect(getLegalActions(state)).not.toContainEqual(action);
    expect(gameReducer(state, action)).toBe(state);
    expect(state.playerSkills.cards).toHaveLength(1);
  });

  it("Night Queen immediately guarantees 21 with a derived card", () => {
    const base = createMatch("night-queen");
    const state = { ...withHands(base, [card("Q", "hearts"), card("6", "hearts")], [card("10"), card("7")]), playerSkills: { ...base.playerSkills, unlockedDefinitionIds: ["night-queen"], cards: [skillCard("night-queen")] }, abilities: { ...base.abilities, instances: [...base.abilities.instances, { ...skillCard("night-queen"), createdAtSequence: base.abilities.sequence + 1, parameters: {} }], sequence: base.abilities.sequence + 1 }, shoe: { cards: [card("2", "clubs")], cursor: 0, shuffleIndex: 1 } };
    const next = gameReducer(state, { type: "PLAY_ABILITY", instanceId: "test-night-queen" });
    expect(next.player.hand.cards).toHaveLength(3);
    expect(handValue(next.player.hand)).toBe(21);
    expect(next.player.hand.cards.at(-1)?.origin).toBe("derived");
    expect(next.shoe.cursor).toBe(0);
    expect(next.history).not.toContainEqual(expect.objectContaining({ type: "PLAYER_HIT" }));
    expect(next.history).toContainEqual(expect.objectContaining({ type: "PLAYER_STOOD" }));
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

  it("does not consume a second Night Queen after the first completes the hand", () => {
    const base = createMatch("night-queen-repeat");
    const state = { ...withHands(base, [card("Q", "hearts"), card("6", "hearts")], [card("10"), card("7")]), playerSkills: { ...base.playerSkills, unlockedDefinitionIds: ["night-queen"], cards: [skillCard("night-queen", "night-1"), skillCard("night-queen", "night-2")] }, abilities: { ...base.abilities, instances: [...base.abilities.instances, { ...skillCard("night-queen", "night-1"), createdAtSequence: base.abilities.sequence + 1, parameters: {} }, { ...skillCard("night-queen", "night-2"), createdAtSequence: base.abilities.sequence + 2, parameters: {} }], sequence: base.abilities.sequence + 2 }, shoe: { cards: [card("9", "clubs")], cursor: 0, shuffleIndex: 1 } };
    const completed = gameReducer(state, { type: "PLAY_ABILITY", instanceId: "night-1" });
    const repeated = gameReducer(completed, { type: "PLAY_ABILITY", instanceId: "night-2" });
    expect(repeated).toBe(completed);
    expect(repeated.playerSkills.cards).toHaveLength(1);
  });

  it("does not consume a second Rhodes Heartthrob while its round status is armed", () => {
    const base = withHands(createMatch("rhodes-repeat"), [card("10"), card("6")], [card("10"), card("7")]);
    const first = skillCard("rhodes-heartthrob", "rhodes-repeat-1");
    const second = skillCard("rhodes-heartthrob", "rhodes-repeat-2");
    const state: MatchState = {
      ...base,
      playerSkills: { ...base.playerSkills, unlockedDefinitionIds: ["rhodes-heartthrob"], cards: [first, second] },
      abilities: {
        ...base.abilities,
        instances: [...base.abilities.instances, { ...first, createdAtSequence: base.abilities.sequence + 1, parameters: {} }, { ...second, createdAtSequence: base.abilities.sequence + 2, parameters: {} }],
        sequence: base.abilities.sequence + 2
      }
    };
    const armed = gameReducer(state, { type: "PLAY_ABILITY", instanceId: first.instanceId });
    expect(gameReducer(armed, { type: "PLAY_ABILITY", instanceId: second.instanceId })).toBe(armed);
    expect(armed.playerSkills.cards).toContainEqual(second);
  });

  it("Switcheroo resolves immediately when the opponent already stood", () => {
    const base = createMatch("switcheroo-stood");
    const state = { ...withHands(base, [card("10"), card("9")], [card("10"), card("7")]), playerSkills: { ...base.playerSkills, cards: [skillCard("switcheroo")] }, abilities: { ...base.abilities, instances: [...base.abilities.instances, { ...skillCard("switcheroo"), createdAtSequence: base.abilities.sequence + 1, parameters: {} }], sequence: base.abilities.sequence + 1 }, opponent: { ...base.opponent, stood: true }, round: { ...withHands(base, [card("10"), card("9")], [card("10"), card("7")]).round, currentActor: "player" as const, opponent: { ...base.opponent, hand: createHand([card("10"), card("7")]), stood: true, busted: false } }, shoe: { cards: [card("A", "clubs")], cursor: 0, shuffleIndex: 1 } };
    const next = gameReducer(state, { type: "PLAY_ABILITY", instanceId: "test-switcheroo" });
    expect(next.round.phase).toBe("round-reveal");
    expect(next.round.outcome?.winner).toBe("player");
    expect(next.history.some((event) => event.type === "PLAYER_HIT")).toBe(false);
  });

  it("Rhodes Heartthrob avoids a non-full player trigger after loading", () => {
    const base = createMatch("rhodes");
    const state = { ...withHands(base, [card("10"), card("7")], [card("10"), card("8")]), playerSkills: { ...base.playerSkills, cards: [skillCard("rhodes-heartthrob")] }, abilities: { ...base.abilities, instances: [...base.abilities.instances, { ...skillCard("rhodes-heartthrob"), createdAtSequence: base.abilities.sequence + 1, parameters: {} }], sequence: base.abilities.sequence + 1 } };
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
    const state = { ...withHands(base, [card("10"), card("7")], [card("10"), card("8")]), playerSkills: { ...base.playerSkills, cards: [skillCard("rhodes-heartthrob")] }, abilities: { ...base.abilities, instances: [...base.abilities.instances, { ...skillCard("rhodes-heartthrob"), createdAtSequence: base.abilities.sequence + 1, parameters: {} }], sequence: base.abilities.sequence + 1 }, roulette: { ...base.roulette, player: { capacity: 6, bullets: 5 } } };
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
    const state = { ...withHands(base, [card("10"), card("5")], [card("10"), card("7")]), playerSkills: { ...base.playerSkills, cards: [skillCard("switcheroo")] }, abilities: { ...base.abilities, instances: [...base.abilities.instances, { ...skillCard("switcheroo"), createdAtSequence: base.abilities.sequence + 1, parameters: {} }], sequence: base.abilities.sequence + 1 }, shoe: { cards: [card("2", "clubs")], cursor: 0, shuffleIndex: 1 } };
    const next = gameReducer(state, { type: "PLAY_ABILITY", instanceId: "test-switcheroo" });
    expect(next.player.hand.cards.at(-1)).not.toEqual(card("5"));
    expect(next.shoe.cards).toContainEqual(card("5"));
    expect(next.shoe.cursor).toBe(0);
    expect(next.round.currentActor).toBe("player");
    expect(next.round.phase).toBe("turns");
    expect(next.history.some((event) => event.type === "PLAYER_HIT")).toBe(false);
  });

  it("Blueberry and Dark Chocolate splits the last card into derived cards", () => {
    const base = withHands(createMatch("blueberry"), [card("10"), card("8")], [card("10"), card("7")]);
    const skill = skillCard("blueberry-and-dark-chocolate", "blueberry-card");
    const state = { ...base, playerSkills: { ...base.playerSkills, unlockedDefinitionIds: ["blueberry-and-dark-chocolate"], cards: [skill] }, abilities: { ...base.abilities, instances: [...base.abilities.instances, { ...skill, createdAtSequence: base.abilities.sequence + 1, parameters: {} }], sequence: base.abilities.sequence + 1 }, shoe: { cards: [card("2", "clubs")], cursor: 0, shuffleIndex: 1 } };
    const next = gameReducer(state, { type: "PLAY_ABILITY", instanceId: skill.instanceId });
    expect(next.player.hand.cards).toHaveLength(3);
    expect(next.player.hand.cards.slice(-2).every((entry) => entry.origin === "derived")).toBe(true);
    expect(handValue(next.player.hand)).toBe(18);
    expect(next.shoe.cursor).toBe(0);
    expect(next.history).toContainEqual(expect.objectContaining({ type: "ABILITY_TRIGGERED", definitionId: "blueberry-and-dark-chocolate" }));
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
    const outcome = { winner: null, reason: "push", penaltyTarget: null, bulletsAdded: 0} as const;
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
    const status = { statusDefinitionId: "copper-seal-sealed", owner: "player" as const, sourceInstanceId: source.instanceId, stacks: 1, duration: "turn" as const, parameters: {}, createdAtSequence: source.createdAtSequence };
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
      round: { ...base.round, phase: "round-reveal", currentActor: null, outcome: { winner: null, reason: "push", penaltyTarget: null, bulletsAdded: 0} },
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
  it("lets Silent Drizzle block only the player's next active skill-card window after Texas chooses Stand", () => {
    const configured = createMatch("silent-drizzle", {
      unlockedPlayerSkillIds: ["hunter-instinct"],
      opponentAiSkills: [{ definitionId: "silent-drizzle", enabled: true, parameters: {} }]
    });
    const prepared = withSkillCard(withHands(configured, [card("10"), card("6")], [card("10"), card("8")], "opponent"), "hunter-instinct", "silent-drizzle-card");
    const state: MatchState = { ...prepared, shoe: { cards: [card("2", "hearts")], cursor: 0, shuffleIndex: 1 } };
    const action = { type: "PLAY_ABILITY" as const, instanceId: "silent-drizzle-card" };

    const silenced = gameReducer(state, { type: "AI_STAND" });
    expect(silenced.history.slice(state.history.length)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "ABILITY_TRIGGERED", definitionId: "silent-drizzle", ruleId: "silence-rival-next-action", owner: "opponent" }),
      expect.objectContaining({ type: "STATUS_ADDED", statusDefinitionId: "silent-drizzle-silenced", owner: "player" })
    ]));
    expect(silenced.abilities.statuses).toContainEqual(expect.objectContaining({ statusDefinitionId: "silent-drizzle-silenced", owner: "player", duration: "until-owner-action" }));
    expect(getLegalActions(silenced)).not.toContainEqual(action);
    expect(gameReducer(silenced, action)).toBe(silenced);
    expect(silenced.playerSkills.cards).toContainEqual(expect.objectContaining({ instanceId: action.instanceId }));

    const afterHit = gameReducer(silenced, { type: "PLAYER_HIT" });
    expect(afterHit.round.phase).toBe("turns");
    expect(afterHit.round.currentActor).toBe("player");
    expect(afterHit.abilities.statuses.some((status) => status.statusDefinitionId === "silent-drizzle-silenced")).toBe(false);
    expect(afterHit.history.slice(silenced.history.length)).toContainEqual(expect.objectContaining({ type: "STATUS_REMOVED", statusDefinitionId: "silent-drizzle-silenced", owner: "player", reason: "expired" }));
    expect(getLegalActions(afterHit)).toContainEqual(action);
  });

  it("does not let Silent Drizzle suppress passive player-skill resolution", () => {
    const base = createMatch("silent-drizzle-passive", {
      unlockedPlayerSkillIds: ["hunter-instinct", "forge-heralds-the-year"],
      opponentAiSkills: [{ definitionId: "silent-drizzle", enabled: true, parameters: {} }]
    });
    const state: MatchState = {
      ...withHands(base, [card("10"), card("9")], [card("10"), card("8")], "opponent"),
      roulette: { player: { capacity: 6, bullets: 3 }, opponent: { capacity: 6, bullets: 0 } }
    };
    const silenced = gameReducer(state, { type: "AI_STAND" });
    const resolved = gameReducer(silenced, { type: "PLAYER_STAND" });
    expect(resolved.round.outcome).toMatchObject({ winner: "player", penaltyTarget: "opponent", bulletsAdded: 1 });
    expect(resolved.roulette.opponent.bullets).toBe(1);
  });

  it("rejects player-skill definitions at the match mechanic boundary", () => {
    expect(() => createMatch("invalid-mechanic-source", { opponentAiSkills: [{ definitionId: "switcheroo", enabled: true, parameters: {} }] })).toThrow(/AI Skill/);
  });

  it("records a locating failure when an automatic definition is missing", () => {
    const base = createMatch("missing-definition");
    const state = { ...base, abilities: { ...base.abilities, instances: [{ kind: "ai-skill" as const, definitionId: "missing-mechanic", owner: "player" as const, instanceId: "missing-instance", createdAtSequence: base.abilities.sequence + 1, parameters: {} }], sequence: base.abilities.sequence + 1 } };
    const next = resolveRound(state, { winner: "player", reason: "comparison", penaltyTarget: "opponent", bulletsAdded: 1});
    expect(next.history).toContainEqual(expect.objectContaining({ type: "ABILITY_RESOLUTION_FAILED", instanceId: "missing-instance", definitionId: "missing-mechanic" }));
  });

  it("keeps mechanic resolution isolated when another match is created", () => {
    const matchA = createMatch("mechanic-isolation-a", { playerAiSkills: [{ definitionId: "owner-load-penalty", enabled: true, parameters: {} }] });
    createMatch("mechanic-isolation-b");
    const resolved = resolveRound({ ...matchA, roulette: { player: createGun(), opponent: createGun() } }, { winner: "opponent", reason: "bust", penaltyTarget: "player", bulletsAdded: 1});
    expect(resolved.roulette.player.bullets).toBe(0);
  });

  it("generates a card-free active mechanic action for either owner and enforces its per-turn limit", () => {
    for (const owner of ["player", "opponent"] as const) {
      const configured = createMatch(`active-mechanic-${owner}`, {
        playerAiSkills: owner === "player" ? [{ definitionId: "action-advice-mechanic", enabled: true, parameters: { minimumHandSize: 2 } }] : [],
        opponentAiSkills: owner === "opponent" ? [{ definitionId: "action-advice-mechanic", enabled: true, parameters: { minimumHandSize: 2 } }] : []
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

  it("Copper Seal blocks the next player skill only after the first one commits, then clears next round", () => {
    const configured = createMatch("copper-seal-integration", {
      unlockedPlayerSkillIds: ["hunter-instinct", "forge-heralds-the-year"],
      opponentAiSkills: [{ definitionId: "copper-seal", enabled: true, parameters: {} }]
    });
    let state = withSkillCard(withHands(configured, [card("10"), card("6")], [card("10"), card("6")], "player"), "hunter-instinct", "first-skill");
    state = {
      ...state,
      playerSkills: { ...state.playerSkills, unlockedDefinitionIds: ["hunter-instinct", "forge-heralds-the-year"] },
      roulette: { player: { capacity: 6, bullets: 3 }, opponent: createGun() }
    };
    const first = gameReducer(state, { type: "PLAY_ABILITY", instanceId: "first-skill" });
    expect(first.history).toContainEqual(expect.objectContaining({ type: "ABILITY_PLAYED", instanceId: "first-skill" }));
    expect(first.history).toContainEqual(expect.objectContaining({ type: "ABILITY_TRIGGERED", definitionId: "copper-seal", ruleId: "seal-rival-active-skills" }));
    expect(first.abilities.statuses).toContainEqual(expect.objectContaining({ statusDefinitionId: "copper-seal-sealed", owner: "player", duration: "round" }));
    expect(getLegalActions(first)).not.toContainEqual(expect.objectContaining({ type: "PLAY_ABILITY" }));
    const secondCard = skillCard("hunter-instinct", "second-skill");
    state = {
      ...first,
      playerSkills: { ...first.playerSkills, cards: [...first.playerSkills.cards, secondCard] },
      abilities: { ...first.abilities, instances: [...first.abilities.instances, { ...secondCard, createdAtSequence: first.abilities.sequence + 1, parameters: {} }], sequence: first.abilities.sequence + 1 }
    };
    const secondInput = { world: { hands: { player: state.player.hand, opponent: state.opponent.hand }, guns: state.roulette, shoe: state.shoe, cards: state.playerSkills.cards, statuses: state.abilities.statuses }, runtime: state.abilities, instanceId: "second-skill", owner: "player" as const, window: "owner-turn" as const, publishAdvice: () => "hit" as const };
    expect(canPlayAbility(secondInput)).toBe(false);
    expect(() => playAbility(secondInput)).toThrow();
    expect(gameReducer(state, { type: "PLAY_ABILITY", instanceId: "second-skill" })).toBe(state);
    const passive = resolveRound(state, { winner: "player", reason: "comparison", penaltyTarget: "opponent", bulletsAdded: 1});
    expect(passive.roulette.opponent.bullets).toBe(1);
    const playerStood = gameReducer(first, { type: "PLAYER_STAND" });
    const reveal = gameReducer(playerStood, { type: "AI_STAND" });
    const nextRound = gameReducer(reveal, { type: "ACK_ROUND_RESULT" });
    expect(nextRound.round.index).toBe(first.round.index + 1);
    expect(nextRound.abilities.statuses.some((status) => status.statusDefinitionId === "copper-seal-sealed")).toBe(false);
  });

  it("rejects a directly dispatched roulette-reaction ability owned by a non-penalized actor", () => {
    const configured = createMatch("reaction-owner-guard", {
      opponentAiSkills: [{ definitionId: "action-advice-mechanic", enabled: true, parameters: { minimumHandSize: 2 } }]
    });
    const instance = configured.abilities.instances.find((entry) => entry.definitionId === "action-advice-mechanic")!;
    const state: MatchState = {
      ...configured,
      round: { ...configured.round, phase: "roulette-reaction", currentActor: null, outcome: { winner: "opponent", reason: "comparison", penaltyTarget: "player", bulletsAdded: 1} }
    };
    const action = { type: "PLAY_ABILITY" as const, instanceId: instance.instanceId };
    expect(getLegalActions(state)).not.toContainEqual(action);
    expect(gameReducer(state, action)).toBe(state);
  });

  it("applies owner and rival fixtures on the real round-resolution path for either owner", () => {
    for (const owner of ["player", "opponent"] as const) {
      const state = createMatch(`mechanic-owner-${owner}`, {
        playerAiSkills: owner === "player" ? [{ definitionId: "owner-load-penalty", enabled: true, parameters: {} }] : [],
        opponentAiSkills: owner === "opponent" ? [{ definitionId: "owner-load-penalty", enabled: true, parameters: {} }] : []
      });
      const penalty = resolveRound({ ...state, roulette: { player: createGun(), opponent: createGun() } }, { winner: owner === "player" ? "opponent" : "player", reason: "bust", penaltyTarget: owner, bulletsAdded: 1});
      expect(penalty.roulette[owner].bullets).toBe(0);
      const blackjack = resolveRound({ ...state, roulette: { player: createGun(), opponent: createGun() } }, { winner: owner === "player" ? "opponent" : "player", reason: "blackjack", penaltyTarget: owner, bulletsAdded: 2});
      expect(blackjack.roulette[owner].bullets).toBe(2);
    }
    for (const owner of ["player", "opponent"] as const) {
      const state = createMatch(`mechanic-rival-${owner}`, {
        playerAiSkills: owner === "player" ? [{ definitionId: "rival-bust-load", enabled: true, parameters: {} }] : [],
        opponentAiSkills: owner === "opponent" ? [{ definitionId: "rival-bust-load", enabled: true, parameters: {} }] : []
      });
      const penaltyTarget = owner === "player" ? "opponent" : "player";
      const penalty = resolveRound({ ...state, roulette: { player: createGun(), opponent: createGun() } }, { winner: owner, reason: "bust", penaltyTarget, bulletsAdded: 1});
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
