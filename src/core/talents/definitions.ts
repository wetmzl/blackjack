import { TALENT_ABILITY_DEFINITIONS } from "../abilities/registry";

export const TALENT_DEFINITIONS = TALENT_ABILITY_DEFINITIONS;
export const INITIAL_TALENT_IDS = Object.freeze(TALENT_DEFINITIONS.filter((talent) => !talent.hidden).map((talent) => talent.id));
export function getTalentDefinition(id: string) { return TALENT_DEFINITIONS.find((talent) => talent.id === id); }
