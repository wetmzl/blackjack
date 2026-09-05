import { describe, expect, it } from "vitest";
import { abilityTriggerNotice } from "./ability-notices";
import type { GameEvent } from "../core/match/types";

describe("ability trigger notices", () => {
  it("formats opponent mechanics with their data-driven effect notice", () => {
    const events: GameEvent[] = [{ type: "ABILITY_TRIGGERED", instanceId: "texas-skill", definitionId: "silent-drizzle", ruleId: "silence-rival-next-action", owner: "opponent" }];
    expect(abilityTriggerNotice(events, "德克萨斯")).toBe("德克萨斯发动了技能「细雨无声」：玩家下一手牌期间无法使用主动技能。");
  });

  it("formats passive player skills and deduplicates multiple rules from one ability", () => {
    const event = { type: "ABILITY_TRIGGERED", instanceId: "blueberry", definitionId: "blueberry-and-dark-chocolate", ruleId: "split-last-card", owner: "player" } as const;
    expect(abilityTriggerNotice([event, { ...event, ruleId: "another-rule" }], "德克萨斯")).toBe("策展人发动了技能「蓝莓与黑巧」：末牌已转化为两张衍生牌，固定点数保持不变。");
  });

  it("returns null when no ability triggered", () => {
    expect(abilityTriggerNotice([], "德克萨斯")).toBeNull();
  });

  it("keeps rules marked notify=false out of the central notice", () => {
    const event: GameEvent = { type: "ABILITY_TRIGGERED", instanceId: "platinum-skill", definitionId: "platinum-vision", ruleId: "clear-hit-advantage", owner: "opponent" };
    expect(abilityTriggerNotice([event], "白金")).toBeNull();
  });

  it("uses a rule-specific notice when one ability has mutually exclusive outcomes", () => {
    const reached: GameEvent = { type: "ABILITY_TRIGGERED", instanceId: "lappland-index", definitionId: "carnival-index", ruleId: "reward-rival-reaching-index", owner: "opponent" };
    const missed: GameEvent = { ...reached, ruleId: "reward-owner-missed-index" };
    const updated: GameEvent = { ...reached, ruleId: "replace-index-at-round-end" };
    expect(abilityTriggerNotice([reached], "拉普兰德")).toBe("拉普兰德发动了技能「狂欢指标」：策展人达到狂欢指标，本轮获得1点点数优势。");
    expect(abilityTriggerNotice([missed], "拉普兰德")).toBe("拉普兰德发动了技能「狂欢指标」：策展人未达到狂欢指标，拉普兰德本轮获得2点点数优势。");
    expect(abilityTriggerNotice([updated], "拉普兰德")).toBe("拉普兰德发动了技能「狂欢指标」：狂欢指标已替换为策展人上一轮的最终显示点数。");
  });
});
