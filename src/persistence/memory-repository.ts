import { validateAndMigrateSave, type SaveFile } from "./schema";
import type { SaveRepository } from "./repository";

function copy(save: SaveFile): SaveFile {
  return validateAndMigrateSave(JSON.parse(JSON.stringify(save)) as unknown);
}

/** In-memory implementation used by tests and lightweight host integrations. */
export class MemorySaveRepository implements SaveRepository {
  private current: SaveFile | null;
  private rawCurrent: unknown;
  readonly writes: SaveFile[] = [];

  constructor(initial: SaveFile | null = null) { this.current = initial ? copy(initial) : null; this.rawCurrent = this.current ? JSON.parse(JSON.stringify(this.current)) as unknown : null; }

  async load(): Promise<SaveFile | null> { return this.current ? copy(this.current) : null; }

  async loadRaw(): Promise<unknown | null> { return this.rawCurrent == null ? null : JSON.parse(JSON.stringify(this.rawCurrent)) as unknown; }

  async save(save: SaveFile): Promise<void> {
    const valid = copy(save);
    this.current = valid;
    this.rawCurrent = JSON.parse(JSON.stringify(valid)) as unknown;
    this.writes.push(copy(valid));
  }
}
