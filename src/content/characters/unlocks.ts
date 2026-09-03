import type { MatchHistoryRecord } from "../../core/match/history";
import { CHARACTER_CATALOG, characterHasTag, getCharacterMetadata } from "./catalog";
import type { CharacterMetadata, CharacterUnlockCondition } from "./types";

type DefeatHistoryEntry = Pick<MatchHistoryRecord, "opponentId" | "winner" | "escaped">;
type TimestampedDefeatHistoryEntry = DefeatHistoryEntry & Pick<MatchHistoryRecord, "timestamp">;

/** A defeated attendee is a completed, non-escaped match won by the curator. */
export function defeatedCharacterIds(history: readonly DefeatHistoryEntry[]): ReadonlySet<string> {
  return new Set(history.filter((record) => record.winner === "player" && !record.escaped).map((record) => record.opponentId));
}

function conditionMet(condition: CharacterUnlockCondition, history: readonly DefeatHistoryEntry[]): boolean {
  const defeated = defeatedCharacterIds(history);
  switch (condition.type) {
    case "defeat-any":
      return defeated.size > 0;
    case "defeat-character":
      return defeated.has(condition.characterId);
    case "defeat-any-tag":
      return CHARACTER_CATALOG.some((character) => characterHasTag(character, condition.tag) && defeated.has(character.id));
    case "defeat-tag-percentage": {
      const tagged = CHARACTER_CATALOG.filter((character) => characterHasTag(character, condition.tag));
      if (tagged.length === 0) return false;
      const taggedDefeated = tagged.filter((character) => defeated.has(character.id)).length;
      return taggedDefeated / tagged.length >= condition.percentage / 100;
    }
  }
}

export function isCharacterUnlocked(character: CharacterMetadata, history: readonly DefeatHistoryEntry[]): boolean {
  return !character.unlock || conditionMet(character.unlock, history);
}

/** Computes the canonical set of unlocked attendees from the completed-match history. */
export function unlockedCharacterIdsForHistory(history: readonly DefeatHistoryEntry[]): readonly string[] {
  return CHARACTER_CATALOG.filter((character) => isCharacterUnlocked(character, history)).map((character) => character.id);
}

export function newlyUnlockedCharacterIds(
  before: readonly DefeatHistoryEntry[],
  after: readonly DefeatHistoryEntry[]
): readonly string[] {
  const previous = new Set(unlockedCharacterIdsForHistory(before));
  return unlockedCharacterIdsForHistory(after).filter((id) => !previous.has(id));
}

export function newlyUnlockedForVictory(history: readonly DefeatHistoryEntry[], opponentId: string): readonly string[] {
  const projected = [...history, { opponentId, winner: "player" as const, escaped: false }];
  return newlyUnlockedCharacterIds(history, projected);
}

/** First-victory order used by the lobby's defeated-attendee collection. */
export function defeatedCharacterIdsByFirstVictory(history: readonly TimestampedDefeatHistoryEntry[]): readonly string[] {
  const seen = new Set<string>();
  return [...history]
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
    .filter((record) => record.winner === "player" && !record.escaped)
    .map((record) => record.opponentId)
    .filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .filter((id) => Boolean(getCharacterMetadata(id)));
}
