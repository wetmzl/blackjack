import { describe, expect, it } from "vitest";
import type { AbilityWorld } from "./types";
import { resolveAbilityInfoValue } from "./info-bar";
import type { AbilityInfoValue } from "./types";
import { CharacterDataSchema } from "../../content/characters/schema";
import wData from "../../content/characters/data/w.json";
import ireneData from "../../content/characters/data/irene.json";

const world: AbilityWorld = {
  hands: {
    player: { cards: [{ suit: "hearts", rank: "A", origin: "shoe" }] },
    opponent: { cards: [{ suit: "spades", rank: "5", origin: "shoe" }, { suit: "diamonds", rank: "6", origin: "shoe" }] }
  },
  guns: { player: { capacity: 6, bullets: 1 }, opponent: { capacity: 6, bullets: 3 } },
  shoe: { cards: [], cursor: 0, shuffleIndex: 0 }, cards: [], statuses: []
};

describe("character information bar", () => {
  it("derives a numeric value from the ability world", () => {
    const value = wData.infoBar!.value as AbilityInfoValue;
    expect(resolveAbilityInfoValue(value, world)).toBe(1);
    const ownerTrailing = { ...world, hands: { player: world.hands.opponent, opponent: world.hands.player } };
    expect(resolveAbilityInfoValue(value, ownerTrailing)).toBe(0);
  });

  it("returns card and suit values declaratively", () => {
    expect(resolveAbilityInfoValue({ type: "card", target: "owner", card: "first-private-card" }, world)).toEqual(world.hands.opponent.cards[1]);
    expect(resolveAbilityInfoValue({ type: "suit", target: "owner", card: "first-private-card" }, world)).toBe("diamonds");
  });

  it("derives and clamps a round-scoped probability", () => {
    const value = ireneData.infoBar!.value as AbilityInfoValue;
    expect(resolveAbilityInfoValue(value, world, "opponent", { roundHitCounts: { player: 2, opponent: 0 }, sourceActive: true })).toBeCloseTo(0.66);
    expect(resolveAbilityInfoValue(value, world, "opponent", { roundHitCounts: { player: 4, opponent: 0 }, sourceActive: true })).toBe(1);
    expect(resolveAbilityInfoValue(value, world, "opponent", { roundHitCounts: { player: 2, opponent: 0 }, sourceActive: false })).toBe(0);
  });

  it("requires a stable actor and an enabled AI Skill source", () => {
    const transientActor = { ...wData, infoBar: { ...wData.infoBar!, value: { type: "number", value: { type: "hand-card-count", target: "event-actor" } } } };
    const missingSource = { ...wData, infoBar: { ...wData.infoBar!, sourceAbilityId: "missing-ai-skill" } };
    const invalidPercent = { ...wData, infoBar: { ...wData.infoBar!, format: "percent", value: { type: "suit", target: "owner", card: "last-card" } } };
    expect(() => CharacterDataSchema.parse(transientActor)).toThrow();
    expect(() => CharacterDataSchema.parse(missingSource)).toThrow();
    expect(() => CharacterDataSchema.parse(invalidPercent)).toThrow();
  });
});
