import { describe, expect, it } from "vitest";
import { createMatch, gameReducer, getLegalActions } from "../core/match/reducer";
import { acknowledgeMatchResult, bootLoad, clearMatchHistory, createDefaultSave, createRuntimeSave, resetSave, restoreActiveMatch } from "./boot";
import { createAutosaveController } from "./autosave";
import { exportSaveJson, importSave } from "./json";
import { canMigrateLongTermSave, migrateLongTermSave } from "./migrations";
import { MemorySaveRepository } from "./memory-repository";
import {
  assertMatchStateForSave,
  CURRENT_LONG_TERM_SCHEMA_VERSION,
  CURRENT_RUNTIME_SCHEMA_VERSION,
  LONG_TERM_SAVE_FORMAT,
  SaveValidationError,
  validateLongTermSave,
  validateRuntimeSave,
  type LongTermSave,
  type RuntimeSave
} from "./schema";
import type { SaveRepository } from "./repository";
import { requestPersistentStorage } from "./storage";
import { createCard, createDerivedCard } from "../core/blackjack/card";
import { addCard, createHand } from "../core/blackjack/hand";
import type { MatchState } from "../core/match/types";
import { unlockedPlayerSkillIdsForDefeats } from "../core/skills/skills";
import { unlockedCharacterIdsForDefeats } from "../content/characters/unlocks";

const NOW = "2026-08-30T00:00:00.000Z";

function createActiveMatch(seed: string, options: Parameters<typeof createMatch>[1] = {}): MatchState {
  return createMatch(seed, options);
}

describe("long-term save schema and JSON boundary", () => {
  it("round-trips only durable data and includes tutorial progress", async () => {
    const save = createDefaultSave(NOW);
    const imported = await importSave(exportSaveJson(save));
    expect(imported).toEqual(save);
    expect(imported.schemaVersion).toBe(CURRENT_LONG_TERM_SCHEMA_VERSION);
    expect(imported.skipTutorial).toBe(false);
    expect(imported.tutorialProgress).toEqual({ completedIds: [] });
    expect(imported).not.toHaveProperty("activeMatch");
  });

  it("loads saves created before tutorial progress and accepts unknown future tutorial ids", () => {
    const legacy = structuredClone(createDefaultSave(NOW)) as Partial<LongTermSave>;
    delete legacy.tutorialProgress;
    expect(validateLongTermSave(legacy).tutorialProgress).toEqual({ completedIds: [] });

    const future = createDefaultSave(NOW);
    future.tutorialProgress.completedIds.push("future-mechanic-tutorial");
    expect(validateLongTermSave(future).tutorialProgress.completedIds).toEqual(["future-mechanic-tutorial"]);
    expect(() => validateLongTermSave({ ...future, tutorialProgress: { completedIds: ["same", "same"] } })).toThrow(/duplicate completed tutorial id/);
  });

  it("rejects unknown fields, incompatible versions, and the former combined format", () => {
    const save = createDefaultSave(NOW);
    expect(() => validateLongTermSave({ ...save, unexpected: true })).toThrow(SaveValidationError);
    expect(() => validateLongTermSave({ ...save, schemaVersion: CURRENT_LONG_TERM_SCHEMA_VERSION + 1 })).toThrow(/schemaVersion/);
    expect(() => validateLongTermSave({ ...save, schemaVersion: 0 })).toThrow(/schemaVersion/);
    expect(() => validateLongTermSave({ ...save, format: "other-game" })).toThrow(SaveValidationError);
    expect(() => validateLongTermSave({ ...save, activeMatch: createMatch("old-combined") })).toThrow(SaveValidationError);
    expect(() => validateLongTermSave({ ...save, skipTutorial: undefined })).toThrow(/skipTutorial/);
  });

  it("migrates a version 8 long-term save through the standalone migration chain", () => {
    const current = createDefaultSave(NOW);
    const legacy = {
      format: current.format,
      schemaVersion: 8,
      gameVersion: current.gameVersion,
      createdAt: current.createdAt,
      updatedAt: current.updatedAt,
      profile: {
        id: current.profile.id,
        displayName: current.profile.displayName,
        matchesPlayed: 4,
        wins: 2,
        talentIds: ["early-preparation"]
      },
      settings: current.settings,
      skipTutorial: true,
      history: current.history,
      defeats: current.defeats
    };

    expect(canMigrateLongTermSave(legacy)).toBe(true);
    expect(migrateLongTermSave(legacy)).toEqual({
      ...current,
      profile: { ...current.profile, matchesPlayed: 4, wins: 2, selectedSkillTags: [] },
      skipTutorial: true
    });
    expect(canMigrateLongTermSave({ ...legacy, schemaVersion: 7 })).toBe(false);
    expect(canMigrateLongTermSave({ ...legacy, schemaVersion: CURRENT_LONG_TERM_SCHEMA_VERSION + 1 })).toBe(false);
  });

  it("keeps failed imports available for migration or raw export", async () => {
    const incompatible = { format: LONG_TERM_SAVE_FORMAT, schemaVersion: 8 };
    await expect(importSave(JSON.stringify(incompatible))).rejects.toMatchObject({ kind: "long-term", input: incompatible });
    await expect(importSave("{broken-json")).rejects.toMatchObject({ kind: "long-term", input: "{broken-json" });
  });

  it("requires unique defeat facts and validates selected skill tags", () => {
    const save = createDefaultSave(NOW);
    expect(() => validateLongTermSave({ ...save, defeats: [{ opponentId: "w", timestamp: NOW }, { opponentId: "w", timestamp: NOW }] })).toThrow(/duplicate defeated character/);
    expect(() => validateLongTermSave({ ...save, profile: { ...save.profile, selectedSkillTags: ["gambler", "gambler"] } })).toThrow(/duplicate selected Skill Tag/);
    expect(() => validateLongTermSave({ ...save, profile: { ...save.profile, selectedSkillTags: ["missing-tag"] } })).toThrow(/profile/);
  });
});

