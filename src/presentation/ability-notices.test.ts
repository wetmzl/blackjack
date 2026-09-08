import { describe, expect, it } from "vitest";
import { abilityExpiredNotices, abilityTriggerNotice, pendingTriggerAbilityNotices } from "./ability-notices";
import { createMatch } from "../core/match/reducer";
import type { GameEvent, MatchState } from "../core/match/types";
import type { PendingTriggerPreview } from "../core/match/reducer";

const afterWithAdvice = (advice: "hit" | "stand"): MatchState => ({ playerSkills: { advice } } as MatchState);

describe("ability trigger notices", () => {
  it("returns one AI notice with its tone", () => {
    const events: GameEvent[] = [{ type: "ABILITY_TRIGGERED", instanceId: "texas-skill", definitionId: "silent-drizzle", ruleId: "silence-rival-next-action", owner: "opponent" }];
    expect(abilityTriggerNotice(events, "德克萨斯")).toEqual([{ owner: "opponent", tone: "ai", text: "德克萨斯发动「细雨无声」：玩家下一手牌期间无法使用主动技能。" }]);
  });

  it("keeps each player trigger independent", () => {
    const event = { type: "ABILITY_TRIGGERED", instanceId: "blueberry", definitionId: "blueberry-and-dark-chocolate", ruleId: "split-last-card", owner: "player" } as const;
    expect(abilityTriggerNotice([event, { ...event, ruleId: "another-rule" }], "德克萨斯")).toHaveLength(2);
    expect(abilityTriggerNotice([event], "德克萨斯")[0]).toMatchObject({ owner: "player", tone: "player" });
  });

  it("returns an empty array when no visible ability triggered", () => {
    expect(abilityTriggerNotice([], "德克萨斯")).toEqual([]);
  });

  it("keeps rules marked notify=false out of ability notices", () => {
    const event: GameEvent = { type: "ABILITY_TRIGGERED", instanceId: "platinum-skill", definitionId: "platinum-vision", ruleId: "clear-hit-advantage", owner: "opponent" };
    expect(abilityTriggerNotice([event], "白金")).toEqual([]);
  });

  it("does not present talents", () => {
    const event: GameEvent = { type: "ABILITY_TRIGGERED", instanceId: "talent", definitionId: "early-preparation", ruleId: "grant-opening-skill-draw", owner: "player" };
    expect(abilityTriggerNotice([event], "德克萨斯")).toEqual([]);
  });

  it("announces the final misfire chance during the pending trigger window", () => {
    const ability: GameEvent = { type: "ABILITY_TRIGGERED", instanceId: "skill", definitionId: "sword-and-handcannon", ruleId: "misfire-after-rival-hits", owner: "player" };
    const trigger: GameEvent = { type: "TRIGGER_PULLED", actor: "player", probability: 0.2, baseProbability: 0.2, misfireChance: 0.99, result: "misfire", fired: false };
    const preview: PendingTriggerPreview = { actor: "player", misfireChance: 0.99, cancelled: false, events: [ability] };
    expect(pendingTriggerAbilityNotices(preview, "德克萨斯")[0]?.text).toBe("策展人发动「剑与手炮」：本轮哑火概率为99%");
    expect(abilityTriggerNotice([ability, trigger], "德克萨斯")).toEqual([]);
  });

  it("uses the concrete Hit bust forecast", () => {
    const event: GameEvent = { type: "ABILITY_TRIGGERED", instanceId: "skill", definitionId: "critical-judgment", ruleId: "forecast-next-hit", owner: "player" };
    const result: GameEvent = { type: "ABILITY_RESULT", instanceId: "skill", definitionId: "critical-judgment", owner: "player", result: { type: "hit-bust-forecast", actor: "player", wouldBust: true } };
    expect(abilityTriggerNotice([event, result], "德克萨斯", afterWithAdvice("stand"))[0]?.text).toBe("策展人发动「临界判断」：现在 Hit 会导致爆牌。");
  });

  it("shows the currently revealed draw-pile suit for Hunter Instinct", () => {
    const event: GameEvent = { type: "ABILITY_TRIGGERED", instanceId: "hunter", definitionId: "hunter-instinct", ruleId: "reveal-top-on-gain", owner: "player" };
    const revealed: GameEvent = { type: "DRAW_PILE_CARD_SUIT_REVEALED", viewer: "player", cardId: "next-card", suit: "diamonds" };
    expect(abilityTriggerNotice([event, revealed], "德克萨斯")[0]?.text).toBe("策展人发动「猎手直觉」：牌堆顶下一张牌的花色是方块");
  });

  it("reports only the hand-total relation for Situation Assessment", () => {
    const event: GameEvent = { type: "ABILITY_TRIGGERED", instanceId: "situation", definitionId: "situation-assessment", ruleId: "compare-base-totals", owner: "player" };
    const result: GameEvent = { type: "ABILITY_RESULT", instanceId: "situation", definitionId: "situation-assessment", owner: "player", result: { type: "hand-total-compared", actor: "player", relation: "lower" } };
    expect(abilityTriggerNotice([event, result], "德克萨斯")[0]?.text).toBe("策展人发动「态势研判」：对手的当前基础点数更高。");
  });

  it("reports the immediate load from Prepaid Premium", () => {
    const event: GameEvent = { type: "ABILITY_TRIGGERED", instanceId: "premium", definitionId: "prepaid-premium", ruleId: "prepay-and-cover", owner: "player" };
    const result: GameEvent = { type: "ABILITY_RESULT", instanceId: "premium", definitionId: "prepaid-premium", owner: "player", result: { type: "gun-bullets-added", actor: "player", amount: 1, bullets: 3 } };
    expect(abilityTriggerNotice([event, result], "德克萨斯")[0]?.text).toContain("当前弹巢共有3发");
  });

  it("uses every actual revealed suit from the same batch", () => {
    const ability: GameEvent = { type: "ABILITY_TRIGGERED", instanceId: "skill", definitionId: "scent-of-a-woman", ruleId: "reveal-rival-suit", owner: "player" };
    const revealed: GameEvent[] = [
      { type: "CARD_SUIT_REVEALED", viewer: "player", target: "opponent", cardId: "public-club", suit: "clubs" },
      { type: "CARD_SUIT_REVEALED", viewer: "player", target: "opponent", cardId: "private-spade", suit: "spades" },
      { type: "CARD_SUIT_REVEALED", viewer: "player", target: "opponent", cardId: "private-heart", suit: "hearts" }
    ];
    expect(abilityTriggerNotice([ability, ...revealed], "德克萨斯")[0]?.text).toBe("策展人发动「闻香识女人」：对手当前所有手牌花色为梅花、黑桃、红桃");
  });

  it("uses the cancellation result when a status rule has no source definition rule", () => {
    const ability: GameEvent = { type: "ABILITY_TRIGGERED", instanceId: "heartthrob-status", definitionId: "rhodes-heartthrob", ruleId: "avoid-trigger", owner: "player" };
    const cancelled: GameEvent = { type: "PENDING_EVENT_CANCELLED", eventId: "trigger:1", sourceInstanceId: "heartthrob-status" };
    expect(abilityTriggerNotice([ability, cancelled], "德克萨斯")[0]?.text).toBe("策展人发动「罗德岛万人迷」：本次免于扣扳机");
  });

  it("uses the committed bust limit instead of making the player calculate it", () => {
    const ability: GameEvent = { type: "ABILITY_TRIGGERED", instanceId: "bomb", definitionId: "bomb-maniac", ruleId: "raise-bust-limit", owner: "opponent" };
    const bust: GameEvent = { type: "BUST", actor: "opponent" };
    const after = { opponent: { bustLimit: 23 } } as MatchState;
    expect(abilityTriggerNotice([ability, bust], "W", after)[0]?.text).toBe("W发动「炸弹狂人」：本轮爆牌上限为23点");
  });

  it("uses a rule-specific notice for mutually exclusive outcomes", () => {
    const reached: GameEvent = { type: "ABILITY_TRIGGERED", instanceId: "lappland-index", definitionId: "carnival-index", ruleId: "reward-rival-reaching-index", owner: "opponent" };
    const missed: GameEvent = { ...reached, ruleId: "reward-owner-missed-index" };
    const updated: GameEvent = { ...reached, ruleId: "replace-index-at-round-end" };
    expect(abilityTriggerNotice([reached], "拉普兰德")[0]?.text).toContain("策展人达到狂欢指标");
    expect(abilityTriggerNotice([missed], "拉普兰德")[0]?.text).toContain("策展人未达到狂欢指标");
    expect(abilityTriggerNotice([updated], "拉普兰德")[0]?.text).toContain("狂欢指标已替换");
  });

  it("uses generic concrete results for the new Player Skills", () => {
    const compound: GameEvent = { type: "ABILITY_TRIGGERED", instanceId: "compound", definitionId: "compound-interest", ruleId: "add-hand-count-card", owner: "player" };
    const card: GameEvent = { type: "ABILITY_RESULT", instanceId: "compound", definitionId: "compound-interest", owner: "player", result: { type: "derived-card-added", actor: "player", rank: "3", suit: "hearts" } };
    expect(abilityTriggerNotice([compound, card], "W")[0]?.text).toContain("获得一张3点衍生牌");

    const sissa: GameEvent = { type: "ABILITY_TRIGGERED", instanceId: "sissa", definitionId: "sissas-table", ruleId: "add-overflow-advantage", owner: "player" };
    const sissaCard: GameEvent = { type: "ABILITY_RESULT", instanceId: "sissa", definitionId: "sissas-table", owner: "player", result: { type: "derived-card-added", actor: "player", rank: "K", suit: "spades" } };
    const overflow: GameEvent = { type: "ABILITY_RESULT", instanceId: "sissa", definitionId: "sissas-table", owner: "player", result: { type: "status-stacks-updated", actor: "player", statusDefinitionId: "player-point-advantage", stacks: 6, delta: 6 } };
    expect(abilityTriggerNotice([sissa, overflow, sissaCard], "W")[0]?.text).toContain("黑桃K衍生牌，多余的6点转化为点数优势");

    const mimic: GameEvent = { type: "ABILITY_TRIGGERED", instanceId: "mimic", definitionId: "mimic-eggplant", ruleId: "grant-last-player-skill", owner: "player" };
    const granted: GameEvent = { type: "ABILITY_RESULT", instanceId: "mimic", definitionId: "mimic-eggplant", owner: "player", result: { type: "skill-card-granted", definitionId: "a-single-coin" } };
    expect(abilityTriggerNotice([mimic, granted], "W")[0]?.text).toContain("获得一张「一枚硬币」");

    const carnival: GameEvent = { type: "ABILITY_TRIGGERED", instanceId: "carnival", definitionId: "carnival", ruleId: "raise-shared-bust-limit", owner: "player" };
    const carnivalResult: GameEvent = { type: "ABILITY_RESULT", instanceId: "carnival", definitionId: "carnival", owner: "player", result: { type: "status-stacks-updated", actor: "player", statusDefinitionId: "carnival-bust-bonus", stacks: 1, delta: 1 } };
    const base = createMatch("carnival-notice");
    const source = { kind: "player-skill" as const, definitionId: "carnival", owner: "player" as const, instanceId: "carnival", createdAtSequence: base.abilities.sequence + 1, parameters: {} };
    const after = {
      ...base,
      abilities: {
        ...base.abilities,
        instances: [...base.abilities.instances, source],
        statuses: [{ statusDefinitionId: "carnival-bust-bonus", owner: "player" as const, sourceInstanceId: source.instanceId, stacks: 1, duration: "round" as const, parameters: {}, createdAtSequence: source.createdAtSequence }],
        sequence: source.createdAtSequence
      }
    };
    expect(abilityTriggerNotice([carnival, carnivalResult], "W", after)[0]?.text).toContain("本轮公共爆牌上限提高至22点");
  });

  it("suppresses internal shared-status rule toasts", () => {
    const event: GameEvent = { type: "ABILITY_TRIGGERED", instanceId: "carnival", definitionId: "carnival", ruleId: "apply-carnival-bust-bonus", owner: "player" };
    expect(abilityTriggerNotice([event], "W")).toEqual([]);
  });

  it("routes depleted skills to the independent notice stack", () => {
    const event: GameEvent = { type: "ABILITY_EXPIRED", instanceId: "sword", definitionId: "sword-and-handcannon", owner: "player", reason: "triggers" };
    expect(abilityExpiredNotices([event])).toEqual([{
      owner: "system",
      tone: "notification",
      text: "剑与手炮的效果已耗尽"
    }]);
  });
});
