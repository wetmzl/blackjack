import { describe, expect, it, vi } from "vitest";
import { createMatch } from "../core/match/reducer";
import type { MatchState } from "../core/match/types";
import { presentMatchHaptics } from "./haptics";

describe("match haptics", () => {
  it("uses distinct confirmation, dry-fire, and gunshot patterns", () => {
    const base = createMatch("haptics");
    const vibrate = vi.fn(() => true);
    const confirmed: MatchState = { ...base, history: [...base.history, { type: "ROUND_RESULT_ACKNOWLEDGED" }] };
    presentMatchHaptics(base, confirmed, true, { vibrate });

    const dry: MatchState = { ...confirmed, history: [...confirmed.history, { type: "TRIGGER_PULLED", actor: "player", probability: 0.5, fired: false }] };
    presentMatchHaptics(confirmed, dry, true, { vibrate });

    const fired: MatchState = { ...dry, history: [...dry.history, { type: "TRIGGER_PULLED", actor: "opponent", probability: 1, fired: true }] };
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
