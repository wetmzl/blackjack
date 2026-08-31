import { validateAndMigrateSave, type SaveFile } from "./schema";
import type { SaveRepository } from "./repository";

function copy(save: SaveFile): SaveFile {
  return validateAndMigrateSave(JSON.parse(JSON.stringify(save)) as unknown);
}

/** In-memory implementation used by tests and lightweight host integrations. */
export class MemorySaveRepository implements SaveRepository {
  private current: SaveFile | null;
  readonly writes: SaveFile[] = [];

  constructor(initial: SaveFile | null = null) { this.current = initial ? copy(initial) : null; }

  async load(): Promise<SaveFile | null> { return this.current ? copy(this.current) : null; }

  async save(save: SaveFile): Promise<void> {
    const valid = copy(save);
    this.current = valid;
    this.writes.push(copy(valid));
  }
}
