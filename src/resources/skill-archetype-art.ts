import { SKILL_TAGS, type SkillTag } from "../core/skills/types";

export interface SkillArchetypeArt {
  readonly default: string;
  readonly selected: string;
}

/** Presentation assets kept outside the core skill contract and initial PWA precache. */
export const SKILL_ARCHETYPE_ART: Readonly<Record<SkillTag, SkillArchetypeArt>> = Object.freeze({
  gambler: {
    default: "/assets/skills/archetype-gambler.png",
    selected: "/assets/skills/archetype-gambler-selected.png"
  },
  cheater: {
    default: "/assets/skills/archetype-cheater.png",
    selected: "/assets/skills/archetype-cheater-selected.png"
  },
  "intelligence-officer": {
    default: "/assets/skills/archetype-intelligence-officer.png",
    selected: "/assets/skills/archetype-intelligence-officer-selected.png"
  },
  gunslinger: {
    default: "/assets/skills/archetype-gunslinger.png",
    selected: "/assets/skills/archetype-gunslinger-selected.png"
  }
});

export const SKILL_ARCHETYPE_ART_URLS: readonly string[] = Object.freeze(
  SKILL_TAGS.flatMap((tag) => [SKILL_ARCHETYPE_ART[tag].default, SKILL_ARCHETYPE_ART[tag].selected])
);
