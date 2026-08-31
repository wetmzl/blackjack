import type { Action, MatchState } from "../core/match/types";
import { gameReducer } from "../core/match/reducer";
import { acknowledgeMatchResult, saveActiveMatch } from "./boot";
import type { SaveFile } from "./schema";
import type { SaveRepository } from "./repository";

export interface AutosaveController {
  dispatch(action: Action): MatchState;
  flush(): Promise<void>;
  getState(): MatchState;
  getSave(): SaveFile;
}

export interface AutosaveOptions {
  readonly now?: () => string;
}

/** Dispatches through the pure reducer and serializes each resulting domain state in order. */
export function createAutosaveController(repository: SaveRepository, save: SaveFile, initialMatch: MatchState, options: AutosaveOptions = {}): AutosaveController {
  const now = options.now ?? (() => new Date().toISOString());
  let state = initialMatch;
  let currentSave = saveActiveMatch(save, state, now());
  const initialSnapshot = currentSave;
  let queue: Promise<void> = Promise.resolve().then(() => repository.save(initialSnapshot));

  const dispatch = (action: Action): MatchState => {
    const next = gameReducer(state, action);
    if (next === state) return state;
    state = next;
    const nextSave = saveActiveMatch(currentSave, next, now());
    currentSave = next.status === "finished" && next.scene === "lobby"
      ? acknowledgeMatchResult(nextSave, now())
      : nextSave;
    const snapshot = currentSave;
    queue = queue.catch(() => undefined).then(() => repository.save(snapshot));
    return state;
  };

  return { dispatch, flush: () => queue, getState: () => state, getSave: () => currentSave };
}
