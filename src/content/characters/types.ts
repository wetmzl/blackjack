import type { AiProfile } from "../../core/ai/types";
import type { CharacterDialogue } from "../../dialogue/types";

export type Tier = "D" | "C" | "B" | "A" | "S";

/** Lightweight character data used to build the lobby and history index. */
export interface CharacterMetadata {
  readonly id: string;
  readonly name: string;
  readonly subtitle: string;
  readonly tier: Tier;
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

export interface CharacterProfile {
  readonly description: string;
}

export interface CharacterMatchSummary {
  readonly playerVictory: string;
  readonly playerDefeat: string;
  readonly escaped: string;
}

/** Percentage coordinates are relative to the portrait trophy-gallery artwork. */
export interface TrophyCloseupPoint {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly image: string;
  readonly description: string;
}

export interface CharacterTrophyGallery {
  /** 5:7 one-inch-photo composition shown in the history detail modal. */
  readonly headshot: string;
  /** 2:3 portrait artwork used as the full-screen inspection stage. */
  readonly fullBody: string;
  /** No upper limit: characters can define as many interactive details as needed. */
  readonly closeups: readonly TrophyCloseupPoint[];
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
  readonly $schema: "../character.schema.json";
  readonly assets: CharacterAssets;
  readonly profile: CharacterProfile;
  readonly matchSummary: CharacterMatchSummary;
  readonly trophyGallery?: CharacterTrophyGallery;
  /** All normal table portraits use TABLE_ART_BASELINE; definitions cannot override its scale. */
  readonly revolverPlacement: RevolverPlacement;
  readonly ai: AiProfile;
  readonly dialogue: CharacterDialogue;
}

export interface CharacterDefinition extends CharacterMetadata, CharacterData {}
