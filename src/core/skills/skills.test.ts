import { describe, expect, it } from "vitest";
import { createRng } from "../rng/seeded";
import { ABILITY_DEFINITIONS, AI_SKILL_ABILITY_DEFINITIONS, getAbilityDefinition, PLAYER_SKILL_ABILITY_DEFINITIONS, TALENT_ABILITY_DEFINITIONS } from "../abilities/registry";
import { createMatch, gameReducer, getLegalActions, resolveRound } from "../match/reducer";
import type { MatchState, RoundOutcome } from "../match/types";
import { getPlayerSkillDefinition, INITIAL_PLAYER_SKILL_IDS, PLAYER_SKILL_DEFINITIONS } from "./definitions";
import {
  calculatePlayerSkillWeight, collectSkillDrawWeightModifiers, generateSkillDrawOffer, PLAYER_SKILL_INVENTORY_CAPACITY,
  playerSkillsUnlockedForVictory, SKILL_DRAW_CANDIDATE_COUNT, unlockedPlayerSkillIdsForDefeats
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

describe("skill draw weighted candidates", () => {
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
    const modifiers = collectSkillDrawWeightModifiers([aiSkill]);
    expect(calculatePlayerSkillWeight(getPlayerSkillDefinition("hunter-instinct")!, modifiers)).toBe(0.5);
    expect(calculatePlayerSkillWeight(getPlayerSkillDefinition("switcheroo")!, modifiers)).toBe(1);
  });

  it("multiplies modifiers from multiple AI Skills across multiple matching tags", () => {
    const first = { ...getAbilityDefinition("bomb-maniac")!, skillDrawWeightModifiers: [
      { tag: "information", factor: 0.5 }, { tag: "blackjack", factor: 2 }
    ] };
    const second = { ...getAbilityDefinition("w-night-queen")!, skillDrawWeightModifiers: [
      { tag: "information", factor: 0.5 }
    ] };
    const modifiers = collectSkillDrawWeightModifiers([first, second]);
    expect(calculatePlayerSkillWeight(getPlayerSkillDefinition("hunter-instinct")!, modifiers)).toBe(0.5);
  });

  it("draws unlocked droppable definitions without replacement and permits held active definitions", () => {
    const unlocked = PLAYER_SKILL_DEFINITIONS.map((skill) => skill.id);
    const first = generateSkillDrawOffer(createRng("weighted-offer"), unlocked, ["hunter-instinct"]);
    expect(first.offer.candidateDefinitionIds).toHaveLength(SKILL_DRAW_CANDIDATE_COUNT);
    expect(new Set(first.offer.candidateDefinitionIds).size).toBe(3);
    expect(first.offer.candidateDefinitionIds.every((id) => unlocked.includes(id))).toBe(true);
    expect(first.offer.candidateDefinitionIds).not.toContain("rhodes-heartthrob");
    expect(first).toEqual(generateSkillDrawOffer(createRng("weighted-offer"), unlocked, ["hunter-instinct"]));
    const activeRepeat = generateSkillDrawOffer(createRng("held-active"), ["hunter-instinct", "switcheroo", "scent-of-a-woman"], ["hunter-instinct"]);
    expect(activeRepeat.offer.candidateDefinitionIds).toContain("hunter-instinct");
  });

  it("excludes a held non-stackable passive but allows it before acquisition", () => {
    const unlocked = ["forge-heralds-the-year", "hunter-instinct", "switcheroo"];
    const available = generateSkillDrawOffer(createRng("passive-available"), unlocked, []).offer.candidateDefinitionIds;
    const held = generateSkillDrawOffer(createRng("passive-held"), unlocked, ["forge-heralds-the-year"]).offer.candidateDefinitionIds;
    expect(available).toContain("forge-heralds-the-year");
    expect(held).not.toContain("forge-heralds-the-year");
  });

  it("handles zero-weight and undersized pools without duplicates or failure", () => {
    const offer = generateSkillDrawOffer(createRng("zero-weight"), ["hunter-instinct", "switcheroo"], [], [{ tag: "active-skill-card", factor: 0 }]).offer;
    expect(offer.candidateDefinitionIds).toEqual([]);
  });
});

