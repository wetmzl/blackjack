import type { SaveFile } from "./schema";

export interface SaveRepository {
  load(): Promise<SaveFile | null>;
  save(save: SaveFile): Promise<void>;
}
