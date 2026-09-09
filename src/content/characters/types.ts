import type { AiProfile } from "../../core/ai/types";
import type { CharacterDialogue } from "../../dialogue/types";
import type { AbilityBinding, AbilityInfoValue } from "../../core/abilities/types";

export type Tier = "D" | "C" | "B" | "A" | "S" | "SS";

/** Data-driven prerequisites for inviting an attendee to the table. */
export type CharacterUnlockCondition =
  | { readonly type: "defeat-any" }
  | { readonly type: "defeat-count"; readonly count: number }
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

export type CharacterTrophyDossierFieldId = "name" | "race" | "gender" | "tier" | "weight" | "virginity";

export interface CharacterTrophyDossierField {
  readonly id: CharacterTrophyDossierFieldId;
  readonly label: string;
  readonly value: string;
}

/** Presentation copy for the administrative drawer shown over a trophy-gallery stage. */
export interface CharacterTrophyDossier {
  readonly title: string;
  readonly recordLabel: string;
  readonly openLabel: string;
  readonly closeLabel: string;
  /** Exactly one entry for each CharacterTrophyDossierFieldId, in display order. */
  readonly fields: readonly CharacterTrophyDossierField[];
  readonly condition: {
    readonly label: string;
    readonly description: string;
  };
}

/** Declarative, single-slot information shown for an attendee on the table. */
export interface CharacterInfoBar {
  /** Enabled AI Skill whose lifetime controls whether this information remains active. */
  readonly sourceAbilityId: string;
  readonly label: string;
  readonly description: string;
  readonly format?: "number" | "percent";
  readonly value: AbilityInfoValue;
}

export interface TrophyCloseupVariant {
  readonly image: string;
  readonly description: string;
}

/** Percentage coordinates are relative to the shared coffin plus the attendee's default fullBody layer. */
export interface TrophyCloseupPoint {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly image: string;
  readonly description: string;
  /** Optional p1, p2… frames; image and description above are always p0. */
  readonly variants?: readonly TrophyCloseupVariant[];
}

export interface TrophyGalleryPose {
  readonly id: string;
  readonly name: string;
  /** 2:3 transparent character layer aligned to the shared coffin canvas. */
  readonly image: string;
}

export interface CharacterTrophyGallery {
  /** 5:7 archival head-and-shoulders view of the deceased attendee. */
  readonly headshot: string;
  /** Default 2:3 transparent character layer used as the annotated inspection stage. */
  readonly fullBody: string;
  /** Optional alternate transparent layers; closeup coordinates only apply to fullBody. */
  readonly poses?: readonly TrophyGalleryPose[];
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
  readonly trophyDossier: CharacterTrophyDossier;
  readonly matchSummary: CharacterMatchSummary;
  readonly infoBar?: CharacterInfoBar;
  readonly trophyGallery?: CharacterTrophyGallery;
  readonly revolverPlacement: RevolverPlacement;
  readonly ai: AiProfile;
  readonly aiSkills: readonly AbilityBinding[];
  readonly dialogue: CharacterDialogue;
}

export interface CharacterDefinition extends CharacterMetadata, CharacterData {}