describe("runtime save schema and validation", () => {
  it("round-trips an active MatchState independently from durable data", () => {
    const runtime = createRuntimeSave(createMatch("runtime-roundtrip"), NOW);
    const imported = validateRuntimeSave(JSON.parse(JSON.stringify(runtime)) as unknown);
    expect(imported).toEqual(runtime);
    expect(imported.schemaVersion).toBe(CURRENT_RUNTIME_SCHEMA_VERSION);
    expect(imported.activeMatch.rng.deck).toEqual(runtime.activeMatch.rng.deck);
    expect(imported).not.toHaveProperty("profile");
    expect(imported).not.toHaveProperty("history");
  });

  it("round-trips the last successfully played Player Skill memory", () => {
    const match = createMatch("memory-roundtrip");
    const withMemory = { ...match, abilities: { ...match.abilities, lastPlayedPlayerSkillDefinitionId: "a-single-coin" } };
    const imported = validateRuntimeSave(JSON.parse(JSON.stringify(createRuntimeSave(withMemory, NOW))) as unknown);
    expect(imported.activeMatch.abilities.lastPlayedPlayerSkillDefinitionId).toBe("a-single-coin");
    const invalid = structuredClone(createRuntimeSave(withMemory, NOW)) as unknown as Record<string, unknown>;
    (((invalid.activeMatch as Record<string, unknown>).abilities as Record<string, unknown>).lastPlayedPlayerSkillDefinitionId) = "early-preparation";
    expect(() => validateRuntimeSave(invalid)).toThrow(/last played Player Skill memory is invalid/);
  });

  it("persists the selected Skill Tag snapshot and rejects duplicates", () => {
    const match = createMatch("selected-skill-tag-save", { selectedSkillTags: ["gambler", "cheater"] });
    const runtime = JSON.parse(JSON.stringify(createRuntimeSave(match, NOW))) as Record<string, unknown>;
    const imported = validateRuntimeSave(runtime);
    expect(imported.activeMatch.playerSkills.selectedSkillTags).toEqual(["gambler", "cheater"]);
    const skills = (runtime.activeMatch as Record<string, unknown>).playerSkills as Record<string, unknown>;
    skills.selectedSkillTags = ["gambler", "gambler"];
    expect(() => validateRuntimeSave(runtime)).toThrow(/duplicate selected Skill Tag/);
  });

  it("round-trips the suit-only private-card reveal event", () => {
    const match = createMatch("suit-event-roundtrip");
    const privateCard = match.opponent.hand.cards[1]!;
    const withReveal = { ...match, history: [...match.history, { type: "CARD_SUIT_REVEALED" as const, viewer: "player" as const, target: "opponent" as const, cardId: privateCard.id, suit: "hearts" as const }] };
    const imported = validateRuntimeSave(JSON.parse(JSON.stringify(createRuntimeSave(withReveal, NOW))) as unknown);
    expect(imported.activeMatch.history.at(-1)).toEqual(withReveal.history.at(-1));
  });

  it("round-trips intelligence reports and direct gun-load results", () => {
    const match = createMatch("new-player-skill-events");
    const events = [
      { type: "DRAW_PILE_CARD_SUIT_REVEALED" as const, viewer: "player" as const, cardId: match.shoe.cards[match.shoe.cursor]!.id, suit: "clubs" as const },
      { type: "DRAW_PILE_CARD_REVEALED" as const, viewer: "player" as const, cardId: match.shoe.cards[match.shoe.cursor]!.id, rank: "A" as const, suit: "clubs" as const },
      { type: "ABILITY_RESULT" as const, instanceId: "judgment", definitionId: "critical-judgment", owner: "player" as const, result: { type: "hit-bust-forecast" as const, actor: "player" as const, wouldBust: true } },
      { type: "ABILITY_RESULT" as const, instanceId: "assessment", definitionId: "situation-assessment", owner: "player" as const, result: { type: "hand-total-compared" as const, actor: "player" as const, relation: "higher" as const } },
      { type: "ABILITY_RESULT" as const, instanceId: "premium", definitionId: "prepaid-premium", owner: "player" as const, result: { type: "gun-bullets-added" as const, actor: "player" as const, amount: 1, bullets: 1 } }
    ];
    const withEvents = { ...match, history: [...match.history, ...events] };
    const imported = validateRuntimeSave(JSON.parse(JSON.stringify(createRuntimeSave(withEvents, NOW))) as unknown);
    expect(imported.activeMatch.history.slice(-events.length)).toEqual(events);
  });

  it("round-trips an open skill draw without changing the player turn", () => {
    let match = createMatch("open-skill-draw-save");
    match = { ...match, round: { ...match.round, phase: "turns", currentActor: "player", outcome: null }, playerSkills: { ...match.playerSkills, drawCount: 1 } };
    match = gameReducer(match, { type: "OPEN_SKILL_DRAW" });
    expect(match.playerSkills.drawOffer?.candidateDefinitionIds).toHaveLength(3);
    const imported = validateRuntimeSave(JSON.parse(JSON.stringify(createRuntimeSave(match, NOW))) as unknown);
    expect(imported.activeMatch.playerSkills.drawOffer).toEqual(match.playerSkills.drawOffer);
    expect(imported.activeMatch.playerSkills.drawCount).toBe(1);
    expect(imported.activeMatch.round).toMatchObject({ phase: "turns", currentActor: "player" });
  });

  it("round-trips final point-comparison scores used by the table UI", () => {
    const match = createActiveMatch("comparison-score-roundtrip");
    const outcome = { winner: "opponent" as const, reason: "comparison" as const, penaltyTarget: "player" as const, bulletsAdded: 1, comparisonScores: { player: 17, opponent: 19 } };
    const resolved = {
      ...match,
      round: { ...match.round, phase: "round-reveal" as const, currentActor: null, outcome },
      history: [...match.history, { type: "ROUND_RESOLVED" as const, outcome }]
    };
    const imported = validateRuntimeSave(JSON.parse(JSON.stringify(createRuntimeSave(resolved, NOW))) as unknown);
    expect(imported.activeMatch.round.outcome?.comparisonScores).toEqual({ player: 17, opponent: 19 });
    expect(imported.activeMatch.history.at(-1)).toEqual({ type: "ROUND_RESOLVED", outcome });
  });

  it("rejects malformed nested cards, RNG, guns, and unknown fields as runtime-only errors", () => {
    const invalidCard = structuredClone(createRuntimeSave(createActiveMatch("invalid-match"), NOW)) as unknown as Record<string, unknown>;
    const match = invalidCard.activeMatch as Record<string, unknown>;
    const player = match.player as Record<string, unknown>;
    const hand = player.hand as Record<string, unknown>;
    (((hand.cards as Array<Record<string, unknown>>)[0]!.attributes) as Record<string, unknown>).rank = "JOKER";
    expect(() => validateRuntimeSave(invalidCard)).toThrow(/activeMatch/);

    const invalidRng = structuredClone(createRuntimeSave(createMatch("invalid-rng"), NOW)) as unknown as Record<string, unknown>;
    ((((invalidRng.activeMatch as Record<string, unknown>).rng as Record<string, unknown>).ai as Record<string, unknown>)).state = -1;
    expect(() => validateRuntimeSave(invalidRng)).toThrow(SaveValidationError);

    const invalidShoe = structuredClone(createRuntimeSave(createMatch("invalid-shoe"), NOW)) as unknown as Record<string, unknown>;
    const shoe = ((invalidShoe.activeMatch as Record<string, unknown>).shoe as Record<string, unknown>);
    shoe.cursor = (shoe.cards as unknown[]).length + 1;
    expect(() => validateRuntimeSave(invalidShoe)).toThrow(/cursor cannot exceed cards length/);

    try { validateRuntimeSave(invalidShoe); }
    catch (error) { expect(error).toMatchObject({ kind: "runtime" }); }
  });

  it("rejects duplicate card identities and tags", () => {
    const duplicateId = JSON.parse(JSON.stringify(createRuntimeSave(createMatch("duplicate-card-id"), NOW))) as Record<string, unknown>;
    const match = duplicateId.activeMatch as Record<string, unknown>;
    const playerCards = (((match.player as Record<string, unknown>).hand as Record<string, unknown>).cards) as Array<Record<string, unknown>>;
    const opponentCards = (((match.opponent as Record<string, unknown>).hand as Record<string, unknown>).cards) as Array<Record<string, unknown>>;
    opponentCards[0]!.id = playerCards[0]!.id;
    expect(() => validateRuntimeSave(duplicateId)).toThrow(/multiple hand slots/i);

    const duplicateTag = JSON.parse(JSON.stringify(createRuntimeSave(createMatch("duplicate-card-tag"), NOW))) as Record<string, unknown>;
    const tagMatch = duplicateTag.activeMatch as Record<string, unknown>;
    const tagCards = ((((tagMatch.player as Record<string, unknown>).hand as Record<string, unknown>).cards) as Array<Record<string, unknown>>);
    tagCards[0]!.tags = ["marked", "marked"];
    expect(() => validateRuntimeSave(duplicateTag)).toThrow(/duplicate card tag/i);
  });

  it("rejects missing ability definitions, catalog mismatches, and unknown characters", () => {
    const saved = structuredClone(createRuntimeSave(createMatch("ability-save-errors", { talentIds: ["early-preparation"] }), NOW)) as unknown as Record<string, unknown>;
    const missing = structuredClone(saved);
    const missingRuntime = (((missing.activeMatch as Record<string, unknown>).abilities as Record<string, unknown>));
    ((missingRuntime.instances as Array<Record<string, unknown>>)[0]!).definitionId = "missing-definition";
    expect(() => validateRuntimeSave(missing)).toThrow(/activeMatch.*abilities.*instances|unknown ability definition/i);

    const mismatch = structuredClone(saved);
    ((((mismatch.activeMatch as Record<string, unknown>).abilities as Record<string, unknown>)).catalogVersion) = "abilities-v999";
    expect(() => validateRuntimeSave(mismatch)).toThrow(/catalogVersion.*unsupported ability catalog version/i);

    const unknownCharacter = structuredClone(saved);
    (unknownCharacter.activeMatch as Record<string, unknown>).opponentId = "retired-character";
    expect(() => validateRuntimeSave(unknownCharacter)).toThrow(/activeMatch.*opponentId.*unknown character/i);

    const wrongOwner = structuredClone(saved);
    const talent = (((wrongOwner.activeMatch as Record<string, unknown>).abilities as Record<string, unknown>).instances as Array<Record<string, unknown>>)[0]!;
    talent.owner = "opponent";
    expect(() => validateRuntimeSave(wrongOwner)).toThrow(/talent runtime instances must be owned by the player/i);
  });

  it("keeps a runtime save valid after consuming a concrete ability card", () => {
    let match = createMatch("post-ability-save");
    match = { ...match, round: { ...match.round, phase: "turns", currentActor: "player" }, playerSkills: { ...match.playerSkills, drawCount: 1 } };
    match = gameReducer(match, { type: "OPEN_SKILL_DRAW" });
    const candidate = match.playerSkills.drawOffer!.candidateDefinitionIds[0]!;
    match = gameReducer(match, { type: "SELECT_SKILL_DRAW", definitionId: candidate });
    for (let index = 0; index < 80; index += 1) {
      const action = getLegalActions(match).find((candidate) => candidate.type === "PLAY_ABILITY");
      if (action) { match = gameReducer(match, action); break; }
      const next = getLegalActions(match).find((candidate) => candidate.type === "AI_TURN" || candidate.type === "PLAYER_STAND" || candidate.type === "ACK_ROUND_RESULT" || candidate.type === "TRIGGER_ROULETTE" || candidate.type === "ACK_TRIGGER_RESULT");
      if (!next) break;
      match = gameReducer(match, next);
    }
    expect(match.history.some((event) => event.type === "ABILITY_PLAYED")).toBe(true);
    expect(() => assertMatchStateForSave(match)).not.toThrow();
  });

  it("persists registered mechanics without retriggering on restore", async () => {
    const match = createMatch("mechanic-restore", { opponentAiSkills: [{ definitionId: "owner-load-penalty", enabled: true, parameters: {} }] });
    const openingTriggers = match.history.filter((event) => event.type === "ABILITY_TRIGGERED" && event.ruleId === "opening-draw").length;
    const repository = new MemorySaveRepository({ runtime: createRuntimeSave(match, NOW) });
    const restored = await restoreActiveMatch(repository);
    expect(restored).toEqual(match);
    expect(restored?.history.filter((event) => event.type === "ABILITY_TRIGGERED" && event.ruleId === "opening-draw")).toHaveLength(openingTriggers);
    expect(restored?.abilities.instances).toContainEqual(expect.objectContaining({ definitionId: "owner-load-penalty", owner: "opponent" }));
  });

  it("persists finite TTL and rejects missing, over-budget, or card-retaining expired values", () => {
    const aiRuntime = createRuntimeSave(createMatch("ttl-save", {
      opponentAiSkills: [{ definitionId: "ai-sword-and-handcannon", enabled: true, parameters: {} }]
    }), NOW);
    const aiInstance = aiRuntime.activeMatch.abilities.instances.find((instance) => instance.definitionId === "ai-sword-and-handcannon");
    expect(aiInstance?.ttl).toEqual({ type: "triggers", remaining: 30 });
    expect(validateRuntimeSave(JSON.parse(JSON.stringify(aiRuntime)) as unknown).activeMatch).toEqual(aiRuntime.activeMatch);

    const missing = structuredClone(aiRuntime) as unknown as Record<string, unknown>;
    const missingInstances = (((missing.activeMatch as Record<string, unknown>).abilities as Record<string, unknown>).instances as Array<Record<string, unknown>>);
    delete missingInstances.find((instance) => instance.definitionId === "ai-sword-and-handcannon")!.ttl;
    expect(() => validateRuntimeSave(missing)).toThrow(/TTL does not match/i);

    const overBudget = structuredClone(aiRuntime) as unknown as Record<string, unknown>;
    const overBudgetInstances = (((overBudget.activeMatch as Record<string, unknown>).abilities as Record<string, unknown>).instances as Array<Record<string, unknown>>);
    (overBudgetInstances.find((instance) => instance.definitionId === "ai-sword-and-handcannon")!.ttl as Record<string, unknown>).remaining = 31;
    expect(() => validateRuntimeSave(overBudget)).toThrow(/TTL does not match/i);

    let playerMatch = createMatch("expired-player-card-save", { unlockedPlayerSkillIds: ["sword-and-handcannon"] });
    playerMatch = { ...playerMatch, round: { ...playerMatch.round, phase: "turns", currentActor: "player" }, playerSkills: { ...playerMatch.playerSkills, drawCount: 1 } };
    playerMatch = gameReducer(playerMatch, { type: "OPEN_SKILL_DRAW" });
    playerMatch = gameReducer(playerMatch, { type: "SELECT_SKILL_DRAW", definitionId: "sword-and-handcannon" });
    const expiredCard = structuredClone(createRuntimeSave(playerMatch, NOW)) as unknown as Record<string, unknown>;
    const activeMatch = expiredCard.activeMatch as Record<string, unknown>;
    const playerCards = ((activeMatch.playerSkills as Record<string, unknown>).cards as Array<Record<string, unknown>>);
    const instances = ((activeMatch.abilities as Record<string, unknown>).instances as Array<Record<string, unknown>>);
    const matching = instances.find((instance) => instance.instanceId === playerCards[0]!.instanceId)!;
    (matching.ttl as Record<string, unknown>).remaining = 0;
    expect(() => validateRuntimeSave(expiredCard)).toThrow(/expired Player Skill cannot retain/i);
  });

  it("persists a cross-target, next-action status created by an opponent mechanic", () => {
    const base = createActiveMatch("silent-drizzle-save", {
      opponentId: "texas",
      unlockedPlayerSkillIds: ["hunter-instinct"],
      opponentAiSkills: [{ definitionId: "silent-drizzle", enabled: true, parameters: {} }]
    });
    const player = { ...base.player, hand: createHand([createCard("spades", "10"), createCard("hearts", "6")]), stood: false, busted: false };
    const opponent = { ...base.opponent, hand: createHand([createCard("clubs", "10"), createCard("diamonds", "8")]), stood: false, busted: false };
    const ready = { ...base, player, opponent, round: { ...base.round, phase: "turns" as const, currentActor: "opponent" as const, player, opponent, outcome: null } };
    const silenced = gameReducer(ready, { type: "AI_STAND" });
    expect(silenced.abilities.statuses).toContainEqual(expect.objectContaining({ statusDefinitionId: "silent-drizzle-silenced", owner: "player", duration: "until-owner-action" }));
    expect(validateRuntimeSave(JSON.parse(JSON.stringify(createRuntimeSave(silenced, NOW))) as unknown).activeMatch).toEqual(silenced);
  });

  it("persists derived cards in hands but rejects them inside the physical shoe", () => {
    const base = createMatch("derived-save");
    const player = { ...base.player, hand: addCard(base.player.hand, createDerivedCard("hearts", "5", "derived-save-fixture")) };
    const match = { ...base, player, round: { ...base.round, player } };
    const runtime = createRuntimeSave(match, NOW);
    expect(validateRuntimeSave(JSON.parse(JSON.stringify(runtime)) as unknown).activeMatch.player.hand.cards.at(-1)?.attributes.source).toBe("derived");

    const invalid = JSON.parse(JSON.stringify(runtime)) as Record<string, unknown>;
    const shoe = ((invalid.activeMatch as Record<string, unknown>).shoe as Record<string, unknown>);
    ((((shoe.cards as Array<Record<string, unknown>>)[0]!).attributes) as Record<string, unknown>).source = "derived";
    expect(() => validateRuntimeSave(invalid)).toThrow(/activeMatch.*shoe.*cards/i);
  });
});

