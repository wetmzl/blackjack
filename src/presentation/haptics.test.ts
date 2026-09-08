import { describe, expect, it, vi } from "vitest";
import { createMatch } from "../core/match/reducer";
import type { MatchState } from "../core/match/types";
import { presentBodyMovedHaptic, presentInteractionHaptic, presentMatchHaptics, presentSkillSelectionHaptic } from "./haptics";

describe("match haptics", () => {
  it("uses a minimal pulse for successful button interactions", () => {
    const vibrate = vi.fn(() => true);
    presentInteractionHaptic(true, { vibrate });
    expect(vibrate).toHaveBeenCalledWith(8);
  });

  it("keeps interaction feedback silent when reduced effects disable haptics", () => {
    const vibrate = vi.fn(() => true);
    presentInteractionHaptic(false, { vibrate });
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("matches dry-fire strength for skill selection and uses a low-duty 400ms body-move pattern", () => {
    const vibrate = vi.fn(() => true);
    presentSkillSelectionHaptic(true, { vibrate });
    presentBodyMovedHaptic(true, { vibrate });
    expect(vibrate.mock.calls).toEqual([
      [[22, 35, 28]],
      [[25, 75, 25, 75, 25, 75, 25, 75]]
    ]);
    const calls = vibrate.mock.calls as unknown as Array<[number | number[]]>;
    expect((calls[1]?.[0] as number[]).reduce((sum, duration) => sum + duration, 0)).toBe(400);
  });

  it("uses distinct confirmation, dry-fire, and gunshot patterns", () => {
    const base = createMatch("haptics");
    const vibrate = vi.fn(() => true);
    const confirmed: MatchState = { ...base, history: [...base.history, { type: "ROUND_RESULT_ACKNOWLEDGED" }] };
    presentMatchHaptics(base, confirmed, true, { vibrate });

    const dry: MatchState = { ...confirmed, history: [...confirmed.history, { type: "TRIGGER_PULLED", actor: "player", probability: 0.5, baseProbability: 0.5, misfireChance: 0, result: "empty-chamber", fired: false }] };
    presentMatchHaptics(confirmed, dry, true, { vibrate });

    const fired: MatchState = { ...dry, history: [...dry.history, { type: "TRIGGER_PULLED", actor: "opponent", probability: 1, baseProbability: 1, misfireChance: 0, result: "fired", fired: true }] };
    presentMatchHaptics(dry, fired, true, { vibrate });
    expect(vibrate.mock.calls).toEqual([[18], [[22, 35, 28]], [[70, 30, 120]]]);
  });

  it("stays silent when reduced effects disable haptics", () => {
    const state = createMatch("haptics-off");
    const vibrate = vi.fn(() => true);
    presentMatchHaptics(state, { ...state, history: [...state.history, { type: "ROUND_RESULT_ACKNOWLEDGED" }] }, false, { vibrate });
    expect(vibrate).not.toHaveBeenCalled();
  });
});
