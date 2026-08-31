import type { AiProfile } from "../../core/ai/types";
import type { CharacterDialogue } from "../../dialogue/types";

export type Tier = "D" | "C" | "B" | "A" | "S";

/** The only character data needed to build the lobby, profile, and history index. */
export interface CharacterMetadata {
  readonly id: string;
  readonly name: string;
  readonly subtitle: string;
  readonly tier: Tier;
  readonly description: string;
  readonly previewImage: string;
  readonly trophyImage: string;
  readonly dataFile: string;
}

export interface CharacterAssets {
  readonly relaxed: string;
  readonly conflicted: string;
  readonly mocking: string;
  readonly threatened: string;
  readonly staffRevolver: string;
  readonly unconscious: string;
  readonly defeatedSummary: string;
}

export interface RevolverPlacement {
  readonly top: number;
  readonly left: number;
  readonly mobileTop: number;
  readonly mobileLeft: number;
}

/** Fixed W art reference: 1536×1024 source canvas and scale 1 normal sitting composition. */
export const TABLE_ART_BASELINE = Object.freeze({
  referenceCharacterId: "w",
  referenceCanvas: Object.freeze({ width: 1536, height: 1024 }),
  normalSittingScale: 1,
  composition: "horizontal-seated"
});

/** Full table definition. Load this only when a match needs AI, dialogue, or table art. */
export interface CharacterData {
  readonly assets: CharacterAssets;
  /** All normal table portraits use TABLE_ART_BASELINE; definitions cannot override its scale. */
  readonly revolverPlacement: RevolverPlacement;
  readonly ai: AiProfile;
  readonly dialogue: CharacterDialogue;
}

export interface CharacterDefinition extends CharacterMetadata, CharacterData {}