describe("boot and repositories", () => {
  it("resetSave returns clean durable data without initially owned Talents", () => {
    const reset = resetSave(NOW);
    expect(reset.schemaVersion).toBe(CURRENT_LONG_TERM_SCHEMA_VERSION);
    expect(reset.profile.matchesPlayed).toBe(0);
    expect(reset.profile.wins).toBe(0);
    expect(unlockedPlayerSkillIdsForDefeats(reset.defeats)).toEqual(["hunter-instinct", "critical-judgment", "situation-assessment", "live-ammunition-bet", "prepaid-premium", "heart-hunter", "switcheroo", "scent-of-a-woman", "compound-interest", "counterclockwise-clock", "sissas-table", "a-single-coin", "mimic-eggplant", "before-the-shuffle", "sleight-of-hand"]);
    expect(reset.profile.selectedSkillTags).toEqual([]);
    expect(reset.history).toEqual([]);
    expect(reset.defeats).toEqual([]);
    expect(reset.skipTutorial).toBe(false);
    expect(reset.tutorialProgress).toEqual({ completedIds: [] });
  });

  it("does not migrate or overwrite an incompatible long-term save before the player chooses", async () => {
    const writes: LongTermSave[] = [];
    const repository = new MemorySaveRepository();
    repository.loadLongTerm = async () => { throw new SaveValidationError("long-term", "outdated long-term save"); };
    repository.saveLongTerm = async (next) => { writes.push(next); };
    await expect(bootLoad(repository, NOW)).rejects.toMatchObject({ kind: "long-term" });
    expect(writes).toEqual([]);
  });

  it("loads long-term data even when only the runtime save is incompatible", async () => {
    const durable = createDefaultSave(NOW);
    const repository = new MemorySaveRepository({ longTerm: durable });
    repository.loadRuntime = async () => { throw new SaveValidationError("runtime", "outdated runtime save"); };
    await expect(bootLoad(repository, NOW)).resolves.toEqual(durable);
    await expect(restoreActiveMatch(repository)).rejects.toMatchObject({ kind: "runtime" });
    expect(await repository.loadLongTerm()).toEqual(durable);
  });

  it("creates durable data on first boot and restores runtime independently", async () => {
    const repository = new MemorySaveRepository();
    const fresh = await bootLoad(repository, NOW);
    expect(fresh.createdAt).toBe(NOW);
    expect(repository.longTermWrites).toHaveLength(1);
    expect(await restoreActiveMatch(repository)).toBeNull();

    const match = createMatch("restore-me");
    await repository.saveRuntime(createRuntimeSave(match, NOW));
    expect(await restoreActiveMatch(repository)).toEqual(match);
    expect(repository.longTermWrites).toHaveLength(1);
    expect(repository.runtimeWrites).toHaveLength(1);
  });

  it("deletes long-term and runtime records independently", async () => {
    const durable = createDefaultSave(NOW);
    const runtime = createRuntimeSave(createMatch("independent-delete"), NOW);
    const repository = new MemorySaveRepository({ longTerm: durable, runtime });

    await repository.deleteRuntime();
    expect(await repository.loadRuntime()).toBeNull();
    expect(await repository.loadLongTerm()).toEqual(durable);

    await repository.saveRuntime(runtime);
    await repository.deleteLongTerm();
    expect(await repository.loadLongTerm()).toBeNull();
    expect(await repository.loadRuntime()).toEqual(runtime);
  });

  it("records only an acknowledged finished match into durable data", () => {
    const save = createDefaultSave(NOW);
    const match = createMatch("ack");
    expect(acknowledgeMatchResult(save, match, NOW)).toBe(save);
    const finished = gameReducer(match, { type: "ESCAPE_MATCH" });
    expect(acknowledgeMatchResult(save, finished, NOW)).toBe(save);
    const acknowledged = gameReducer(finished, { type: "ACK_MATCH_RESULT" });
    const acknowledgedSave = acknowledgeMatchResult(save, acknowledged, NOW);
    expect(acknowledgedSave.history).toHaveLength(1);
    expect(acknowledgedSave.history[0]).toMatchObject({ id: match.id, opponentId: match.opponentId, escaped: true, winner: null, timestamp: NOW });
    expect(acknowledgedSave.defeats).toEqual([]);
  });

  it("atomically records victory progression and does not grant it twice", () => {
    const base = createMatch("character-unlock", { opponentId: "texas" });
    const acknowledged: MatchState = { ...base, status: "finished", scene: "lobby", view: "match-summary", outcome: { winner: "player", reason: "opponent-killed" } };
    const first = acknowledgeMatchResult(createDefaultSave(NOW), acknowledged, NOW);
    expect(first.history).toHaveLength(1);
    expect(first.defeats).toEqual([{ opponentId: "texas", timestamp: NOW }]);
    expect(first.profile.matchesPlayed).toBe(1);
    expect(first.profile.wins).toBe(1);
    expect(unlockedPlayerSkillIdsForDefeats(first.defeats)).toContain("blueberry-and-dark-chocolate");

    const repeated = acknowledgeMatchResult(first, acknowledged, NOW);
    expect(repeated).toBe(first);
  });

  it("clears match history without changing trophies, progression, totals, or tutorial progress", () => {
    const base = createMatch("clear-history", { opponentId: "texas" });
    const acknowledged: MatchState = { ...base, status: "finished", scene: "lobby", view: "match-summary", outcome: { winner: "player", reason: "opponent-killed" } };
    const completed = { ...acknowledgeMatchResult(createDefaultSave(NOW), acknowledged, NOW), skipTutorial: true, tutorialProgress: { completedIds: ["skill-draw-system"] } };
    const cleared = clearMatchHistory(completed, "2026-08-31T00:00:00.000Z");
    expect(cleared.history).toEqual([]);
    expect(cleared.defeats).toEqual(completed.defeats);
    expect(cleared.profile).toEqual(completed.profile);
    expect(cleared.skipTutorial).toBe(true);
    expect(cleared.tutorialProgress).toEqual(completed.tutorialProgress);
    expect(unlockedCharacterIdsForDefeats(cleared.defeats)).toEqual(["w", "irene", "plume", "platinum", "lappland-the-decadenza"]);
    expect(unlockedPlayerSkillIdsForDefeats(cleared.defeats)).toContain("blueberry-and-dark-chocolate");
    expect(cleared.updatedAt).toBe("2026-08-31T00:00:00.000Z");
  });
});

