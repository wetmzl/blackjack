import type { MatchState } from "../core/match/types";
import { summarizeMatch } from "../core/match/history";
import { assertMatchStateForSave, CURRENT_GAME_VERSION, CURRENT_SCHEMA_VERSION, SAVE_FORMAT, type GameSettings, type PlayerProfile, type SaveFile } from "./schema";
import { INITIAL_SKILL_IDS } from "../core/skills/definitions";
import { addUnlockedSkills } from "../core/skills/skills";
import type { SaveRepository } from "./repository";
import { unlockedCharacterIdsForHistory } from "../content/characters/unlocks";

export function createDefaultSave(now = new Date().toISOString()): SaveFile {
  const profile: PlayerProfile = { id: "player", displayName: "博士", matchesPlayed: 0, wins: 0, unlockedCharacterIds: [...unlockedCharacterIdsForHistory([])], unlockedSkillIds: [...INITIAL_SKILL_IDS], equippedSkillIds: [...INITIAL_SKILL_IDS] };
  const settings: GameSettings = { soundEnabled: true, reducedMotion: false };
  return { format: SAVE_FORMAT, schemaVersion: CURRENT_SCHEMA_VERSION, gameVersion: CURRENT_GAME_VERSION, createdAt: now, updatedAt: now, profile, activeMatch: null, settings, history: [] };
}

/** Explicit, recoverable boundary helper used by the dangerous reset action. */
export function resetSave(now = new Date().toISOString()): SaveFile { return createDefaultSave(now); }

export async function bootLoad(repository: SaveRepository, now = new Date().toISOString()): Promise<SaveFile> {
  const existing = await repository.load();
  if (existing) return existing;
  const fresh = createDefaultSave(now);
  await repository.save(fresh);
  return fresh;
}

export function restoreActiveMatch(save: SaveFile): MatchState | null { return save.activeMatch; }

export function saveActiveMatch(save: SaveFile, match: MatchState, now = new Date().toISOString()): SaveFile {
  assertMatchStateForSave(match);
  return { ...save, activeMatch: match, updatedAt: now };
}

/** Only an acknowledged finished summary clears the active match. */
export function acknowledgeMatchResult(save: SaveFile, now = new Date().toISOString()): SaveFile {
  const match = save.activeMatch;
  if (!match || match.status !== "finished" || match.scene !== "lobby") return save;
  const record = summarizeMatch(match, now);
  if (save.history.some((entry) => entry.id === record.id)) {
    return { ...save, activeMatch: null, updatedAt: now };
  }
  const history = [...save.history, record];
  const won = record.winner === "player" && !record.escaped;
  const profile: PlayerProfile = {
    ...save.profile,
    matchesPlayed: save.profile.matchesPlayed + 1,
    wins: save.profile.wins + (won ? 1 : 0),
    unlockedCharacterIds: [...unlockedCharacterIdsForHistory(history)],
    unlockedSkillIds: addUnlockedSkills(save.profile.unlockedSkillIds, record.opponentId, record.winner, record.escaped)
  };
  return { ...save, activeMatch: null, profile, history, updatedAt: now };
}
