import type { SkillDefinition } from "./types";

export const REMOVE_BULLET: SkillDefinition = {
  id: "remove-bullet",
  name: "卸下一发",
  description: "从你的枪里取出一发子弹。",
  timing: ["roulette-reaction"],
  effect: { type: "remove-bullet", amount: 1 }
};

export const PEEK_NEXT_CARD: SkillDefinition = {
  id: "peek-next-card",
  name: "窥见下一张",
  description: "只让你看见牌库顶端的下一张牌。",
  timing: ["player-turn"],
  effect: { type: "peek-next-card", count: 1 }
};

export const SKILL_DEFINITIONS: readonly SkillDefinition[] = [REMOVE_BULLET, PEEK_NEXT_CARD];

export function getSkillDefinition(id: string): SkillDefinition | undefined {
  return SKILL_DEFINITIONS.find((skill) => skill.id === id);
}
