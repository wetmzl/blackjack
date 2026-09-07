import { TALENT_ABILITY_DEFINITIONS } from "../abilities/registry";
import type { CharacterDefeatRecord } from "../progression/defeats";

export const TALENT_DEFINITIONS = TALENT_ABILITY_DEFINITIONS;
export function getTalentDefinition(id: string) { return TALENT_DEFINITIONS.find((talent) => talent.id === id); }
export function unlockedTalentIdsForDefeats(defeats: readonly CharacterDefeatRecord[]): string[] {
  const defeatCount = new Set(defeats.map((record) => record.opponentId)).size;
  return TALENT_DEFINITIONS.filter((talent) => !talent.hidden && defeatCount >= talent.unlock.count).map((talent) => talent.id);
}
