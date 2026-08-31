import type { AiDecision, AiProfile } from "../ai/types";
import type { Card, Hand, ShoeState, RoundStarter } from "../blackjack/types";
import type { RngSnapshot } from "../rng/seeded";
import type { RouletteState } from "../roulette/types";
import type { SkillInventory } from "../skills/types";

export type AppScene = "lobby" | "match" | "trophy-room";
export type MatchView = "table" | "execution-room" | "match-summary";
export type RoundPhase = "dealing" | "initial-blackjack-check" | "turns" | "settlement" | "round-reveal" | "roulette-reaction" | "roulette-trigger" | "roulette-result" | "reward" | "round-end";
export type Actor = "player" | "opponent";

export interface ParticipantState {
  readonly id: Actor;
  readonly hand: Hand;
  readonly stood: boolean;
  readonly busted: boolean;
}

export type RoundReason = "blackjack" | "bust" | "comparison" | "push";
export interface RoundOutcome {
  readonly winner: Actor | null;
  readonly reason: RoundReason;
  readonly penaltyTarget: Actor | null;
  readonly bulletsAdded: number;
  readonly playerSkillReward: number;
}

export interface RoundState {
  readonly index: number;
  readonly phase: RoundPhase;
  readonly starter: RoundStarter;
  readonly currentActor: Actor | null;
  readonly player: ParticipantState;
  readonly opponent: ParticipantState;
  readonly outcome: RoundOutcome | null;
}

export type MatchEndReason = "player-killed" | "opponent-killed" | "escaped";
export interface MatchOutcome {
  readonly winner: Actor | null;
  readonly reason: MatchEndReason;
}

export interface MatchRngState {
  readonly deck: RngSnapshot;
  readonly roulette: RngSnapshot;
  readonly ai: RngSnapshot;
  readonly loot: RngSnapshot;
  readonly skill: RngSnapshot;
  readonly dialogue: RngSnapshot;
}

export type GameEvent =
  | { readonly type: "ROUND_STARTED"; readonly roundIndex: number }
  | { readonly type: "CARD_DEALT"; readonly actor: Actor; readonly card: Card; readonly private: boolean }
  | { readonly type: "INITIAL_BLACKJACK_CHECK"; readonly player: boolean; readonly opponent: boolean }
  | { readonly type: "PLAYER_HIT" | "OPPONENT_HIT"; readonly value: number }
  | { readonly type: "PLAYER_STOOD" | "OPPONENT_STOOD" }
  | { readonly type: "BLACKJACK"; readonly actor: Actor }
  | { readonly type: "BUST"; readonly actor: Actor }
  | { readonly type: "ROUND_RESOLVED"; readonly outcome: RoundOutcome }
  | { readonly type: "ROUND_RESULT_ACKNOWLEDGED" }
  | { readonly type: "BULLET_ADDED"; readonly actor: Actor; readonly amount: number }
  | { readonly type: "TRIGGER_PULLED"; readonly actor: Actor; readonly probability: number; readonly fired: boolean }
  | { readonly type: "TRIGGER_SURVIVED"; readonly actor: Actor }
  | { readonly type: "TRIGGER_AVOIDED_BY_SKILL"; readonly actor: Actor; readonly skillId: string }
  | { readonly type: "TRIGGER_RESULT_ACKNOWLEDGED" }
  | { readonly type: "PARTICIPANT_KILLED"; readonly actor: Actor }
  | { readonly type: "SKILL_GAINED"; readonly skillId: string }
  | { readonly type: "SKILL_USED"; readonly skillId: string }
  | { readonly type: "SKILL_ADVICE"; readonly advice: "hit" | "stand" }
  | { readonly type: "MATCH_FINISHED"; readonly reason: MatchEndReason }
  | { readonly type: "MATCH_ESCAPED" }
  | { readonly type: "MATCH_RESULT_ACKNOWLEDGED" }
  | { readonly type: "AI_DECISION"; readonly decision: AiDecision };

export type Action =
  | { readonly type: "PLAYER_HIT" }
  | { readonly type: "PLAYER_STAND" }
  | { readonly type: "AI_TURN" }
  | { readonly type: "AI_HIT" | "OPPONENT_HIT" }
  | { readonly type: "AI_STAND" | "OPPONENT_STAND" }
  | { readonly type: "USE_SKILL"; readonly skillId: string }
  | { readonly type: "TRIGGER_ROULETTE" }
  | { readonly type: "ACK_ROUND_RESULT" }
  | { readonly type: "ACK_TRIGGER_RESULT" }
  | { readonly type: "CONTINUE_ROUND" }
  | { readonly type: "ESCAPE_MATCH" }
  | { readonly type: "ACK_MATCH_RESULT" };

export interface MatchState {
  readonly id: string;
  readonly seed: string;
  readonly opponentId: string;
  readonly status: "active" | "finished";
  readonly scene: AppScene;
  readonly view: MatchView;
  readonly roundIndex: number;
  readonly player: ParticipantState;
  readonly opponent: ParticipantState;
  readonly shoe: ShoeState;
  readonly roulette: RouletteState;
  readonly skills: SkillInventory;
  readonly round: RoundState;
  readonly outcome?: MatchOutcome;
  readonly history: readonly GameEvent[];
  readonly rng: MatchRngState;
  readonly aiProfile: AiProfile;
  readonly lastAiDecision: AiDecision | null;
}
