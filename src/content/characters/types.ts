import type { AiProfile } from "../../core/ai/types";
import type { CharacterDialogue } from "../../dialogue/types";
import type { AbilityBinding } from "../../core/abilities/types";

export type Tier = "D" | "C" | "B" | "A" | "S";

/** Data-driven prerequisites for inviting an attendee to the table. */
export type CharacterUnlockCondition =
  | { readonly type: "defeat-any" }
  | { readonly type: "defeat-any-tag"; readonly tag: string }
  | { readonly type: "defeat-character"; readonly characterId: string }
  | { readonly type: "defeat-tag-percentage"; readonly tag: string; readonly percentage: number };

export type CharacterPortraitSurface = "selection" | "table";

/** Presentation-only scales shared by every UI surface that renders attendee portrait art. */
export type CharacterPortraitScales = Readonly<Record<CharacterPortraitSurface, number>>;

/** Lightweight attendee data used to build the castle lobby and collection-history index. */
export interface CharacterMetadata {
  readonly id: string;
  readonly name: string;
  readonly subtitle: string;
  readonly tier: Tier;
  /** Custom discovery tags. The tier itself is also queryable as `tier:s`, `tier:a`, etc. */
  readonly tags: readonly string[];
  readonly unlock?: CharacterUnlockCondition;
  readonly previewImage: string;
  readonly trophyImage: string;
  readonly portraitScales: CharacterPortraitScales;
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

/** Percentage coordinates are relative to the attendee's portrait collection artwork. */
export interface TrophyCloseupPoint {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly image: string;
  readonly description: string;
}

export interface CharacterTrophyGallery {
  /** 5:7 archival head-and-shoulders view of the deceased attendee. */
  readonly headshot: string;
  /** 2:3 full-body collection record used as the inspection stage. */
  readonly fullBody: string;
  /** No upper limit: attendees can define as many archival details as needed. */
  readonly closeups: readonly TrophyCloseupPoint[];
}

/** W art reference: 1536×1024 source canvas and scale 1 normal sitting composition. */
export const TABLE_ART_BASELINE = Object.freeze({
  referenceCharacterId: "w",
  referenceCanvas: Object.freeze({ width: 1536, height: 1024 }),
  normalSittingScale: 1,
  composition: "horizontal-seated"
});

/** Full attendee definition. Load this only when a match needs AI, dialogue, or table art. */
export interface CharacterData {
  readonly $schema: "../character.schema.json";
  readonly assets: CharacterAssets;
  readonly profile: CharacterProfile;
  readonly matchSummary: CharacterMatchSummary;
  readonly trophyGallery?: CharacterTrophyGallery;
  readonly revolverPlacement: RevolverPlacement;
  readonly ai: AiProfile;
  readonly mechanics: readonly AbilityBinding[];
  readonly dialogue: CharacterDialogue;
}

export interface CharacterDefinition extends CharacterMetadata, CharacterData {}
