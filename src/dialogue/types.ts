import type { SeededRng, RngSnapshot } from "../core/rng/seeded";
import eventDefinitions from "./events.json";

export type DialogueEvent =
  | "MATCH_START" | "PLAYER_HIT" | "PLAYER_STAND" | "PLAYER_BLACKJACK" | "OPPONENT_BLACKJACK"
  | "PLAYER_BUST" | "OPPONENT_BUST" | "PLAYER_SURVIVED_TRIGGER" | "OPPONENT_SURVIVED_TRIGGER"
  | "PLAYER_WIN_ROUND" | "OPPONENT_WIN_ROUND" | "PUSH_ROUND"
  | "PLAYER_TRIGGER_READY" | "OPPONENT_TRIGGER_READY" | "PLAYER_TRIGGER_HIT" | "OPPONENT_TRIGGER_HIT"
  | "MATCH_WIN" | "MATCH_LOSS" | "PLAYER_ESCAPE";

export const DIALOGUE_EVENT_CODES = eventDefinitions.map((event) => event.code) as readonly DialogueEvent[];
export const DIALOGUE_EVENT_LABELS: Readonly<Record<DialogueEvent, string>> = Object.fromEntries(eventDefinitions.map((event) => [event.code, event.label])) as Record<DialogueEvent, string>;

export interface CharacterDialogue {
  readonly [event: string]: readonly string[];
}

export interface DialoguePick {
  readonly line: string | null;
  readonly rng: RngSnapshot;
}

export function chooseDialogue(dialogue: CharacterDialogue, event: DialogueEvent, rng: SeededRng): DialoguePick {
  const lines = dialogue[event] ?? [];
  if (lines.length === 0) return { line: null, rng: rng.snapshot() };
  return { line: lines[rng.nextInt(lines.length)], rng: rng.snapshot() };
}
