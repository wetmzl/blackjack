import Dexie, { type Table } from "dexie";
import { validateLongTermSave, validateRuntimeSave, type LongTermSave, type RuntimeSave } from "./schema";
import type { SaveRepository } from "./repository";

type SaveRecordId = "long-term" | "runtime" | "current";
interface SaveRecord { readonly id: SaveRecordId; readonly data: unknown; }

export class IndexedDbSaveRepository implements SaveRepository {
  private readonly db: DexieDatabase;

  constructor(databaseName = "house-of-chances") { this.db = new DexieDatabase(databaseName); }

  async loadLongTerm(): Promise<LongTermSave | null> {
    const record = await this.db.saves.get("long-term") ?? await this.db.saves.get("current");
    return record ? validateLongTermSave(record.data) : null;
  }

  async saveLongTerm(save: LongTermSave): Promise<void> {
    await this.db.saves.put({ id: "long-term", data: validateLongTermSave(save) });
  }

  async deleteLongTerm(): Promise<void> { await this.db.saves.bulkDelete(["long-term", "current"]); }

  async loadRuntime(): Promise<RuntimeSave | null> {
    const record = await this.db.saves.get("runtime");
    return record ? validateRuntimeSave(record.data) : null;
  }

  async saveRuntime(save: RuntimeSave): Promise<void> {
    await this.db.saves.put({ id: "runtime", data: validateRuntimeSave(save) });
  }

  async deleteRuntime(): Promise<void> { await this.db.saves.delete("runtime"); }

  async commitMatchResult(save: LongTermSave): Promise<void> {
    const valid = validateLongTermSave(save);
    await this.db.transaction("rw", this.db.saves, async () => {
      await this.db.saves.put({ id: "long-term", data: valid });
      await this.db.saves.delete("runtime");
    });
  }

  async close(): Promise<void> { this.db.close(); }
}

class DexieDatabase extends Dexie {
  saves!: Table<SaveRecord, SaveRecordId>;

  constructor(databaseName: string) {
    super(databaseName);
    this.version(1).stores({ saves: "id" });
  }
}
