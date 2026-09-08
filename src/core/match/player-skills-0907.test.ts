import { describe, expect, it } from "vitest";
import { createCard } from "../blackjack/card";
import { createHand } from "../blackjack/hand";
import { getAbilityDefinition } from "../abilities/registry";
import { AbilityDefinitionSchema } from "../abilities/schema";
import { expireStatuses } from "../abilities/runtime";
import { createMatch, gameReducer, getActiveBustLimit, normalizeAbilityHands, resolveRound } from "./reducer";
import type { Card, PhysicalCard, Rank, Suit } from "../blackjack/types";
import type { MatchState, ParticipantState, RoundState } from "./types";

const card = (rank: Rank, suit: Suit = "hearts"): Card => createCard(suit, rank);
const skillCard = (definitionId: string, instanceId: string) => ({ kind: "player-skill" as const, definitionId, owner: "player" as const, instanceId });

function fixture(definitionId: string, hand: Card[], shoe: Card[] = [card("2", "clubs"), card("3", "clubs"), card("4", "clubs"), card("5", "clubs")]): MatchState {
  const base = createMatch(`player-skill-${definitionId}`, { unlockedPlayerSkillIds: [definitionId] });
  const instanceId = `skill-${definitionId}`;
  const skill = skillCard(definitionId, instanceId);
  const sequence = base.abilities.sequence + 1;
  const player: ParticipantState = { id: "player", hand: createHand(hand), stood: false, busted: false };
  const opponent: ParticipantState = { ...base.opponent, hand: createHand([card("10"), card("7")]) };
  const round: RoundState = { ...base.round, phase: "turns", currentActor: "player", player, opponent, outcome: null };
  return {
    ...base, player, opponent, round, shoe: { cards: shoe as PhysicalCard[], cursor: 0, shuffleIndex: 1 },
    playerSkills: { ...base.playerSkills, cards: [skill] },
    abilities: { ...base.abilities, instances: [...base.abilities.instances, { ...skill, createdAtSequence: sequence, parameters: {} }], sequence }
  };
}

