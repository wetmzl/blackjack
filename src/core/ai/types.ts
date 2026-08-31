import type { Card } from "../blackjack/types";

export type AiAction = "hit" | "stand";

export interface AiProfile {
  readonly rationality: number;
  readonly personalityHitProbability: number;
}

export const RECKLESS_B_PROFILE: AiProfile = {
  rationality: 0.8,
  personalityHitProbability: 1
};

export interface ObservedParticipant {
  readonly cards: readonly (Card | null)[];
  readonly stood: boolean;
  readonly busted: boolean;
  readonly value: number | null;
}

export interface MatchObservation {
  readonly viewer: "player" | "opponent";
  readonly roundIndex: number;
  readonly phase: string;
  readonly currentActor: "player" | "opponent" | null;
  readonly player: ObservedParticipant;
  readonly opponent: ObservedParticipant;
  readonly shoeRemaining: number;
  readonly roulette: {
    readonly playerBullets: number;
    readonly opponentBullets: number;
    readonly capacity: number;
  };
}

export interface AiDecision {
  readonly optimalAction: AiAction;
  readonly optimalHit: 0 | 1;
  readonly personalityHitProbability: number;
  readonly rationality: number;
  readonly finalHitProbability: number;
  readonly roll: number;
  readonly action: AiAction;
}
