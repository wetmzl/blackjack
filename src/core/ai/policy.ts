import { handValue } from "../blackjack/hand";
import type { Card } from "../blackjack/types";
import type { AiAction, AiDecision, AiProfile, MatchObservation } from "./types";
import type { SeededRng, RngSnapshot } from "../rng/seeded";

export interface AiDecisionResult {
  readonly decision: AiDecision;
  readonly rng: RngSnapshot;
}

/** Approximate policy for this variant: hit below 17, stand at 17 or higher. */
export function decideOptimalAction(observation: MatchObservation): AiAction {
  const knownCards = observation.opponent.cards.filter((card): card is Card => card !== null);
  if (knownCards.length === 0) return "stand";
  return handValue({ cards: knownCards }) < 17 ? "hit" : "stand";
}

export function finalHitProbability(profile: AiProfile, optimalHit: 0 | 1): number {
  const probability = profile.rationality * optimalHit + (1 - profile.rationality) * profile.personalityHitProbability;
  return Math.min(1, Math.max(0, probability));
}

export function decideAiAction(observation: MatchObservation, profile: AiProfile, rng: SeededRng): AiDecisionResult {
  if (profile.rationality < 0 || profile.rationality > 1 || profile.personalityHitProbability < 0 || profile.personalityHitProbability > 1) {
    throw new RangeError("AI profile probabilities must be between 0 and 1");
  }
  const optimalAction = decideOptimalAction(observation);
  const optimalHit: 0 | 1 = optimalAction === "hit" ? 1 : 0;
  const probability = finalHitProbability(profile, optimalHit);
  const roll = rng.next();
  const action: AiAction = roll < probability ? "hit" : "stand";
  return {
    decision: {
      optimalAction,
      optimalHit,
      personalityHitProbability: profile.personalityHitProbability,
      rationality: profile.rationality,
      finalHitProbability: probability,
      roll,
      action
    },
    rng: rng.snapshot()
  };
}
