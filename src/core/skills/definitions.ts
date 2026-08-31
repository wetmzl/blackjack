import type { SkillDefinition } from "./types";

export const EARLY_PREPARATION: SkillDefinition = {
  id: "early-preparation", name: "早有准备", category: "passive",
  description: "入场时额外获得一张主动技能牌。", timing: [], effect: { type: "opening-extra-draw" }
};
export const HUNTER_INSTINCT: SkillDefinition = {
  id: "hunter-instinct", name: "猎手直觉", category: "active",
  description: "显示当前牌面的数学最优 Hit / Stand。", timing: ["player-turn"], effect: { type: "hunter-advice" }
};
export const SWITCHEROO: SkillDefinition = {
  id: "switcheroo", name: "偷梁换柱", category: "active",
  description: "将最后一张牌换成牌库中一张不会让你爆牌的牌。", timing: ["player-turn"], effect: { type: "switcheroo" }
};
export const RHODES_HEARTTHROB: SkillDefinition = {
  id: "rhodes-heartthrob", name: "罗德岛万人迷", category: "active",
  description: "本轮下一次未满的装填免于扣扳机。", timing: ["player-turn"], effect: { type: "rhodes-heartthrob" }
};
export const NIGHT_QUEEN: SkillDefinition = {
  id: "night-queen", name: "暗夜女王", category: "active",
  description: "满足同花色条件后，下一次 Hit 必定正好 21 点。", timing: ["player-turn"], effect: { type: "night-queen" },
  unlock: { opponentId: "w", label: "首次击败 W" }
};
export const SIRACUSAN_FURY: SkillDefinition = {
  id: "siracusan-fury", name: "叙拉古人的愤怒", category: "passive",
  description: "对手子弹少于你时，对手普通装填数量翻倍。", timing: [], effect: { type: "double-opponent-load" },
  unlock: { opponentId: "texas", label: "首次击败德克萨斯" }
};

export const SKILL_DEFINITIONS: readonly SkillDefinition[] = [
  EARLY_PREPARATION, HUNTER_INSTINCT, SWITCHEROO, RHODES_HEARTTHROB,
  NIGHT_QUEEN, SIRACUSAN_FURY
];
export const INITIAL_SKILL_IDS = ["early-preparation", "hunter-instinct", "switcheroo", "rhodes-heartthrob"] as const;

export function getSkillDefinition(id: string): SkillDefinition | undefined {
  return SKILL_DEFINITIONS.find((skill) => skill.id === id);
}

export function isActiveSkill(id: string): boolean { return getSkillDefinition(id)?.category === "active"; }
export function isPassiveSkill(id: string): boolean { return getSkillDefinition(id)?.category === "passive"; }
