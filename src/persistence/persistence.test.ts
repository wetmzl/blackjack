import { describe, expect, it } from "vitest";
import { createMatch, gameReducer } from "../core/match/reducer";
import { bootLoad, acknowledgeMatchResult, createDefaultSave, resetSave, restoreActiveMatch, saveActiveMatch } from "./boot";
import { createAutosaveController } from "./autosave";
import { exportRawSaveJson, exportSaveJson, importSave } from "./json";
import { MemorySaveRepository } from "./memory-repository";
import { CURRENT_SCHEMA_VERSION, SaveValidationError, validateAndMigrateSave, type SaveFile } from "./schema";
import type { SaveRepository } from "./repository";
import { requestPersistentStorage } from "./storage";

const NOW = "2026-08-30T00:00:00.000Z";

describe("SaveFile schema, validation, and migration", () => {
  it("round-trips a default save and an active MatchState through JSON", async () => {
    const save = saveActiveMatch(createDefaultSave(NOW), createMatch("save-roundtrip"), NOW);
    const imported = await importSave(exportSaveJson(save));
    expect(imported).toEqual(save);
    expect(imported.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(imported.activeMatch?.rng.deck).toEqual(save.activeMatch?.rng.deck);
    expect(imported.history).toEqual([]);
  });

  it("rejects obsolete v1 saves instead of attempting unsafe migration", () => {
    const current = createDefaultSave(NOW);
    const { history: _history, ...v1 } = current;
    expect(() => validateAndMigrateSave({ ...v1, schemaVersion: 1 })).toThrow(/Unsupported old save schema version/);
  });

  it("rejects malformed nested cards, RNG, guns, and unknown fields", () => {
    const save = createDefaultSave(NOW);
    const invalid = JSON.parse(JSON.stringify(save)) as Record<string, unknown>;
    (invalid.profile as Record<string, unknown>).unexpected = true;
    expect(() => validateAndMigrateSave(invalid)).toThrow(SaveValidationError);

    const withMatch = JSON.parse(JSON.stringify(saveActiveMatch(save, createMatch("invalid-match"), NOW))) as Record<string, unknown>;
    const match = withMatch.activeMatch as Record<string, unknown>;
    const player = match.player as Record<string, unknown>;
    const hand = player.hand as Record<string, unknown>;
    (hand.cards as Array<Record<string, unknown>>)[0].rank = "JOKER";
    expect(() => validateAndMigrateSave(withMatch)).toThrow(/activeMatch/);

    const invalidRng = JSON.parse(JSON.stringify(saveActiveMatch(save, createMatch("invalid-rng"), NOW))) as Record<string, unknown>;
    (((invalidRng.activeMatch as Record<string, unknown>).rng as Record<string, unknown>).ai as Record<string, unknown>).state = -1;
    expect(() => validateAndMigrateSave(invalidRng)).toThrow(SaveValidationError);

    const invalidShoe = JSON.parse(JSON.stringify(saveActiveMatch(save, createMatch("invalid-shoe"), NOW))) as Record<string, unknown>;
    const shoe = (invalidShoe.activeMatch as Record<string, unknown>).shoe as Record<string, unknown>;
    shoe.cursor = (shoe.cards as unknown[]).length + 1;
    expect(() => validateAndMigrateSave(invalidShoe)).toThrow(/cursor cannot exceed cards length/);
  });

  it("rejects unknown, old, and future schema versions clearly", () => {
    const save = createDefaultSave(NOW);
    expect(() => validateAndMigrateSave({ ...save, schemaVersion: CURRENT_SCHEMA_VERSION + 1 })).toThrow(/future save schema version/);
    expect(() => validateAndMigrateSave({ ...save, schemaVersion: 0 })).toThrow(/Unsupported (old )?save schema version/);
    expect(() => validateAndMigrateSave({ ...save, format: "other-game" })).toThrow(SaveValidationError);
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

  it("repository loadRaw preserves the persisted record and raw JSON does not validate it", async () => {
    const original = createDefaultSave(NOW);
    const repository = new MemorySaveRepository(original);
    const raw = await repository.loadRaw();
    expect(raw).toEqual(original);
    const marked = { marker: "raw-invalid-record", payload: raw };
    expect(exportRawSaveJson(marked)).toContain("raw-invalid-record");
    const circular: Record<string, unknown> = {}; circular.self = circular;
    expect(() => exportRawSaveJson(circular)).toThrow(/无法序列化/);
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
    async loadRaw(): Promise<unknown | null> { return null; }
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