describe("skill draw credits, selection, and inventory", () => {
  function playerTurn(seed: string, options: Parameters<typeof createMatch>[1] = {}): MatchState {
    for (let index = 0; index < 10_000; index += 1) {
      const state = createMatch(`${seed}-${index}`, options);
      if (state.round.phase === "turns") return { ...state, round: { ...state.round, currentActor: "player" } };
    }
    throw new Error("No deterministic turns fixture found");
  }

  it("deals immediately without an opening draw or skill card", () => {
    const state = playerTurn("no-opening-draw");
    expect(state.player.hand.cards).toHaveLength(2);
    expect(state.history.some((event) => event.type === "ROUND_STARTED")).toBe(true);
    expect(state.playerSkills).toMatchObject({ cards: [], drawCount: 0, drawOffer: null });
  });

  it("Early Preparation grants one opening draw through its data-driven effect", () => {
    const state = playerTurn("early-preparation", { talentIds: ["early-preparation"] });
    expect(state.playerSkills.drawCount).toBe(1);
    expect(state.history).toContainEqual(expect.objectContaining({ type: "ABILITY_TRIGGERED", definitionId: "early-preparation", ruleId: "grant-opening-skill-draw" }));
  });

  it.each([
    [{ winner: "player", reason: "comparison", penaltyTarget: "opponent", bulletsAdded: 1 }, "win", 1],
    [{ winner: "player", reason: "blackjack", penaltyTarget: "opponent", bulletsAdded: 2 }, "blackjack", 2],
    [{ winner: "opponent", reason: "comparison", penaltyTarget: "player", bulletsAdded: 1 }, "loss", 1],
    [{ winner: "opponent", reason: "blackjack", penaltyTarget: "player", bulletsAdded: 2 }, "loss", 1],
    [{ winner: null, reason: "push", penaltyTarget: null, bulletsAdded: 0 }, "push", 1]
  ] as const)("awards a %s result as %i draw(s)", (outcome, reason, amount) => {
    const active = playerTurn(`draw-reward-${reason}`);
    const resolved = resolveRound({ ...active, playerSkills: { ...active.playerSkills, drawCount: 0 } }, outcome as RoundOutcome);
    expect(resolved.playerSkills.drawCount).toBe(amount);
    expect(resolved.history).toContainEqual({ type: "SKILL_DRAWS_ADDED", reason, amount });
  });

  it("opens three fixed candidates and confirms exactly one card on click", () => {
    const ready = playerTurn("single-click-draw", { unlockedPlayerSkillIds: ["hunter-instinct", "switcheroo", "scent-of-a-woman"] });
    const charged = { ...ready, playerSkills: { ...ready.playerSkills, drawCount: 2 } };
    const opened = gameReducer(charged, { type: "OPEN_SKILL_DRAW" });
    expect(opened.playerSkills.drawOffer?.candidateDefinitionIds).toHaveLength(SKILL_DRAW_CANDIDATE_COUNT);
    expect(getLegalActions(opened)).not.toContainEqual({ type: "PLAYER_HIT" });
    expect(getLegalActions(opened)).not.toContainEqual({ type: "PLAYER_STAND" });
    const id = opened.playerSkills.drawOffer!.candidateDefinitionIds[0]!;
    const selected = gameReducer(opened, { type: "SELECT_SKILL_DRAW", definitionId: id });
    expect(selected.playerSkills.cards).toHaveLength(1);
    expect(selected.playerSkills.cards[0]?.definitionId).toBe(id);
    expect(selected.playerSkills.drawCount).toBe(1);
    expect(selected.playerSkills.drawOffer).toBeNull();
    const card = selected.playerSkills.cards[0]!;
    expect(selected.abilities.instances).toContainEqual(expect.objectContaining({
      kind: "player-skill", definitionId: card.definitionId, instanceId: card.instanceId, owner: "player"
    }));
  });

  it("disables drawing when the inventory is full and keeps earned draws", () => {
    const ready = playerTurn("full-draw");
    const template = { kind: "player-skill" as const, definitionId: "hunter-instinct", owner: "player" as const };
    const cards = Array.from({ length: PLAYER_SKILL_INVENTORY_CAPACITY }, (_, index) => ({ ...template, instanceId: "full-" + index }));
    const full = { ...ready, playerSkills: { ...ready.playerSkills, cards, drawCount: 3 } };
    expect(getLegalActions(full)).not.toContainEqual({ type: "OPEN_SKILL_DRAW" });
    expect(gameReducer(full, { type: "OPEN_SKILL_DRAW" })).toBe(full);
    expect(full.playerSkills.drawCount).toBe(3);
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
