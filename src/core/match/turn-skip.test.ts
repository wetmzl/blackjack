import { describe, expect, it } from "vitest";
import { createCard } from "../blackjack/card";
import { createHand } from "../blackjack/hand";
import type { PhysicalCard } from "../blackjack/types";
import { getAbilityDefinition } from "../abilities/registry";
import { AbilityDefinitionSchema } from "../abilities/schema";
import { abilityTriggerNotice } from "../../presentation/ability-notices";
import { resolveDialogueLine, resolveDialogueState } from "../../dialogue/state";
import { DIALOGUE_EVENT_CODES, type CharacterDialogue } from "../../dialogue/types";
import { createMatch, gameReducer, getLegalActions } from "./reducer";
import type { MatchState } from "./types";

const binding = { definitionId: "turn-skip-mechanic", enabled: true, parameters: {} } as const;
const dialogue = Object.fromEntries(DIALOGUE_EVENT_CODES.map((event) => [event, [`${event}-甲`, `${event}-乙`]])) as unknown as CharacterDialogue;

function openingSkipMatch(): MatchState {
  for (let index = 0; index < 10_000; index += 1) {
    const state = createMatch(`turn-skip-${index}`, { opponentAiSkills: [binding] });
    if (state.round.phase === "turns" && state.history.some((event) => event.type === "TURN_SKIPPED")) return state;
  }
  throw new Error("No opening turn-skip fixture found");
}

function safePlayerTurn(state: MatchState): MatchState {
  const playerCards = [createCard("clubs", "2", "skip-player-2"), createCard("diamonds", "3", "skip-player-3")];
  const opponentCards = [createCard("spades", "10", "skip-opponent-10"), createCard("hearts", "7", "skip-opponent-7")];
  const nextCard = createCard("clubs", "4", "skip-next-4");
  const player = { ...state.player, hand: createHand(playerCards), stood: false, busted: false };
  const opponent = { ...state.opponent, hand: createHand(opponentCards), stood: false, busted: false };
  return {
    ...state,
    player,
    opponent,
    shoe: { cards: [...playerCards, ...opponentCards, nextCard] as PhysicalCard[], cursor: 4, shuffleIndex: 1 },
    round: { ...state.round, phase: "turns", currentActor: "player", player, opponent, outcome: null }
  };
}

describe("skip-turn ability primitive", () => {
  it("registers a strict hidden fixture using the generic turn-start window", () => {
    const definition = getAbilityDefinition("turn-skip-mechanic")!;
    expect(definition).toMatchObject({ hidden: true, sourceKind: "ai-skill", activation: { type: "automatic" } });
    expect(definition.rules[0]).toMatchObject({
      trigger: "before-turn",
      notify: false,
      conditions: [
        { type: "actor-is", actor: "owner" },
        { type: "pending-turn-can-skip", target: "owner" }
      ],
      effects: [{ type: "skip-turn", target: "owner" }]
    });
    const condition = definition.rules[0]!.conditions![1]!;
    const effect = definition.rules[0]!.effects[0]!;
    expect(AbilityDefinitionSchema.safeParse({ ...definition, rules: [{ ...definition.rules[0], conditions: [{ ...condition, extra: true }] }] }).success).toBe(false);
    expect(AbilityDefinitionSchema.safeParse({ ...definition, rules: [{ ...definition.rules[0], effects: [{ ...effect, extra: true }] }] }).success).toBe(false);
  });

  it("skips an opening opponent turn without Hit, Stand, or a visible ability notice", () => {
    const state = openingSkipMatch();
    const skipped = state.history.filter((event) => event.type === "TURN_SKIPPED");

    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({ actor: "opponent" });
    expect(state.round.currentActor).toBe("player");
    expect(state.opponent.stood).toBe(false);
    expect(state.history.some((event) => event.type === "OPPONENT_HIT" || event.type === "OPPONENT_STOOD")).toBe(false);
    expect(getLegalActions(state)).toEqual(expect.arrayContaining([{ type: "PLAYER_HIT" }, { type: "PLAYER_STAND" }]));
    expect(abilityTriggerNotice(state.history, "测试对手")).toEqual([]);
  });

  it("keeps skipping after player Hit, then lets the opponent decide normally after player Stand", () => {
    const initial = safePlayerTurn(openingSkipMatch());
    const afterHit = gameReducer(initial, { type: "PLAYER_HIT" });
    const hitEvents = afterHit.history.slice(initial.history.length);

    expect(hitEvents).toContainEqual(expect.objectContaining({ type: "PLAYER_HIT" }));
    expect(hitEvents).toContainEqual(expect.objectContaining({ type: "TURN_SKIPPED", actor: "opponent" }));
    expect(hitEvents.some((event) => event.type === "OPPONENT_HIT" || event.type === "OPPONENT_STOOD")).toBe(false);
    expect(afterHit.round.currentActor).toBe("player");
    expect(afterHit.opponent.stood).toBe(false);
    expect(resolveDialogueState(afterHit).event).toBe("PLAYER_HIT");

    const afterStand = gameReducer(afterHit, { type: "PLAYER_STAND" });
    const standEvents = afterStand.history.slice(afterHit.history.length);
    expect(standEvents).toContainEqual({ type: "PLAYER_STOOD" });
    expect(standEvents.some((event) => event.type === "TURN_SKIPPED")).toBe(false);
    expect(afterStand.round.currentActor).toBe("opponent");
    expect(afterStand.opponent.stood).toBe(false);
    expect(getLegalActions(afterStand)).toContainEqual({ type: "AI_TURN" });
    expect(resolveDialogueState(afterStand).event).toBe("PLAYER_STAND");
  });

  it("keeps opening dialogue stable when the first turn is skipped", () => {
    const skipped = openingSkipMatch();
    const control = createMatch(skipped.seed);
    expect(resolveDialogueState(skipped)).toEqual(resolveDialogueState(control));
    expect(resolveDialogueLine(skipped, dialogue)).toBe(resolveDialogueLine(control, dialogue));
  });

  it("bounds reciprocal skip rules and leaves both participants able to decide later", () => {
    let state: MatchState | undefined;
    for (let index = 0; index < 10_000; index += 1) {
      const candidate = createMatch(`reciprocal-turn-skip-${index}`, { opponentAiSkills: [binding], playerAiSkills: [binding] });
      if (candidate.round.phase === "turns") { state = candidate; break; }
    }
    expect(state).toBeDefined();
    expect(state!.history.filter((event) => event.type === "TURN_SKIPPED")).toHaveLength(2);
    expect(state!.round.currentActor).toBe(state!.round.starter);
    expect(state!.player.stood).toBe(false);
    expect(state!.opponent.stood).toBe(false);
  });
});
