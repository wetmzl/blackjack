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
});
