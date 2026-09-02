import { describe, expect, it } from "vitest";
import { createMatch, gameReducer, getLegalActions } from "../core/match/reducer";
import { bootLoad, acknowledgeMatchResult, createDefaultSave, resetSave, restoreActiveMatch, saveActiveMatch } from "./boot";
import { createAutosaveController } from "./autosave";
import { exportSaveJson, importSave } from "./json";
import { MemorySaveRepository } from "./memory-repository";
import { assertMatchStateForSave, CURRENT_SCHEMA_VERSION, SaveValidationError, validateSave, type SaveFile } from "./schema";
import type { SaveRepository } from "./repository";
import { requestPersistentStorage } from "./storage";
import { createCard, createDerivedCard } from "../core/blackjack/card";
import { addCard, createHand } from "../core/blackjack/hand";

const NOW = "2026-08-30T00:00:00.000Z";

describe("current SaveFile schema and validation", () => {
  it("round-trips a default save and an active MatchState through JSON", async () => {
    const save = saveActiveMatch(createDefaultSave(NOW), createMatch("save-roundtrip"), NOW);
    const imported = await importSave(exportSaveJson(save));
    expect(imported).toEqual(save);
    expect(imported.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(imported.activeMatch?.rng.deck).toEqual(save.activeMatch?.rng.deck);
    expect(imported.history).toEqual([]);
  });

  it("round-trips the suit-only private-card reveal event", async () => {
    const match = createMatch("suit-event-roundtrip");
    const withReveal = { ...match, history: [...match.history, { type: "CARD_SUIT_REVEALED" as const, viewer: "player" as const, target: "opponent" as const, cardIndex: 1, suit: "hearts" as const }] };
    const save = saveActiveMatch(createDefaultSave(NOW), withReveal, NOW);
    const imported = await importSave(exportSaveJson(save));
    expect(imported.activeMatch?.history.at(-1)).toEqual(withReveal.history.at(-1));
  });

  it("rejects malformed nested cards, RNG, guns, and unknown fields", () => {
    const save = createDefaultSave(NOW);
    const invalid = JSON.parse(JSON.stringify(save)) as Record<string, unknown>;
    (invalid.profile as Record<string, unknown>).unexpected = true;
    expect(() => validateSave(invalid)).toThrow(SaveValidationError);

    const withMatch = JSON.parse(JSON.stringify(saveActiveMatch(save, createMatch("invalid-match"), NOW))) as Record<string, unknown>;
    const match = withMatch.activeMatch as Record<string, unknown>;
    const player = match.player as Record<string, unknown>;
    const hand = player.hand as Record<string, unknown>;
    (hand.cards as Array<Record<string, unknown>>)[0].rank = "JOKER";
    expect(() => validateSave(withMatch)).toThrow(/activeMatch/);

    const invalidRng = JSON.parse(JSON.stringify(saveActiveMatch(save, createMatch("invalid-rng"), NOW))) as Record<string, unknown>;
    (((invalidRng.activeMatch as Record<string, unknown>).rng as Record<string, unknown>).ai as Record<string, unknown>).state = -1;
    expect(() => validateSave(invalidRng)).toThrow(SaveValidationError);

    const invalidShoe = JSON.parse(JSON.stringify(saveActiveMatch(save, createMatch("invalid-shoe"), NOW))) as Record<string, unknown>;
    const shoe = (invalidShoe.activeMatch as Record<string, unknown>).shoe as Record<string, unknown>;
    shoe.cursor = (shoe.cards as unknown[]).length + 1;
    expect(() => validateSave(invalidShoe)).toThrow(/cursor cannot exceed cards length/);
  });

  it("accepts only the current schema version and format", () => {
    const save = createDefaultSave(NOW);
    expect(() => validateSave({ ...save, schemaVersion: CURRENT_SCHEMA_VERSION + 1 })).toThrow(/schemaVersion/);
    expect(() => validateSave({ ...save, schemaVersion: 0 })).toThrow(/schemaVersion/);
    expect(() => validateSave({ ...save, format: "other-game" })).toThrow(SaveValidationError);
  });

  it("rejects missing ability definitions and catalog mismatches with locating save errors", () => {
    const saved = JSON.parse(exportSaveJson(saveActiveMatch(createDefaultSave(NOW), createMatch("ability-save-errors"), NOW))) as Record<string, unknown>;
    const missing = structuredClone(saved);
    const missingRuntime = ((missing.activeMatch as Record<string, unknown>).abilities as Record<string, unknown>);
    ((missingRuntime.instances as Array<Record<string, unknown>>)[0]!).definitionId = "missing-definition";
    expect(() => validateSave(missing)).toThrow(/activeMatch.*abilities.*instances|unknown ability definition/i);

    const mismatch = structuredClone(saved);
    (((mismatch.activeMatch as Record<string, unknown>).abilities as Record<string, unknown>).catalogVersion) = "abilities-v999";
    expect(() => validateSave(mismatch)).toThrow(/catalogVersion.*unsupported ability catalog version/i);
  });

  it("rejects character IDs outside the current catalog", () => {
    const saved = JSON.parse(exportSaveJson(saveActiveMatch(createDefaultSave(NOW), createMatch("unknown-character"), NOW))) as Record<string, unknown>;
    (saved.activeMatch as Record<string, unknown>).opponentId = "retired-character";
    expect(() => validateSave(saved)).toThrow(/activeMatch.*opponentId.*unknown character/i);
  });

  it("keeps an active save valid after consuming a concrete ability card", () => {
    let match = createMatch("post-ability-save");
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

  it("round-trips registered character mechanics and does not retrigger on-match-created on restore", async () => {
    const match = createMatch("mechanic-restore", { opponentMechanics: [{ definitionId: "owner-load-penalty", enabled: true, parameters: {} }] });
    const openingTriggers = match.history.filter((event) => event.type === "ABILITY_TRIGGERED" && event.ruleId === "opening-draw").length;
    const save = saveActiveMatch(createDefaultSave(NOW), match, NOW);
    const restored = restoreActiveMatch(await importSave(exportSaveJson(save)));
    expect(restored).toEqual(match);
    expect(restored?.history.filter((event) => event.type === "ABILITY_TRIGGERED" && event.ruleId === "opening-draw")).toHaveLength(openingTriggers);
    expect(restored?.abilities.instances).toContainEqual(expect.objectContaining({ definitionId: "owner-load-penalty", owner: "opponent" }));
  });

  it("persists a cross-target, next-action status created by an opponent mechanic", async () => {
    const base = createMatch("silent-drizzle-save", {
      opponentId: "texas",
      equippedSkillIds: ["hunter-instinct"],
      opponentMechanics: [{ definitionId: "silent-drizzle", enabled: true, parameters: {} }]
    });
    const player = { ...base.player, hand: createHand([createCard("spades", "10"), createCard("hearts", "6")]), stood: false, busted: false };
    const opponent = { ...base.opponent, hand: createHand([createCard("clubs", "10"), createCard("diamonds", "8")]), stood: false, busted: false };
    const ready = { ...base, player, opponent, round: { ...base.round, phase: "turns" as const, currentActor: "opponent" as const, player, opponent, outcome: null } };
    const silenced = gameReducer(ready, { type: "AI_STAND" });
    expect(silenced.abilities.statuses).toContainEqual(expect.objectContaining({ statusDefinitionId: "silent-drizzle-silenced", owner: "player", duration: "until-owner-action" }));

    const save = saveActiveMatch(createDefaultSave(NOW), silenced, NOW);
    expect((await importSave(exportSaveJson(save))).activeMatch).toEqual(silenced);
  });

  it("persists derived cards in hands but rejects them inside the physical shoe", () => {
    const base = createMatch("derived-save");
    const player = { ...base.player, hand: addCard(base.player.hand, createDerivedCard("hearts", "5")) };
    const match = { ...base, player, round: { ...base.round, player } };
    const save = saveActiveMatch(createDefaultSave(NOW), match, NOW);
    expect(validateSave(JSON.parse(exportSaveJson(save)) as unknown).activeMatch?.player.hand.cards.at(-1)?.origin).toBe("derived");

    const invalid = JSON.parse(exportSaveJson(save)) as Record<string, unknown>;
    const shoe = ((invalid.activeMatch as Record<string, unknown>).shoe as Record<string, unknown>);
    ((shoe.cards as Array<Record<string, unknown>>)[0]!).origin = "derived";
    expect(() => validateSave(invalid)).toThrow(/activeMatch.*shoe.*cards/i);
  });
});

describe("boot and repositories", () => {
  it("resetSave returns a clean current-schema profile with initial loadout", () => {
    const reset = resetSave(NOW);
    expect(reset.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(reset.profile.matchesPlayed).toBe(0);
    expect(reset.profile.wins).toBe(0);
    expect(reset.profile.unlockedSkillIds).toEqual(reset.profile.equippedSkillIds);
    expect(reset.activeMatch).toBeNull();
    expect(reset.history).toEqual([]);
  });

  it("does not migrate an incompatible stored save", async () => {
    const writes: SaveFile[] = [];
    const repository: SaveRepository = {
      load: async () => { throw new SaveValidationError("outdated save"); },
      save: async (next) => { writes.push(next); }
    };
    await expect(bootLoad(repository, NOW)).rejects.toThrow(SaveValidationError);
    expect(writes).toEqual([]);
  });
  it("creates and persists a default save on first boot, then restores active match", async () => {
    const repository = new MemorySaveRepository();
    const fresh = await bootLoad(repository, NOW);
    expect(fresh.activeMatch).toBeNull();
    expect(fresh.createdAt).toBe(NOW);
    expect(repository.writes).toHaveLength(1);

    const match = createMatch("restore-me");
    await repository.save(saveActiveMatch(fresh, match, NOW));
    const restored = await bootLoad(repository, NOW);
    expect(restoreActiveMatch(restored)).toEqual(match);
    expect(repository.writes).toHaveLength(2);
  });

  it("clears activeMatch only after finished summary acknowledgement", () => {
    const save = createDefaultSave(NOW);
    const match = createMatch("ack");
    expect(acknowledgeMatchResult(saveActiveMatch(save, match, NOW), NOW).activeMatch).not.toBeNull();
    const finished = gameReducer(match, { type: "ESCAPE_MATCH" });
    const acknowledged = gameReducer(finished, { type: "ACK_MATCH_RESULT" });
    const summary = saveActiveMatch(save, acknowledged, NOW);
    const acknowledgedSave = acknowledgeMatchResult(summary, NOW);
    expect(acknowledgedSave.activeMatch).toBeNull();
    expect(acknowledgedSave.history).toHaveLength(1);
    expect(acknowledgedSave.history[0]).toMatchObject({ id: match.id, opponentId: match.opponentId, escaped: true, winner: null, timestamp: NOW });
  });
});

describe("serial autosave", () => {
  class DelayedRepository implements SaveRepository {
    readonly writes: SaveFile[] = [];
    private sequence = Promise.resolve();
    async load(): Promise<SaveFile | null> { return null; }
    async save(save: SaveFile): Promise<void> {
      const snapshot = save;
      this.sequence = this.sequence.then(async () => {
        await new Promise((resolve) => setTimeout(resolve, 2));
        this.writes.push(snapshot);
      });
      return this.sequence;
    }
  }

  it("serializes snapshots and never allows an older state to finish last", async () => {
    const repository = new DelayedRepository();
    const controller = createAutosaveController(repository, createDefaultSave(NOW), createMatch("autosave"), { now: () => NOW });
    controller.dispatch({ type: "ESCAPE_MATCH" });
    controller.dispatch({ type: "ACK_MATCH_RESULT" });
    await controller.flush();
    expect(repository.writes).toHaveLength(3);
    expect(repository.writes[0].activeMatch?.status).toBe("active");
    expect(repository.writes[0].activeMatch?.scene).toBe("match");
    expect(repository.writes[1].activeMatch?.status).toBe("finished");
    expect(repository.writes[1].activeMatch?.scene).toBe("match");
    expect(repository.writes[2].activeMatch).toBeNull();
    expect(controller.getSave().activeMatch).toBeNull();
  });
});

describe("import and storage capabilities", () => {
  it("turns malformed JSON into a clear import error", async () => {
    await expect(importSave("{ definitely not json")).rejects.toThrow(/Invalid save JSON/);
    await expect(importSave(JSON.stringify({ schemaVersion: 99 }))).rejects.toThrow(SaveValidationError);
  });

  it("treats persistent storage as best effort", async () => {
    expect(await requestPersistentStorage()).toBe(false);
  });
});