describe("serial autosave", () => {
  it("keeps Switcheroo's physical shoe valid for the synchronous autosave boundary", async () => {
    const base = createMatch("switcheroo-autosave", { unlockedPlayerSkillIds: ["switcheroo"] });
    const instanceId = "switcheroo-autosave-card";
    const card = { kind: "player-skill" as const, definitionId: "switcheroo", owner: "player" as const, instanceId };
    const sequence = base.abilities.sequence + 1;
    const match: MatchState = {
      ...base,
      playerSkills: { ...base.playerSkills, cards: [card] },
      abilities: { ...base.abilities, instances: [...base.abilities.instances, { ...card, createdAtSequence: sequence, parameters: {} }], sequence },
      round: { ...base.round, phase: "turns", currentActor: "player", outcome: null }
    };
    const outgoing = match.player.hand.cards.at(-1)!;
    const incoming = match.shoe.cards[match.shoe.cursor]!;
    const repository = new MemorySaveRepository();
    const controller = createAutosaveController(repository, createDefaultSave(NOW), match, { now: () => NOW });

    expect(() => controller.dispatch({ type: "PLAY_ABILITY", instanceId })).not.toThrow();
    await controller.flush();

    const saved = repository.runtimeWrites.at(-1)!.activeMatch;
    expect(saved.player.hand.cards.at(-1)?.id).toBe(incoming.id);
    expect(saved.shoe.cards[saved.shoe.cursor]?.id).toBe(outgoing.id);
    expect(new Set(saved.shoe.cards.map((entry) => entry.id)).size).toBe(saved.shoe.cards.length);
    expect(saved.history).toContainEqual(expect.objectContaining({ type: "ABILITY_PLAYED", definitionId: "switcheroo" }));
  });

  class DelayedRepository implements SaveRepository {
    longTerm: LongTermSave | null = null;
    runtime: RuntimeSave | null = null;
    readonly runtimeWrites: RuntimeSave[] = [];
    readonly commits: LongTermSave[] = [];
    private sequence = Promise.resolve();

    async loadLongTerm(): Promise<LongTermSave | null> { return this.longTerm; }
    async saveLongTerm(save: LongTermSave): Promise<void> { this.longTerm = save; }
    async deleteLongTerm(): Promise<void> { this.longTerm = null; }
    async loadRuntime(): Promise<RuntimeSave | null> { return this.runtime; }
    async deleteRuntime(): Promise<void> { this.runtime = null; }
    async saveRuntime(save: RuntimeSave): Promise<void> {
      this.sequence = this.sequence.then(async () => {
        await new Promise((resolve) => setTimeout(resolve, 2));
        this.runtime = save;
        this.runtimeWrites.push(save);
      });
      return this.sequence;
    }
    async commitMatchResult(save: LongTermSave): Promise<void> {
      this.sequence = this.sequence.then(async () => {
        await new Promise((resolve) => setTimeout(resolve, 2));
        this.longTerm = save;
        this.runtime = null;
        this.commits.push(save);
      });
      return this.sequence;
    }
  }

  it("serializes runtime snapshots, then commits durable results and removes runtime", async () => {
    const repository = new DelayedRepository();
    const controller = createAutosaveController(repository, createDefaultSave(NOW), createMatch("autosave"), { now: () => NOW });
    controller.dispatch({ type: "ESCAPE_MATCH" });
    controller.dispatch({ type: "ACK_MATCH_RESULT" });
    await controller.flush();
    expect(repository.runtimeWrites).toHaveLength(2);
    expect(repository.runtimeWrites[0]!.activeMatch.status).toBe("active");
    expect(repository.runtimeWrites[1]!.activeMatch.status).toBe("finished");
    expect(repository.runtimeWrites[1]!.activeMatch.scene).toBe("match");
    expect(repository.commits).toHaveLength(1);
    expect(repository.commits[0]!.profile.matchesPlayed).toBe(1);
    expect(repository.runtime).toBeNull();
    expect(controller.getSave().profile.matchesPlayed).toBe(1);
  });

  it("serializes tutorial progress with runtime writes and preserves it in the final commit", async () => {
    const repository = new DelayedRepository();
    const initial = createDefaultSave(NOW);
    const controller = createAutosaveController(repository, initial, createMatch("tutorial-autosave"), { now: () => NOW });
    controller.updateSave({ ...initial, tutorialProgress: { completedIds: ["skill-draw-system"] } });
    controller.dispatch({ type: "ESCAPE_MATCH" });
    controller.dispatch({ type: "ACK_MATCH_RESULT" });
    await controller.flush();
    expect(repository.commits[0]?.tutorialProgress.completedIds).toEqual(["skill-draw-system"]);
    expect(controller.getSave().tutorialProgress.completedIds).toEqual(["skill-draw-system"]);
  });
});

describe("import and storage capabilities", () => {
  it("turns malformed or runtime JSON into a clear long-term import error", async () => {
    await expect(importSave("{ definitely not json")).rejects.toThrow(/Invalid save JSON/);
    await expect(importSave(JSON.stringify({ schemaVersion: 99 }))).rejects.toMatchObject({ kind: "long-term" });
    await expect(importSave(JSON.stringify(createRuntimeSave(createMatch("runtime-import"), NOW)))).rejects.toMatchObject({ kind: "long-term" });
  });

  it("treats persistent storage as best effort", async () => {
    expect(await requestPersistentStorage()).toBe(false);
  });
});
