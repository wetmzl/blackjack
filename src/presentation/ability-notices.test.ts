import { describe, expect, it } from "vitest";
import { abilityExpiredNotices, abilityTriggerNotice, pendingTriggerAbilityNotices } from "./ability-notices";
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

  it("uses the published action advice from after state", () => {
    const event: GameEvent = { type: "ABILITY_TRIGGERED", instanceId: "skill", definitionId: "hunter-instinct", ruleId: "publish-advice", owner: "player" };
    expect(abilityTriggerNotice([event], "德克萨斯", afterWithAdvice("stand"))[0]?.text).toBe("策展人发动「猎手直觉」：建议 Stand 停牌");
  });

  it("uses the actual revealed suit from the same batch", () => {
    const ability: GameEvent = { type: "ABILITY_TRIGGERED", instanceId: "skill", definitionId: "scent-of-a-woman", ruleId: "reveal-rival-suit", owner: "player" };
    const revealed: GameEvent = { type: "CARD_SUIT_REVEALED", viewer: "player", target: "opponent", cardIndex: 1, suit: "spades" };
    expect(abilityTriggerNotice([ability, revealed], "德克萨斯")[0]?.text).toBe("策展人发动「闻香识女人」：对手暗牌花色为黑桃");
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

  it("routes depleted skills to the independent notice stack", () => {
    const event: GameEvent = { type: "ABILITY_EXPIRED", instanceId: "sword", definitionId: "sword-and-handcannon", owner: "player", reason: "triggers" };
    expect(abilityExpiredNotices([event])).toEqual([{
      owner: "system",
      tone: "notification",
      text: "剑与手炮的效果已耗尽"
    }]);
  });
});
