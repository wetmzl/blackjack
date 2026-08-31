import type { SaveFile } from "./schema";

export interface SaveRepository {
  load(): Promise<SaveFile | null>;
  /** Returns the persisted record without schema parsing, for recovery only. */
  loadRaw(): Promise<unknown | null>;
  save(save: SaveFile): Promise<void>;
}