describe("0907 declarative Player Skills", () => {
  it("keeps all seven new skills as initial active card definitions", () => {
    for (const id of ["compound-interest", "counterclockwise-clock", "sissas-table", "a-single-coin", "mimic-eggplant", "carnival", "before-the-shuffle"]) {
      const definition = getAbilityDefinition(id);
      expect(definition).toMatchObject({ sourceKind: "player-skill", activation: { type: "action", windows: ["owner-turn"], consume: "card" }, drop: { enabled: true, baseWeight: 1 } });
      expect(definition?.sourceKind === "player-skill" ? definition.unlock : undefined).toBeUndefined();
      expect(definition?.tags).toContain("active-skill-card");
    }
  });

  it("strictly validates power and complete mapped-rank expressions", () => {
    const definition = getAbilityDefinition("counterclockwise-clock")!;
    const parsed = AbilityDefinitionSchema.parse(definition);
    const effect = parsed.rules[0]!.effects[0]!;
    const rankExpression = (effect as Extract<typeof effect, { type: "replace-hand-card-with-derived" }>).rank;
    expect(AbilityDefinitionSchema.safeParse({ ...parsed, rules: [{ ...parsed.rules[0], effects: [{ ...effect, rank: { type: "map-card-rank", card: "last-card", map: { A: "K" } } }] }] }).success).toBe(false);
    expect(AbilityDefinitionSchema.safeParse({ ...parsed, rules: [{ ...parsed.rules[0], effects: [{ ...effect, rank: { type: "map-card-rank", card: "last-card", map: { ...(rankExpression as Extract<typeof rankExpression, { type: "map-card-rank" }>).map, joker: "A" } } }] }] }).success).toBe(false);
  });

  it("creates scalar-rank, mapped-rank and uniformly suited derived cards", () => {
    const compound = gameReducer(fixture("compound-interest", [card("3"), card("4")]), { type: "PLAY_ABILITY", instanceId: "skill-compound-interest" });
    expect(compound.player.hand.cards.at(-1)).toMatchObject({ attributes: { source: "derived", rank: "2" }, tags: ["derived", "generated-by:compound-interest"] });
    const counter = gameReducer(fixture("counterclockwise-clock", [card("10"), card("4")]), { type: "PLAY_ABILITY", instanceId: "skill-counterclockwise-clock" });
    expect(counter.player.hand.cards.at(-1)).toMatchObject({ attributes: { source: "derived", rank: "7" }, tags: ["derived", "generated-by:counterclockwise-clock"] });
    const repeatA = gameReducer(fixture("compound-interest", [card("3"), card("4")]), { type: "PLAY_ABILITY", instanceId: "skill-compound-interest" });
    const repeatB = gameReducer(fixture("compound-interest", [card("3"), card("4")]), { type: "PLAY_ABILITY", instanceId: "skill-compound-interest" });
    expect(repeatA.player.hand.cards.at(-1)).toEqual(repeatB.player.hand.cards.at(-1));
  });

  it.each([[2, "A"], [3, "2"], [4, "4"], [5, "8"]] as const)("Sissa produces 2^n for %i hand cards", (count, rank) => {
    const next = gameReducer(fixture("sissas-table", Array.from({ length: count }, (_, index) => card(index < 2 ? "2" : "3"))), { type: "PLAY_ABILITY", instanceId: "skill-sissas-table" });
    expect(next.player.hand.cards.at(-1)).toMatchObject({ attributes: { source: "derived", rank }, tags: ["derived", "generated-by:sissas-table"] });
  });

  it("turns Sissa overflow into accumulated point advantage and a spade king", () => {
    const first = gameReducer(fixture("sissas-table", Array.from({ length: 6 }, () => card("2"))), { type: "PLAY_ABILITY", instanceId: "skill-sissas-table" });
    expect(first.player.hand.cards.at(-1)).toMatchObject({ attributes: { source: "derived", rank: "K", suit: "spades" }, tags: ["derived", "generated-by:sissas-table"] });
    expect(first.abilities.statuses).toContainEqual(expect.objectContaining({ statusDefinitionId: "player-point-advantage", stacks: 6 }));
  });

  it("recomputes Sissa from the latest hand count on a second card", () => {
    const base = fixture("sissas-table", Array.from({ length: 5 }, () => card("2")));
    const second = skillCard("sissas-table", "skill-sissas-table-2");
    const withTwo = { ...base, playerSkills: { ...base.playerSkills, cards: [...base.playerSkills.cards, second] }, abilities: { ...base.abilities, instances: [...base.abilities.instances, { ...second, createdAtSequence: base.abilities.sequence + 1, parameters: {} }], sequence: base.abilities.sequence + 1 } };
    const first = gameReducer(withTwo, { type: "PLAY_ABILITY", instanceId: "skill-sissas-table" });
    const next = gameReducer({ ...first, round: { ...first.round, currentActor: "player" } }, { type: "PLAY_ABILITY", instanceId: "skill-sissas-table-2" });
    expect(next.abilities.statuses).toContainEqual(expect.objectContaining({ statusDefinitionId: "player-point-advantage", stacks: 6 }));
  });

  it("rotates only the remaining shoe and leaves cursor and card count unchanged", () => {
    const source = [card("2", "clubs"), card("3", "diamonds"), card("4", "spades")];
    const state = fixture("before-the-shuffle", [card("2"), card("3")], source);
    const next = gameReducer({ ...state, shoe: { ...state.shoe, cursor: 1 } }, { type: "PLAY_ABILITY", instanceId: "skill-before-the-shuffle" });
    expect(next.shoe.cards).toEqual([source[0], source[2], source[1]]);
    expect(next.shoe.cursor).toBe(1);
    expect(next.shoe.cards).toHaveLength(3);
  });

  it("Mimic grants itself first, then the last successfully played Player Skill, atomically", () => {
    const first = gameReducer(fixture("mimic-eggplant", [card("2"), card("3")]), { type: "PLAY_ABILITY", instanceId: "skill-mimic-eggplant" });
    expect(first.playerSkills.cards.map((entry) => entry.definitionId)).toEqual(["mimic-eggplant"]);
    expect(first.history.filter((event) => event.type === "SKILL_GAINED" && event.skillId === "mimic-eggplant")).toHaveLength(1);

    const coin = fixture("a-single-coin", [card("2"), card("3")]);
    const mimic = skillCard("mimic-eggplant", "skill-mimic-eggplant");
    const withBoth = {
      ...coin,
      playerSkills: {
        ...coin.playerSkills,
        unlockedDefinitionIds: [...coin.playerSkills.unlockedDefinitionIds, "mimic-eggplant"],
        cards: [...coin.playerSkills.cards, mimic]
      },
      abilities: {
        ...coin.abilities,
        instances: [...coin.abilities.instances, { ...mimic, createdAtSequence: coin.abilities.sequence + 1, parameters: {} }],
        sequence: coin.abilities.sequence + 1
      }
    };
    const coinPlayed = gameReducer(withBoth, { type: "PLAY_ABILITY", instanceId: "skill-a-single-coin" });
    expect(coinPlayed.abilities.lastPlayedPlayerSkillDefinitionId).toBe("a-single-coin");
    const second = gameReducer(coinPlayed, { type: "PLAY_ABILITY", instanceId: "skill-mimic-eggplant" });
    expect(second.playerSkills.cards.map((entry) => entry.definitionId)).toEqual(["a-single-coin"]);
  });

  it("lets full-inventory Mimic replace its consumed card, while invalid skill resolution remains atomic", () => {
    const base = fixture("mimic-eggplant", [card("2"), card("3")]);
    const cards = Array.from({ length: 10 }, (_, index) => skillCard("mimic-eggplant", `full-${index}`));
    const instances = cards.map((entry, index) => ({ ...entry, createdAtSequence: base.abilities.sequence + index + 1, parameters: {} }));
    const state = { ...base, playerSkills: { ...base.playerSkills, cards }, abilities: { ...base.abilities, instances, sequence: base.abilities.sequence + instances.length, lastPlayedPlayerSkillDefinitionId: null } };
    const replaced = gameReducer(state, { type: "PLAY_ABILITY", instanceId: "full-0" });
    expect(replaced.playerSkills.cards).toHaveLength(10);
    expect(replaced.abilities.lastPlayedPlayerSkillDefinitionId).toBe("mimic-eggplant");

    const invalid = fixture("compound-interest", Array.from({ length: 14 }, () => card("A")));
    const rejected = gameReducer(invalid, { type: "PLAY_ABILITY", instanceId: "skill-compound-interest" });
    expect(rejected).toBe(invalid);
    expect(rejected.playerSkills.cards).toEqual(invalid.playerSkills.cards);
    expect(rejected.abilities.lastPlayedPlayerSkillDefinitionId).toBeNull();
  });

  it("Carnival accumulates for both actors in the current round, then resets to 21 next round", () => {
    let state = fixture("carnival", [card("2"), card("3")]);
    state = gameReducer(state, { type: "PLAY_ABILITY", instanceId: "skill-carnival" });
    const carnival = skillCard("carnival", "skill-carnival-2");
    state = { ...state, playerSkills: { ...state.playerSkills, cards: [...state.playerSkills.cards, carnival] }, abilities: { ...state.abilities, instances: [...state.abilities.instances, { ...carnival, createdAtSequence: state.abilities.sequence + 1, parameters: {} }], sequence: state.abilities.sequence + 1 }, round: { ...state.round, currentActor: "player" } };
    state = gameReducer(state, { type: "PLAY_ABILITY", instanceId: "skill-carnival-2" });
    state = { ...state, player: { ...state.player, hand: createHand([card("10"), card("8")]) }, opponent: { ...state.opponent, hand: createHand([card("10"), card("8")]) }, round: { ...state.round, player: { ...state.player, hand: createHand([card("10"), card("8")]) }, opponent: { ...state.opponent, hand: createHand([card("10"), card("8")]) } } };
    expect(getActiveBustLimit(state, "player")).toBe(23);
    expect(getActiveBustLimit(state, "opponent")).toBe(23);
    expect(normalizeAbilityHands(state).player.busted).toBe(false);
    expect(state.abilities.statuses).toContainEqual(expect.objectContaining({ statusDefinitionId: "carnival-bust-bonus", duration: "round", stacks: 2 }));

    const reveal = resolveRound(state, { winner: null, reason: "push", penaltyTarget: null, bulletsAdded: 0 });
    const nextRound = gameReducer(reveal, { type: "ACK_ROUND_RESULT" });
    expect(nextRound.abilities.statuses.some((status) => status.statusDefinitionId === "carnival-bust-bonus")).toBe(false);
    expect(getActiveBustLimit(nextRound, "player")).toBe(21);
    expect(getActiveBustLimit(nextRound, "opponent")).toBe(21);
  });

  it("point advantage does not run comparison effects during a bust settlement", () => {
    let state = gameReducer(fixture("a-single-coin", [card("2"), card("3")]), { type: "PLAY_ABILITY", instanceId: "skill-a-single-coin" });
    state = resolveRound(state, { winner: "opponent", reason: "bust", penaltyTarget: "player", bulletsAdded: 1 });
    expect(state.history.some((event) => event.type === "ABILITY_RESOLUTION_FAILED" && event.definitionId === "a-single-coin")).toBe(false);
  });

  it("stacks Coin only in comparison, remains through settlement, then clears at the round boundary", () => {
    let state = fixture("a-single-coin", [card("2"), card("3")]);
    const second = skillCard("a-single-coin", "skill-a-single-coin-2");
    state = { ...state, playerSkills: { ...state.playerSkills, cards: [...state.playerSkills.cards, second] }, abilities: { ...state.abilities, instances: [...state.abilities.instances, { ...second, createdAtSequence: state.abilities.sequence + 1, parameters: {} }], sequence: state.abilities.sequence + 1 } };
    state = gameReducer(state, { type: "PLAY_ABILITY", instanceId: "skill-a-single-coin" });
    state = gameReducer({ ...state, round: { ...state.round, currentActor: "player" } }, { type: "PLAY_ABILITY", instanceId: "skill-a-single-coin-2" });
    expect(state.abilities.statuses).toContainEqual(expect.objectContaining({ statusDefinitionId: "player-point-advantage", stacks: 2 }));
    const equalPlayer = { ...state.player, hand: createHand([card("2"), card("3")]) };
    const equalOpponent = { ...state.opponent, hand: createHand([card("2"), card("3")]) };
    const equal = { ...state, player: equalPlayer, opponent: equalOpponent, round: { ...state.round, player: equalPlayer, opponent: equalOpponent } };
    const compared = resolveRound(equal, { winner: null, reason: "comparison", penaltyTarget: null, bulletsAdded: 0 });
    expect(compared.round.outcome?.comparisonScores).toEqual({ player: 7, opponent: 5 });
    expect(compared.abilities.statuses).toContainEqual(expect.objectContaining({ statusDefinitionId: "player-point-advantage", duration: "round" }));
    expect(expireStatuses(compared.abilities, "round").statuses.some((status) => status.statusDefinitionId === "player-point-advantage")).toBe(false);
  });
});
