import type { LongTermSave, RuntimeSave } from "./schema";

export interface SaveRepository {
  loadLongTerm(): Promise<LongTermSave | null>;
  saveLongTerm(save: LongTermSave): Promise<void>;
  deleteLongTerm(): Promise<void>;
  loadRuntime(): Promise<RuntimeSave | null>;
  saveRuntime(save: RuntimeSave): Promise<void>;
  deleteRuntime(): Promise<void>;
  /** Persists durable result data and removes the completed runtime match atomically. */
  commitMatchResult(save: LongTermSave): Promise<void>;
}
