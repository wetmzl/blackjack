import { describe, expect, it } from "vitest";
import { createRng } from "../rng/seeded";
import { ABILITY_DEFINITIONS, AI_SKILL_ABILITY_DEFINITIONS, getAbilityDefinition, PLAYER_SKILL_ABILITY_DEFINITIONS, TALENT_ABILITY_DEFINITIONS } from "../abilities/registry";
import { createMatch, gameReducer, getSkillOfferSelectionError } from "../match/reducer";
import type { MatchState, RoundOutcome } from "../match/types";
import { getPlayerSkillDefinition, INITIAL_PLAYER_SKILL_IDS, PLAYER_SKILL_DEFINITIONS } from "./definitions";
import {
  calculatePlayerSkillWeight, collectSkillOfferModifiers, generateSkillOffer, PLAYER_SKILL_INVENTORY_CAPACITY,
  playerSkillsUnlockedForVictory, resolveSkillOfferRule, skillOfferSelectionError, unlockedPlayerSkillIdsForDefeats
} from "./skills";

describe("separate ability domains", () => {
  it("keeps Player Skill, AI Skill, and Talent catalogs disjoint and removes shared definitions", () => {
    const catalogs = [PLAYER_SKILL_ABILITY_DEFINITIONS, AI_SKILL_ABILITY_DEFINITIONS, TALENT_ABILITY_DEFINITIONS];
    const ids = catalogs.flatMap((catalog) => catalog.map((definition) => definition.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ABILITY_DEFINITIONS).toHaveLength(ids.length);
    expect(ABILITY_DEFINITIONS.every((definition) => definition.sourceKind !== ("shared" as never))).toBe(true);
    expect(PLAYER_SKILL_DEFINITIONS.some((skill) => skill.id === "early-preparation")).toBe(false);
    expect(TALENT_ABILITY_DEFINITIONS.map((talent) => talent.id)).toContain("early-preparation");
    expect(getAbilityDefinition("sword-and-handcannon")?.sourceKind).toBe("player-skill");
    expect(getAbilityDefinition("ai-sword-and-handcannon")?.sourceKind).toBe("ai-skill");
  });

  it("requires classified, tagged Player and AI Skills", () => {
    expect([...PLAYER_SKILL_ABILITY_DEFINITIONS, ...AI_SKILL_ABILITY_DEFINITIONS].every((definition) =>
      definition.primaryDomain && definition.tags.length > 0 && new Set(definition.tags).size === definition.tags.length
    )).toBe(true);
    expect(INITIAL_PLAYER_SKILL_IDS).toEqual(["hunter-instinct", "switcheroo", "scent-of-a-woman"]);
  });
});

describe("Skill Offer rules and weighted candidates", () => {
  it.each([
    ["opening", 3, 1],
    ["normal-win", 3, 1],
    ["blackjack-win", 3, 2],
    ["loss", 2, 1],
    ["push", 3, 1]
  ] as const)("resolves %s as %i candidates / choose %i", (reason, candidates, selections) => {
    expect(resolveSkillOfferRule(reason)).toEqual({ candidateCount: candidates, selectionCount: selections });
  });

  it("applies Early Preparation through a generic opening rule modifier", () => {
    const talent = getAbilityDefinition("early-preparation")!;
    const modifiers = collectSkillOfferModifiers([talent]);
    expect(resolveSkillOfferRule("opening", modifiers.rules)).toEqual({ candidateCount: 3, selectionCount: 2 });
    expect(resolveSkillOfferRule("normal-win", modifiers.rules)).toEqual({ candidateCount: 3, selectionCount: 1 });
  });

  it("multiplies every matching tag modifier, including repeated tags from multiple sources", () => {
    const skill = getPlayerSkillDefinition("switcheroo")!;
    expect(calculatePlayerSkillWeight(skill, [
      { tag: "active-skill-card", factor: 0.5 },
      { tag: "active-skill-card", factor: 0.5 },
      { tag: "rule-control", factor: 2 }
    ])).toBe(skill.drop.baseWeight * 0.5 * 0.5 * 2);
  });

  it("collects tag weights declared by an AI Skill through the generic extension point", () => {
    const aiSkill = getAbilityDefinition("action-advice-mechanic")!;
    expect(aiSkill.sourceKind).toBe("ai-skill");
    const modifiers = collectSkillOfferModifiers([aiSkill]);
    expect(calculatePlayerSkillWeight(getPlayerSkillDefinition("hunter-instinct")!, modifiers.weights)).toBe(0.5);
    expect(calculatePlayerSkillWeight(getPlayerSkillDefinition("switcheroo")!, modifiers.weights)).toBe(1);
  });

  it("multiplies modifiers from multiple AI Skills across multiple matching tags", () => {
    const first = { ...getAbilityDefinition("bomb-maniac")!, skillOfferWeightModifiers: [
      { tag: "information", factor: 0.5 }, { tag: "blackjack", factor: 2 }
    ] };
    const second = { ...getAbilityDefinition("w-night-queen")!, skillOfferWeightModifiers: [
      { tag: "information", factor: 0.5 }
    ] };
    const modifiers = collectSkillOfferModifiers([first, second]);
    expect(calculatePlayerSkillWeight(getPlayerSkillDefinition("hunter-instinct")!, modifiers.weights)).toBe(0.5);
  });

  it("draws unlocked droppable definitions without replacement and permits held active definitions", () => {
    const unlocked = PLAYER_SKILL_DEFINITIONS.map((skill) => skill.id);
    const first = generateSkillOffer(createRng("weighted-offer"), "opening", unlocked, ["hunter-instinct"]);
    expect(first.offer.candidateDefinitionIds).toHaveLength(3);
    expect(new Set(first.offer.candidateDefinitionIds).size).toBe(3);
    expect(first.offer.candidateDefinitionIds.every((id) => unlocked.includes(id))).toBe(true);
    expect(first.offer.candidateDefinitionIds).not.toContain("rhodes-heartthrob");
    expect(first).toEqual(generateSkillOffer(createRng("weighted-offer"), "opening", unlocked, ["hunter-instinct"]));
    const activeRepeat = generateSkillOffer(createRng("held-active"), "opening", ["hunter-instinct", "switcheroo", "scent-of-a-woman"], ["hunter-instinct"]);
    expect(activeRepeat.offer.candidateDefinitionIds).toContain("hunter-instinct");
  });

  it("excludes a held non-stackable passive but allows it before acquisition", () => {
    const unlocked = ["forge-heralds-the-year", "hunter-instinct", "switcheroo"];
    const available = generateSkillOffer(createRng("passive-available"), "opening", unlocked, []).offer.candidateDefinitionIds;
    const held = generateSkillOffer(createRng("passive-held"), "opening", unlocked, ["forge-heralds-the-year"]).offer.candidateDefinitionIds;
    expect(available).toContain("forge-heralds-the-year");
    expect(held).not.toContain("forge-heralds-the-year");
  });

  it("handles zero-weight and undersized pools without duplicates or failure", () => {
    const offer = generateSkillOffer(createRng("zero-weight"), "opening", ["hunter-instinct", "switcheroo"], [], [{ tag: "active-skill-card", factor: 0 }]).offer;
    expect(offer.candidateDefinitionIds).toEqual([]);
    expect(offer.maxSelections).toBe(0);
  });
});

describe("Skill Offer selection and inventory", () => {
  it("starts in an offer before dealing and supports select, cancel, confirm, and skip", () => {
    const offered = createMatch("opening-offer");
    expect(offered.round.phase).toBe("skill-offer");
    expect(offered.player.hand.cards).toEqual([]);
    expect(offered.history.some((event) => event.type === "ROUND_STARTED")).toBe(false);
    const id = offered.playerSkills.offer!.candidateDefinitionIds[0]!;
    const selected = gameReducer(offered, { type: "TOGGLE_SKILL_OFFER_SELECTION", definitionId: id });
    expect(selected.playerSkills.offer?.selectedDefinitionIds).toEqual([id]);
    const cancelled = gameReducer(selected, { type: "TOGGLE_SKILL_OFFER_SELECTION", definitionId: id });
    expect(cancelled.playerSkills.offer?.selectedDefinitionIds).toEqual([]);
    expect(gameReducer(offered, { type: "CONFIRM_SKILL_OFFER" })).toBe(offered);
    const confirmed = gameReducer(selected, { type: "CONFIRM_SKILL_OFFER" });
    expect(confirmed.playerSkills.cards).toHaveLength(1);
    expect(confirmed.playerSkills.cards[0]?.definitionId).toBe(id);
    expect(confirmed.round.phase).not.toBe("skill-offer");
    expect(confirmed.history.some((event) => event.type === "ROUND_STARTED")).toBe(true);
    expect(gameReducer(createMatch("opening-skip"), { type: "SKIP_SKILL_OFFER" }).history).toContainEqual(expect.objectContaining({ type: "SKILL_OFFER_RESOLVED", skipped: true }));
  });

  it("raises the opening limit only when the Talent is owned", () => {
    expect(createMatch("no-talent").playerSkills.offer?.maxSelections).toBe(1);
    expect(createMatch("with-talent", { talentIds: ["early-preparation"] }).playerSkills.offer?.maxSelections).toBe(2);
  });

  it.each([
    [{ winner: "player", reason: "comparison", penaltyTarget: "opponent", bulletsAdded: 1 }, "normal-win", 3, 1],
    [{ winner: "player", reason: "blackjack", penaltyTarget: "opponent", bulletsAdded: 2 }, "blackjack-win", 3, 2],
    [{ winner: "opponent", reason: "comparison", penaltyTarget: "player", bulletsAdded: 1 }, "loss", 2, 1],
    [{ winner: null, reason: "push", penaltyTarget: null, bulletsAdded: 0 }, "push", 3, 1]
  ] as const)("creates the next-round %s offer as %s", (outcome, reason, candidates, selections) => {
    const active = gameReducer(createMatch(`next-offer-${reason}`), { type: "SKIP_SKILL_OFFER" });
    const phase = outcome.penaltyTarget ? "roulette-result" as const : "round-reveal" as const;
    const ended: MatchState = { ...active, round: { ...active.round, phase, currentActor: null, outcome: outcome as RoundOutcome } };
    const offered = gameReducer(ended, outcome.penaltyTarget ? { type: "ACK_TRIGGER_RESULT" } : { type: "ACK_ROUND_RESULT" });
    expect(offered.round.phase).toBe("skill-offer");
    expect(offered.playerSkills.offer).toMatchObject({ reason, maxSelections: selections });
    expect(offered.playerSkills.offer?.candidateDefinitionIds).toHaveLength(candidates);
    expect(offered.player.hand.cards).toEqual([]);
  });

  it("turns every confirmed choice into a distinct card and matching runtime instance", () => {
    const offered = createMatch("real-card-instances", {
      unlockedPlayerSkillIds: ["hunter-instinct", "switcheroo", "scent-of-a-woman"],
      talentIds: ["early-preparation"]
    });
    const [first, second] = offered.playerSkills.offer!.candidateDefinitionIds;
    let selected = gameReducer(offered, { type: "TOGGLE_SKILL_OFFER_SELECTION", definitionId: first! });
    selected = gameReducer(selected, { type: "TOGGLE_SKILL_OFFER_SELECTION", definitionId: second! });
    const confirmed = gameReducer(selected, { type: "CONFIRM_SKILL_OFFER" });
    expect(confirmed.playerSkills.cards).toHaveLength(2);
    expect(new Set(confirmed.playerSkills.cards.map((card) => card.instanceId)).size).toBe(2);
    for (const card of confirmed.playerSkills.cards) {
      expect(confirmed.abilities.instances).toContainEqual(expect.objectContaining({
        kind: "player-skill", definitionId: card.definitionId, instanceId: card.instanceId, owner: "player"
      }));
    }
  });

  it("distinguishes selection limit from inventory overflow and permits cancellation", () => {
    const offer = { id: "offer", reason: "blackjack-win" as const, candidateDefinitionIds: ["a", "b", "c"], maxSelections: 2, selectedDefinitionIds: ["a", "b"] };
    expect(skillOfferSelectionError(offer, 0, "c")).toBe("selection-limit");
    expect(skillOfferSelectionError({ ...offer, selectedDefinitionIds: ["a"] }, 9, "b")).toBe("inventory-full");
    expect(skillOfferSelectionError(offer, PLAYER_SKILL_INVENTORY_CAPACITY, "a")).toBeNull();
    expect(generateSkillOffer(createRng("one-slot"), "blackjack-win", ["hunter-instinct", "switcheroo", "scent-of-a-woman"], Array(9).fill("hunter-instinct")).offer.maxSelections).toBe(1);
  });

  it("keeps a full inventory offer visible while every new selection reports overflow", () => {
    const offered = createMatch("full-offer");
    const template = { kind: "player-skill" as const, definitionId: "hunter-instinct", owner: "player" as const };
    const cards = Array.from({ length: PLAYER_SKILL_INVENTORY_CAPACITY }, (_, index) => ({ ...template, instanceId: "full-" + index }));
    const full = { ...offered, playerSkills: { ...offered.playerSkills, cards } };
    const id = full.playerSkills.offer!.candidateDefinitionIds[0]!;
    const regenerated = generateSkillOffer(createRng("full-inventory"), "blackjack-win", full.playerSkills.unlockedDefinitionIds, cards.map((card) => card.definitionId)).offer;
    expect(regenerated.candidateDefinitionIds.length).toBeGreaterThan(0);
    expect(regenerated.maxSelections).toBe(0);
    expect(getSkillOfferSelectionError(full, id)).toBe("inventory-full");
    expect(gameReducer(full, { type: "TOGGLE_SKILL_OFFER_SELECTION", definitionId: id })).toBe(full);
    expect(gameReducer(full, { type: "SKIP_SKILL_OFFER" }).round.phase).not.toBe("skill-offer");
  });
});

describe("Player Skill unlocks", () => {
  it("derives candidates from all durable unlocks rather than a loadout", () => {
    expect(unlockedPlayerSkillIdsForDefeats([])).toEqual(INITIAL_PLAYER_SKILL_IDS);
    expect(unlockedPlayerSkillIdsForDefeats([{ opponentId: "texas", timestamp: "2026-01-01T00:00:00.000Z" }])).toContain("blueberry-and-dark-chocolate");
    expect(playerSkillsUnlockedForVictory("w", "player")).toEqual(["night-queen"]);
    expect(playerSkillsUnlockedForVictory("w", "opponent")).toEqual([]);
  });
});
