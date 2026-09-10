import { describe, expect, it } from "vitest";
import { createCard, createDerivedCard } from "../blackjack/card";
import { createHand } from "../blackjack/hand";
import type { Card, PhysicalCard } from "../blackjack/types";
import { getAbilityDefinition } from "../abilities/registry";
import { AbilityDefinitionSchema } from "../abilities/schema";
import { createMatch, gameReducer } from "./reducer";
import type { MatchState, ParticipantState, RoundState } from "./types";

const DEFINITION_ID = "sleight-of-hand";
const INSTANCE_ID = "skill-sleight-of-hand";

function fixture(rivalLast: Card): MatchState {
  const playerFirst = createCard("clubs", "6", "sleight-player-first");
  const playerLast = createCard("diamonds", "5", "sleight-player-last");
  const rivalFirst = createCard("spades", "10", "sleight-rival-first");
  const next = createCard("hearts", "2", "sleight-next");
  const base = createMatch("player-skill-sleight-of-hand", { unlockedPlayerSkillIds: [DEFINITION_ID] });
  const skill = { kind: "player-skill" as const, definitionId: DEFINITION_ID, owner: "player" as const, instanceId: INSTANCE_ID };
  const player: ParticipantState = { id: "player", hand: createHand([playerFirst, playerLast]), stood: false, busted: false };
  const opponent: ParticipantState = { id: "opponent", hand: createHand([rivalFirst, rivalLast]), stood: false, busted: false };
  const round: RoundState = { ...base.round, phase: "turns", currentActor: "player", player, opponent, outcome: null };
  const shoeCards = rivalLast.attributes.source === "shoe"
    ? [playerFirst, rivalFirst, playerLast, rivalLast, next]
    : [playerFirst, rivalFirst, playerLast, next];
  return {
    ...base,
    player,
    opponent,
    round,
    shoe: { cards: shoeCards as PhysicalCard[], cursor: shoeCards.length - 1, shuffleIndex: 1 },
    playerSkills: { ...base.playerSkills, cards: [skill] },
    abilities: {
      ...base.abilities,
      instances: [...base.abilities.instances, { ...skill, createdAtSequence: base.abilities.sequence + 1, parameters: {} }],
      sequence: base.abilities.sequence + 1
    }
  };
}

describe("Sleight of Hand Player Skill", () => {
  it("is an initially unlocked active Cheater definition with a strict physical-transfer effect", () => {
    const definition = getAbilityDefinition(DEFINITION_ID)!;
    expect(definition).toMatchObject({
      sourceKind: "player-skill",
      primaryDomain: "cheater",
      skillTags: ["cheater"],
      activation: { type: "action", windows: ["owner-turn"], consume: "card" }
    });
    expect(definition.sourceKind === "player-skill" ? definition.unlock : undefined).toBeUndefined();
    const effect = definition.rules[0]!.effects[0]!;
    expect(effect).toEqual({ type: "transfer-last-physical-hand-card", from: "rival", target: "owner" });
    expect(AbilityDefinitionSchema.safeParse({ ...definition, rules: [{ ...definition.rules[0], effects: [{ ...effect, extra: true }] }] }).success).toBe(false);
  });

  it("moves the rival's last physical card into the player's hand without cloning or touching the shoe", () => {
    const stolen = createCard("hearts", "4", "sleight-stolen");
    const initial = fixture(stolen);
    const next = gameReducer(initial, { type: "PLAY_ABILITY", instanceId: INSTANCE_ID });

    expect(next).not.toBe(initial);
    expect(next.opponent.hand.cards).toHaveLength(1);
    expect(next.opponent.hand.cards).not.toContain(stolen);
    expect(next.player.hand.cards).toHaveLength(3);
    expect(next.player.hand.cards.at(-1)).toBe(stolen);
    expect(next.player.hand.cards.at(-1)).toMatchObject({ id: "sleight-stolen", attributes: { source: "shoe", rank: "4", suit: "hearts" }, tags: [] });
    expect(next.shoe).toBe(initial.shoe);
    expect(next.playerSkills.cards).toHaveLength(0);
    expect(next.history).toContainEqual(expect.objectContaining({ type: "ABILITY_TRIGGERED", definitionId: DEFINITION_ID, ruleId: "steal-rival-last-card", owner: "player" }));
  });

  it("does not consume the skill when the rival's last card is derived", () => {
    const initial = fixture(createDerivedCard("hearts", "4", "sleight-derived", "fixture"));
    const next = gameReducer(initial, { type: "PLAY_ABILITY", instanceId: INSTANCE_ID });

    expect(next).toBe(initial);
    expect(next.playerSkills.cards).toHaveLength(1);
    expect(next.opponent.hand.cards.at(-1)?.attributes.source).toBe("derived");
  });
});
