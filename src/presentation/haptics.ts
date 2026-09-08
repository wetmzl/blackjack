import type { MatchState } from "../core/match/types";

export interface HapticsNavigator {
  vibrate?: (pattern: number | number[]) => boolean;
}

const CONFIRM_PATTERN = 18;
const DRY_FIRE_PATTERN = [22, 35, 28];
const GUNSHOT_PATTERN = [70, 30, 120];
const INTERACTION_PATTERN = 8;

/** Gives an enabled UI button the lightest available best-effort click feedback. */
export function presentInteractionHaptic(
  enabled: boolean,
  target: HapticsNavigator = navigator
): void {
  if (!enabled || typeof target.vibrate !== "function") return;
  target.vibrate(INTERACTION_PATTERN);
}

/** Best-effort Android feedback; unsupported browsers simply do nothing. */
export function presentMatchHaptics(
  before: MatchState,
  after: MatchState,
  enabled: boolean,
  target: HapticsNavigator = navigator
): void {
  if (!enabled || typeof target.vibrate !== "function") return;
  const events = after.history.slice(before.history.length);
  if (events.some((event) => event.type === "ROUND_RESULT_ACKNOWLEDGED")) {
    target.vibrate(CONFIRM_PATTERN);
    return;
  }
  const trigger = events.find((event) => event.type === "TRIGGER_PULLED");
  if (trigger?.type === "TRIGGER_PULLED") target.vibrate(trigger.fired ? GUNSHOT_PATTERN : DRY_FIRE_PATTERN);
}
