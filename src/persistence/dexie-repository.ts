import Dexie, { type Table } from "dexie";
import { validateSave, type SaveFile } from "./schema";
import type { SaveRepository } from "./repository";

interface SaveRecord { readonly id: "current"; readonly data: unknown; }

export class IndexedDbSaveRepository implements SaveRepository {
  private readonly db: DexieDatabase;

  constructor(databaseName = "house-of-chances") { this.db = new DexieDatabase(databaseName); }

  async load(): Promise<SaveFile | null> {
    const record = await this.db.saves.get("current");
    return record ? validateSave(record.data) : null;
  }

  async save(save: SaveFile): Promise<void> {
    const valid = validateSave(save);
    await this.db.saves.put({ id: "current", data: valid });
  }

  async close(): Promise<void> { this.db.close(); }
}

class DexieDatabase extends Dexie {
  saves!: Table<SaveRecord, "current">;

  constructor(databaseName: string) {
    super(databaseName);
    this.version(1).stores({ saves: "id" });
  }
}
