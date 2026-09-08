import type { MatchState } from "../core/match/types";

export interface HapticsNavigator {
  vibrate?: (pattern: number | number[]) => boolean;
}

const CONFIRM_PATTERN = 18;
const DRY_FIRE_PATTERN = [22, 35, 28];
const GUNSHOT_PATTERN = [70, 30, 120];
const INTERACTION_PATTERN = 8;
const BODY_MOVED_PATTERN = [25, 75, 25, 75, 25, 75, 25, 75];

function vibrate(enabled: boolean, pattern: number | number[], target: HapticsNavigator): void {
  if (!enabled || typeof target.vibrate !== "function") return;
  target.vibrate(pattern);
}

/** Gives an enabled UI button the lightest available best-effort click feedback. */
export function presentInteractionHaptic(
  enabled: boolean,
  target: HapticsNavigator = navigator
): void {
  vibrate(enabled, INTERACTION_PATTERN, target);
}

/** Uses the dry-fire strength for a committed archetype selection change. */
export function presentSkillSelectionHaptic(
  enabled: boolean,
  target: HapticsNavigator = navigator
): void {
  vibrate(enabled, DRY_FIRE_PATTERN, target);
}

/** Spreads short low-duty pulses across 400ms while a trophy pose is moved. */
export function presentBodyMovedHaptic(
  enabled: boolean,
  target: HapticsNavigator = navigator
): void {
  vibrate(enabled, BODY_MOVED_PATTERN, target);
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
