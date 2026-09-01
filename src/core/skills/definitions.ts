import type { SkillDefinition } from "./types";

export const EARLY_PREPARATION: SkillDefinition = {
  id: "early-preparation", name: "早有准备", category: "passive",
  description: "入场时额外获得一张主动技能牌。", usage: "被动效果：入场时额外获得 1 张主动技能牌；本技能不会进入技能卡池。", timing: [], effect: { type: "opening-extra-draw" }
};
export const HUNTER_INSTINCT: SkillDefinition = {
  id: "hunter-instinct", name: "猎手直觉", category: "active",
  description: "显示当前牌面的数学最优 Hit / Stand。", usage: "玩家回合可用。消费后显示当前玩家的数学最优 Hit / Stand；下一次 Hit、Stand 或换轮时清除建议。", timing: ["player-turn"], effect: { type: "hunter-advice" }
};
export const SWITCHEROO: SkillDefinition = {
  id: "switcheroo", name: "偷梁换柱", category: "active",
  description: "将最后一张牌换成牌库中一张不会让你爆牌的牌。", usage: "玩家回合可用。将最后一张手牌与剩余牌库中随机一张使总点数不超过 21 的牌交换；不算 Hit，也不交出行动权。换后恰为 21 时自动停牌；没有候选牌时不可用。", timing: ["player-turn"], effect: { type: "switcheroo" }
};
export const RHODES_HEARTTHROB: SkillDefinition = {
  id: "rhodes-heartthrob", name: "罗德岛万人迷", category: "active",
  description: "本轮下一次未满的装填免于扣扳机。", usage: "玩家回合可用，武装效果持续到本轮结束。若本轮结算需要扣扳机，仍正常装填；装填后枪未满则免除这次扳机并进入下一轮。装填后已满膛时技能无效，仍按正常规则扣扳机；同轮不可重复武装。", timing: ["player-turn"], effect: { type: "rhodes-heartthrob" }
};
export const NIGHT_QUEEN: SkillDefinition = {
  id: "night-queen", name: "暗夜女王", category: "active",
  description: "满足同花色条件后，下一次 Hit 必定正好 21 点。", usage: "玩家回合可用；当前手牌必须全部同花色且总点数大于 10。消费后，下一次 Hit 无条件直接使总点数达到 21，并消费一个牌库位置；点差为 10 时在 10、J、Q、K 中由技能随机数确定，花色也由技能随机数确定。本轮结束前未 Hit 会重置武装。", timing: ["player-turn"], effect: { type: "night-queen" },
  unlock: { opponentId: "w", label: "首次击败 W" }
};
export const SIRACUSAN_FURY: SkillDefinition = {
  id: "siracusan-fury", name: "叙拉古人的愤怒", category: "passive",
  description: "对手子弹少于你时，对手普通装填数量翻倍。", usage: "被动效果：若对手当前子弹少于玩家，且本轮是非 Blackjack 的对手装填，则装填数量从 1 发翻倍为 2 发，仍受枪容量限制。Blackjack 装填永不翻倍。", timing: [], effect: { type: "double-opponent-load" },
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
